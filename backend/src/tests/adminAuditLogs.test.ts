import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';

describe('GET /api/v1/admin/audit-logs (platform-wide, passcode-gated)', () => {
  const runId = Date.now();
  const tenant1Slug = `adminaudit-corp-1-${runId}`;
  const tenant1Schema = `tenant_adminaudit_corp_1_${runId}`;
  const admin1Email = `admin_adminaudit1_${runId}@corp1.com`;

  const tenant2Slug = `adminaudit-corp-2-${runId}`;
  const tenant2Schema = `tenant_adminaudit_corp_2_${runId}`;
  const admin2Email = `admin_adminaudit2_${runId}@corp2.com`;

  let token1: string;
  let token2: string;
  let tenant1Id: string | undefined;
  let tenant2Id: string | undefined;
  let originalPasscode: string | undefined;

  async function cleanupTestData() {
    const ids = [tenant1Id, tenant2Id].filter((id): id is string => Boolean(id));
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
    originalPasscode = process.env.BROADCAST_MASTER_SECRET;
    process.env.BROADCAST_MASTER_SECRET = 'test-master-passcode';

    await prisma.$connect();
    await ensureTenantTableExists(prisma);
    await ensureUserTableExists(prisma);
    await cleanupTestData();

    const onboard1 = await onboardTenant(prisma, {
      companyName: 'Admin Audit Corp 1',
      slug: tenant1Slug,
      adminEmail: admin1Email,
      adminPassword: 'Password123!',
      adminName: 'Admin Audit Corp 1 Admin',
    });
    token1 = onboard1.token;
    tenant1Id = onboard1.tenant.id;

    const onboard2 = await onboardTenant(prisma, {
      companyName: 'Admin Audit Corp 2',
      slug: tenant2Slug,
      adminEmail: admin2Email,
      adminPassword: 'Password123!',
      adminName: 'Admin Audit Corp 2 Admin',
    });
    token2 = onboard2.token;
    tenant2Id = onboard2.tenant.id;

    // Generate a real audit log entry for each tenant via a real action
    // (fiscal period creation logs nothing, so use an existing audited action -
    // account creation doesn't audit either; simplest reliable audited action
    // in this codebase is a failed login, or directly seed via prisma to keep
    // this test focused on the read endpoint rather than which actions audit).
    await prisma.auditLog.create({
      data: { tenantId: tenant1Id, action: 'TEST_ACTION', entity: 'TEST_ENTITY', details: 'Tenant 1 event' },
    });
    await prisma.auditLog.create({
      data: { tenantId: tenant2Id, action: 'TEST_ACTION', entity: 'TEST_ENTITY', details: 'Tenant 2 event' },
    });
  }, 120000);

  afterAll(async () => {
    process.env.BROADCAST_MASTER_SECRET = originalPasscode;
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it('rejects requests with no passcode or a wrong one', async () => {
    const noPasscode = await request(app).get('/api/v1/admin/audit-logs');
    expect(noPasscode.status).toBe(401);

    const wrongPasscode = await request(app).get('/api/v1/admin/audit-logs').query({ passcode: 'wrong' });
    expect(wrongPasscode.status).toBe(401);
  });

  it('returns logs across ALL tenants with tenant name/slug joined, given the correct passcode', async () => {
    const res = await request(app)
      .get('/api/v1/admin/audit-logs')
      .query({ passcode: 'test-master-passcode', limit: '200' });

    expect(res.status).toBe(200);
    const logs = res.body.data.logs;

    const tenant1Log = logs.find((l: any) => l.details === 'Tenant 1 event');
    const tenant2Log = logs.find((l: any) => l.details === 'Tenant 2 event');
    expect(tenant1Log).toBeDefined();
    expect(tenant2Log).toBeDefined();
    expect(tenant1Log.tenant?.slug).toBe(tenant1Slug);
    expect(tenant2Log.tenant?.slug).toBe(tenant2Slug);
  });

  it('accepts the passcode via the x-admin-passcode header as an alternative to the query param', async () => {
    const res = await request(app)
      .get('/api/v1/admin/audit-logs')
      .set('x-admin-passcode', 'test-master-passcode');
    expect(res.status).toBe(200);
  });

  it('supports pagination', async () => {
    const res = await request(app)
      .get('/api/v1/admin/audit-logs')
      .query({ passcode: 'test-master-passcode', limit: '1', page: '1' });
    expect(res.status).toBe(200);
    expect(res.body.data.logs.length).toBe(1);
    expect(res.body.data.pagination.limit).toBe(1);
    expect(res.body.data.pagination.total).toBeGreaterThanOrEqual(2);
  });

  it("a tenant's own JWT does not grant access to the platform-wide endpoint (no passcode present)", async () => {
    const res = await request(app)
      .get('/api/v1/admin/audit-logs')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug);
    expect(res.status).toBe(401);
  });
});
