import { deleteAuditLogs } from './testHelpers';
import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';

/**
 * Regression test for a cross-tenant leak found on 2026-07-25 while
 * continuing the earlier tenant-isolation fix: AuditLog had no tenant_id
 * column at all, and GET /api/v1/audit-logs queried it with no tenant
 * filter, so every tenant's audit trail (including operational events like
 * SMS gateway failures and email dispatch logs) was visible to any
 * Auditor-role user in any tenant.
 */
describe('Audit Logs API - tenant isolation', () => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tenant1Slug = `audit-corp-1-${runId}`;
  const tenant1Schema = `tenant_audit_corp_1_${runId}`;
  const admin1Email = `admin_audit1_${runId}@corp1.com`;

  const tenant2Slug = `audit-corp-2-${runId}`;
  const tenant2Schema = `tenant_audit_corp_2_${runId}`;
  const admin2Email = `admin_audit2_${runId}@corp2.com`;

  let token1: string;
  let token2: string;
  let tenant1Id: string;
  let tenant2Id: string;

  async function cleanupTestData() {
    await deleteAuditLogs(prisma, { tenantId: { in: [tenant1Id, tenant2Id].filter(Boolean) } });
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
      companyName: 'Audit Isolation Corp 1',
      slug: tenant1Slug,
      adminEmail: admin1Email,
      adminPassword: 'Password123!',
      adminName: 'Audit Corp 1 Admin',
    });
    token1 = onboard1.token;
    tenant1Id = onboard1.tenant.id;

    const onboard2 = await onboardTenant(prisma, {
      companyName: 'Audit Isolation Corp 2',
      slug: tenant2Slug,
      adminEmail: admin2Email,
      adminPassword: 'Password123!',
      adminName: 'Audit Corp 2 Admin',
    });
    token2 = onboard2.token;
    tenant2Id = onboard2.tenant.id;

    // Directly seed one audit log entry per tenant (bypassing the actual
    // services, since sendMail short-circuits before logging in test env).
    await prisma.auditLog.create({
      data: { tenantId: tenant1Id, action: 'EMAIL_SENT', entity: 'EMAIL_SERVICE', details: 'Tenant 1 SECRET audit entry' },
    });
    await prisma.auditLog.create({
      data: { tenantId: tenant2Id, action: 'EMAIL_SENT', entity: 'EMAIL_SERVICE', details: 'Tenant 2 SECRET audit entry' },
    });
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it('does not return another tenant\'s audit log entries', async () => {
    const asTenant1 = await request(app)
      .get('/api/v1/audit-logs')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug);

    expect(asTenant1.status).toBe(200);
    const details1 = asTenant1.body.data.logs.map((l: any) => l.details);
    expect(details1).toContain('Tenant 1 SECRET audit entry');
    expect(details1).not.toContain('Tenant 2 SECRET audit entry');

    const asTenant2 = await request(app)
      .get('/api/v1/audit-logs')
      .set('Authorization', `Bearer ${token2}`)
      .set('X-Tenant-ID', tenant2Slug);

    expect(asTenant2.status).toBe(200);
    const details2 = asTenant2.body.data.logs.map((l: any) => l.details);
    expect(details2).toContain('Tenant 2 SECRET audit entry');
    expect(details2).not.toContain('Tenant 1 SECRET audit entry');
  });
});
