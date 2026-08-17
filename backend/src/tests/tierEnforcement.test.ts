import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';

describe('Plan tiers (Shop/Business/Enterprise) - feature gating, admin upgrade, and seat limits', () => {
  const runId = Date.now();
  const tenantSlug = `tier-corp-${runId}`;
  const tenantSchema = `tenant_tier_corp_${runId}`;
  const adminEmail = `admin_tier_${runId}@corp.com`;
  const masterPasscode = process.env.BROADCAST_MASTER_SECRET;

  let adminToken: string;
  let tenantId: string;

  async function cleanupTestData() {
    if (tenantId) {
      await prisma.user.deleteMany({ where: { tenantId, email: { not: adminEmail } } }).catch(() => {});
    }
    await deleteTenantBySlug(prisma, tenantSlug).catch(() => {});
    await deleteUserByEmail(prisma, adminEmail).catch(() => {});
    await dropTenantSchema(prisma, tenantSchema).catch(() => {});
  }

  beforeAll(async () => {
    await prisma.$connect();
    await ensureTenantTableExists(prisma);
    await ensureUserTableExists(prisma);
    await cleanupTestData();

    const onboard = await onboardTenant(prisma, {
      companyName: 'Tier Corp',
      slug: tenantSlug,
      adminEmail,
      adminPassword: 'Password123!',
      adminName: 'Tier Admin',
    });
    adminToken = onboard.token;
    tenantId = onboard.tenant.id;
  }, 60000);

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it('a newly onboarded tenant defaults to the Shop plan (tier 1)', async () => {
    const res = await request(app)
      .get('/api/v1/tenants/current')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);
    expect(res.status).toBe(200);
    expect(res.body.data.tenant.tier).toBe(1);
  });

  describe('Business-tier routes are blocked on the Shop plan', () => {
    const cases: [string, string][] = [
      ['GET', '/api/v1/banking/accounts'],
      ['GET', '/api/v1/recurring-transactions'],
      ['GET', '/api/v1/budgets'],
      ['GET', '/api/v1/approval-workflows'],
    ];

    it.each(cases)('%s %s returns 403 with upgradeRequired', async (method, path) => {
      const res = await (request(app) as any)
        [method.toLowerCase()](path)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug);
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.upgradeRequired).toBe(true);
      expect(res.body.error).toContain('Business plan');
    });
  });

  describe('Admin plan-tier management (PUT /tenants/:id/tier)', () => {
    it('rejects a missing/invalid master passcode', async () => {
      const res = await request(app).put(`/api/v1/tenants/${tenantId}/tier`).send({ tier: 2, passcode: 'wrong-passcode' });
      expect(res.status).toBe(401);
    });

    (masterPasscode ? it : it.skip)('rejects an invalid tier value', async () => {
      const res = await request(app).put(`/api/v1/tenants/${tenantId}/tier`).send({ tier: 99, passcode: masterPasscode });
      expect(res.status).toBe(400);
    });

    (masterPasscode ? it : it.skip)('upgrades the tenant to Business (tier 2), and Business-tier routes succeed afterward', async () => {
      const upgrade = await request(app).put(`/api/v1/tenants/${tenantId}/tier`).send({ tier: 2, passcode: masterPasscode });
      expect(upgrade.status).toBe(200);
      expect(upgrade.body.data.tenant.tier).toBe(2);

      const res = await request(app)
        .get('/api/v1/recurring-transactions')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug);
      expect(res.status).toBe(200);
    });

    (masterPasscode ? it : it.skip)('downgrades back to Shop (tier 1) so later tests in this file are unaffected', async () => {
      const res = await request(app).put(`/api/v1/tenants/${tenantId}/tier`).send({ tier: 1, passcode: masterPasscode });
      expect(res.status).toBe(200);
      expect(res.body.data.tenant.tier).toBe(1);
    });
  });

  describe('Seat limits (POST /tenants/invite)', () => {
    it('blocks inviting beyond the Shop plan seat limit (3 active members)', async () => {
      // Admin already counts as 1 active member. Directly seed 2 more active
      // users (bypassing the full invite-accept flow, which isn't the thing
      // under test here) to reach the Shop plan's cap of 3.
      await prisma.user.createMany({
        data: [
          { email: `seat1_${runId}@corp.com`, password: 'x', name: 'Seat One', role: 'Accountant', tenantId, isActive: true, isEmailVerified: true },
          { email: `seat2_${runId}@corp.com`, password: 'x', name: 'Seat Two', role: 'Accountant', tenantId, isActive: true, isEmailVerified: true },
        ],
      });

      const res = await request(app)
        .post('/api/v1/tenants/invite')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({ email: `overcap_${runId}@corp.com`, role: 'Accountant' });

      expect(res.status).toBe(403);
      expect(res.body.upgradeRequired).toBe(true);
      expect(res.body.error).toContain('Shop plan is limited to 3');
    });
  });
});
