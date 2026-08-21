import { deleteAuditLogs } from './testHelpers';
import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';

describe('Compliance update tracking (Phase 4 trust feature - provable, not just claimed)', () => {
  const runId = Date.now();
  const tenantSlug = `compliance-corp-${runId}`;
  const tenantSchema = `tenant_compliance_corp_${runId}`;
  const adminEmail = `admin_compliance_${runId}@corp.com`;

  let adminToken: string;
  let tenantId: string;
  let originalPasscode: string | undefined;

  async function cleanupTestData() {
    if (tenantId) {
      await deleteAuditLogs(prisma, { tenantId });
    }
    await prisma.complianceUpdate.deleteMany({ where: { area: `Test Area ${runId}` } }).catch(() => {});
    await deleteTenantBySlug(prisma, tenantSlug).catch(() => {});
    await deleteUserByEmail(prisma, adminEmail).catch(() => {});
    await dropTenantSchema(prisma, tenantSchema).catch(() => {});
  }

  beforeAll(async () => {
    originalPasscode = process.env.BROADCAST_MASTER_SECRET;
    process.env.BROADCAST_MASTER_SECRET = 'test-master-passcode';

    await prisma.$connect();
    await ensureTenantTableExists(prisma);
    await ensureUserTableExists(prisma);
    await cleanupTestData();

    const onboard = await onboardTenant(prisma, {
      companyName: 'Compliance Corp',
      slug: tenantSlug,
      adminEmail,
      adminPassword: 'Password123!',
      adminName: 'Compliance Admin',
    });
    adminToken = onboard.token;
    tenantId = onboard.tenant.id;
  }, 60000);

  afterAll(async () => {
    await cleanupTestData();
    if (originalPasscode === undefined) delete process.env.BROADCAST_MASTER_SECRET;
    else process.env.BROADCAST_MASTER_SECRET = originalPasscode;
    await prisma.$disconnect();
  });

  describe('GET /api/v1/compliance/last-update', () => {
    it('returns a real, dated verification record to any authenticated tenant user', async () => {
      const res = await request(app)
        .get('/api/v1/compliance/last-update')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug);

      expect(res.status).toBe(200);
      expect(res.body.data.source).toBe('Ghana Revenue Authority (gra.gov.gh)');
      expect(res.body.data.verifiedAt).toBeTruthy();
    });

    it('rejects an unauthenticated request', async () => {
      const res = await request(app).get('/api/v1/compliance/last-update');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/v1/compliance/updates', () => {
    it('rejects a request with no passcode, even from a valid tenant Admin JWT', async () => {
      const res = await request(app)
        .post('/api/v1/compliance/updates')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          source: 'Test Source',
          area: `Test Area ${runId}`,
          description: 'Should be rejected - a tenant Admin must never be able to write platform-wide compliance claims.',
          verifiedAt: new Date().toISOString(),
        });

      expect(res.status).toBe(401);
    });

    it('records a new verification event with a valid passcode, which then becomes the last update', async () => {
      const verifiedAt = new Date().toISOString();
      const createRes = await request(app)
        .post('/api/v1/compliance/updates')
        .send({
          passcode: 'test-master-passcode',
          source: 'Test Source',
          area: `Test Area ${runId}`,
          description: 'A real, dated test verification event.',
          verifiedAt,
          verifiedBy: 'test-suite',
        });

      expect(createRes.status).toBe(201);
      expect(createRes.body.data.area).toBe(`Test Area ${runId}`);

      const latestRes = await request(app)
        .get('/api/v1/compliance/last-update')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug);
      expect(latestRes.body.data.area).toBe(`Test Area ${runId}`);

      const historyRes = await request(app)
        .get('/api/v1/compliance/updates')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug);
      expect(historyRes.body.data.length).toBeGreaterThanOrEqual(2);
    });
  });
});
