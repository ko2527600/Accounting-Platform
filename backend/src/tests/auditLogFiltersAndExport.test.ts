import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';

describe('Audit Logs API - filtering and CSV export', () => {
  const runId = Date.now();
  const tenant1Slug = `audit-filter-corp-1-${runId}`;
  const tenant1Schema = `tenant_audit_filter_corp_1_${runId}`;
  const admin1Email = `admin_auditfilter1_${runId}@corp1.com`;

  const tenant2Slug = `audit-filter-corp-2-${runId}`;
  const tenant2Schema = `tenant_audit_filter_corp_2_${runId}`;
  const admin2Email = `admin_auditfilter2_${runId}@corp2.com`;

  let token1: string;
  let tenant1Id: string;
  let tenant2Id: string;

  async function cleanupTestData() {
    const ids = [tenant1Id, tenant2Id].filter(Boolean);
    if (ids.length > 0) {
      await prisma.auditLog.deleteMany({ where: { tenantId: { in: ids } } }).catch(() => {});
    }
    await deleteTenantBySlug(prisma, tenant1Slug).catch(() => {});
    await deleteTenantBySlug(prisma, tenant2Slug).catch(() => {});
    await deleteUserByEmail(prisma, admin1Email).catch(() => {});
    await deleteUserByEmail(prisma, admin2Email).catch(() => {});
    await dropTenantSchema(prisma, tenant1Schema).catch(() => {});
    await dropTenantSchema(prisma, tenant2Schema).catch(() => {});
  }

  beforeAll(async () => {
    await prisma.$connect();
    await ensureTenantTableExists(prisma);
    await ensureUserTableExists(prisma);
    await cleanupTestData();

    const onboard1 = await onboardTenant(prisma, {
      companyName: 'Audit Filter Corp 1',
      slug: tenant1Slug,
      adminEmail: admin1Email,
      adminPassword: 'Password123!',
      adminName: 'Audit Filter Corp 1 Admin',
    });
    token1 = onboard1.token;
    tenant1Id = onboard1.tenant.id;

    const onboard2 = await onboardTenant(prisma, {
      companyName: 'Audit Filter Corp 2',
      slug: tenant2Slug,
      adminEmail: admin2Email,
      adminPassword: 'Password123!',
      adminName: 'Audit Filter Corp 2 Admin',
    });
    tenant2Id = onboard2.tenant.id;

    // A varied set of tenant 1 entries to filter against.
    await prisma.auditLog.create({
      data: {
        tenantId: tenant1Id,
        action: 'JOURNAL_ENTRY.POSTED',
        entity: 'JournalEntry',
        userEmail: 'accountant@corp1.com',
        details: 'Posted entry JE-1',
        changes: { status: { from: 'DRAFT', to: 'POSTED' } },
        createdAt: new Date('2020-01-15T10:00:00.000Z'),
      },
    });
    await prisma.auditLog.create({
      data: {
        tenantId: tenant1Id,
        action: 'INVOICE.PAID',
        entity: 'Invoice',
        userEmail: 'cashier@corp1.com',
        details: 'Paid invoice INV-1',
        createdAt: new Date('2020-06-20T10:00:00.000Z'),
      },
    });
    // One entry that belongs to tenant 2 - must never leak into tenant 1's
    // filtered results or CSV export.
    await prisma.auditLog.create({
      data: {
        tenantId: tenant2Id,
        action: 'JOURNAL_ENTRY.POSTED',
        entity: 'JournalEntry',
        userEmail: 'accountant@corp2.com',
        details: 'Tenant 2 SECRET entry',
        createdAt: new Date('2020-01-15T10:00:00.000Z'),
      },
    });
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it('filters by action (case-insensitive substring)', async () => {
    const res = await request(app)
      .get('/api/v1/audit-logs')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .query({ action: 'journal_entry' });

    expect(res.status).toBe(200);
    const details = res.body.data.logs.map((l: any) => l.details);
    expect(details).toContain('Posted entry JE-1');
    expect(details).not.toContain('Paid invoice INV-1');
  });

  it('filters by entity', async () => {
    const res = await request(app)
      .get('/api/v1/audit-logs')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .query({ entity: 'Invoice' });

    expect(res.status).toBe(200);
    const details = res.body.data.logs.map((l: any) => l.details);
    expect(details).toContain('Paid invoice INV-1');
    expect(details).not.toContain('Posted entry JE-1');
  });

  it('filters by userEmail', async () => {
    const res = await request(app)
      .get('/api/v1/audit-logs')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .query({ userEmail: 'cashier@corp1.com' });

    expect(res.status).toBe(200);
    const details = res.body.data.logs.map((l: any) => l.details);
    expect(details).toContain('Paid invoice INV-1');
    expect(details).not.toContain('Posted entry JE-1');
  });

  it('filters by createdAt date range', async () => {
    const res = await request(app)
      .get('/api/v1/audit-logs')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .query({ dateFrom: '2020-01-01', dateTo: '2020-02-01' });

    expect(res.status).toBe(200);
    const details = res.body.data.logs.map((l: any) => l.details);
    expect(details).toContain('Posted entry JE-1');
    expect(details).not.toContain('Paid invoice INV-1');
  });

  it('rejects a malformed date filter', async () => {
    const res = await request(app)
      .get('/api/v1/audit-logs')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .query({ dateFrom: 'not-a-date' });

    expect(res.status).toBe(400);
  });

  it('GET /audit-logs/export returns a real CSV containing only this tenant\'s matching rows', async () => {
    const res = await request(app)
      .get('/api/v1/audit-logs/export')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .query({ action: 'journal_entry' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const csv = res.text;
    expect(csv.split('\r\n')[0]).toBe(
      'Timestamp,Action,Entity,Entity ID,User Email,User ID,IP Address,Details,Changes'
    );
    expect(csv).toContain('Posted entry JE-1');
    // Tenant isolation regression check - never leak another tenant's row
    // into this tenant's export, even though it matched the same filter.
    expect(csv).not.toContain('Tenant 2 SECRET entry');
    expect(csv).not.toContain('Paid invoice INV-1');
    // The structured changes diff is exported too, not just the free-text details.
    expect(csv).toContain('"status"');
  });
});
