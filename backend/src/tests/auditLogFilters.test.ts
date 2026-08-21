import { deleteAuditLogs } from './testHelpers';
import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';

describe('Audit Trail filter advancements (entityId, ipAddress, meta/values, CSV formatting)', () => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tenantSlug = `audit-filter-corp-${runId}`;
  const tenantSchema = `tenant_audit_filter_corp_${runId}`;
  const adminEmail = `admin_auditfilter_${runId}@corp.com`;

  const otherTenantSlug = `audit-filter-corp-other-${runId}`;
  const otherTenantSchema = `tenant_audit_filter_corp_other_${runId}`;
  const otherAdminEmail = `admin_auditfilter_other_${runId}@corp.com`;

  let token: string;
  let tenantId: string | undefined;
  let otherToken: string;
  let otherTenantId: string | undefined;
  let accountId: string;
  let accountId2: string;

  async function cleanupTestData() {
    const ids = [tenantId, otherTenantId].filter((id): id is string => Boolean(id));
    if (ids.length > 0) {
      await deleteAuditLogs(prisma, { tenantId: { in: ids } });
    }
    await deleteTenantBySlug(prisma, tenantSlug).catch(() => {});
    await deleteTenantBySlug(prisma, otherTenantSlug).catch(() => {});
    await deleteUserByEmail(prisma, adminEmail).catch(() => {});
    await deleteUserByEmail(prisma, otherAdminEmail).catch(() => {});
    await dropTenantSchema(prisma, tenantSchema).catch(() => {});
    await dropTenantSchema(prisma, otherTenantSchema).catch(() => {});
  }

  beforeAll(async () => {
    await prisma.$connect();
    await ensureTenantTableExists(prisma);
    await ensureUserTableExists(prisma);
    await cleanupTestData();

    const onboarded = await onboardTenant(prisma, {
      companyName: 'Audit Filter Corp',
      slug: tenantSlug,
      adminEmail,
      adminPassword: 'Password123!',
      adminName: 'Audit Filter Admin',
    });
    token = onboarded.token;
    tenantId = onboarded.tenant.id;

    const otherOnboarded = await onboardTenant(prisma, {
      companyName: 'Audit Filter Corp Other',
      slug: otherTenantSlug,
      adminEmail: otherAdminEmail,
      adminPassword: 'Password123!',
      adminName: 'Audit Filter Other Admin',
    });
    otherToken = otherOnboarded.token;
    otherTenantId = otherOnboarded.tenant.id;

    const created1 = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ code: 'AF-1000', name: 'Filter Test Account One', type: 'ASSET' });
    accountId = created1.body.data.account.id;

    const created2 = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ code: 'AF-1001', name: 'Filter Test Account Two', type: 'ASSET' });
    accountId2 = created2.body.data.account.id;

    // Update account one twice so it has a real {field: {from, to}} diff to
    // assert the CSV export's human-readable Changes formatting against.
    await request(app)
      .put(`/api/v1/accounts/${accountId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ name: 'Filter Test Account One Renamed' });
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  describe('Tenant-scoped GET /audit-logs', () => {
    it('filters by exact entityId, ignoring other entities', async () => {
      const res = await request(app)
        .get('/api/v1/audit-logs')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', tenantSlug)
        .query({ entityId: accountId });

      expect(res.status).toBe(200);
      expect(res.body.data.logs.length).toBeGreaterThan(0);
      for (const log of res.body.data.logs) {
        expect(log.entityId).toBe(accountId);
      }
      expect(res.body.data.logs.some((l: any) => l.entityId === accountId2)).toBe(false);
    });

    it('filters by ipAddress substring', async () => {
      const all = await request(app)
        .get('/api/v1/audit-logs')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', tenantSlug)
        .query({ entityId: accountId });
      const realIp: string = all.body.data.logs[0].ipAddress;
      expect(realIp).toBeTruthy();

      const res = await request(app)
        .get('/api/v1/audit-logs')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', tenantSlug)
        .query({ ipAddress: realIp.slice(0, 4) });

      expect(res.status).toBe(200);
      expect(res.body.data.logs.length).toBeGreaterThan(0);
      for (const log of res.body.data.logs) {
        expect(log.ipAddress).toContain(realIp.slice(0, 4));
      }
    });

    it('meta/values returns real distinct action/entity values scoped to the tenant', async () => {
      const res = await request(app)
        .get('/api/v1/audit-logs/meta/values')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', tenantSlug);

      expect(res.status).toBe(200);
      expect(res.body.data.actions).toEqual(expect.arrayContaining(['ACCOUNT.CREATED', 'ACCOUNT.UPDATED']));
      expect(res.body.data.entities).toEqual(expect.arrayContaining(['Account']));
    });

    it('CSV export renders the Changes column as human-readable text, not raw JSON', async () => {
      const res = await request(app)
        .get('/api/v1/audit-logs/export')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', tenantSlug)
        .query({ entityId: accountId, action: 'ACCOUNT.UPDATED' });

      expect(res.status).toBe(200);
      const csv = res.text;
      expect(csv).toContain('name:');
      expect(csv).toContain('→');
      expect(csv).not.toContain('{"name"'); // not raw JSON
    });
  });

  describe('Tenant isolation on the new filters', () => {
    it('entityId filter never leaks another tenant\'s audit rows', async () => {
      const res = await request(app)
        .get('/api/v1/audit-logs')
        .set('Authorization', `Bearer ${otherToken}`)
        .set('X-Tenant-ID', otherTenantSlug)
        .query({ entityId: accountId });

      expect(res.status).toBe(200);
      expect(res.body.data.logs).toHaveLength(0);
    });
  });
});
