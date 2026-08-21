import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { deleteTenantBySlug } from '../repository/tenantRepository';
import { deleteUserByEmail } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';

jest.setTimeout(180000);

describe('POST /api/v1/tenants/admin-onboard - pre-verified contracted-client onboarding', () => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tenantSlug = `admin-onboard-corp-${runId}`;
  const tenantSchema = `tenant_admin_onboard_corp_${runId}`;
  const adminEmail = `admin_adminonboard_${runId}@corp.com`;

  async function cleanupTestData() {
    await deleteTenantBySlug(prisma, tenantSlug).catch(() => {});
    await deleteUserByEmail(prisma, adminEmail).catch(() => {});
    await dropTenantSchema(prisma, tenantSchema).catch(() => {});
  }

  beforeAll(async () => {
    await prisma.$connect();
    await cleanupTestData();
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it('rejects a missing/invalid passcode', async () => {
    const res = await request(app)
      .post('/api/v1/tenants/admin-onboard')
      .send({
        passcode: 'not-the-real-passcode',
        companyName: 'Admin Onboard Corp',
        slug: tenantSlug,
        adminEmail,
        adminPassword: 'Password123!',
        adminName: 'Contracted Client Admin',
      });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('onboards a pre-verified tenant with the real passcode, and the admin can log in immediately', async () => {
    const validPasscode = process.env.BROADCAST_MASTER_SECRET;
    if (!validPasscode) {
      throw new Error('BROADCAST_MASTER_SECRET must be set in the test environment to run this suite.');
    }

    const res = await request(app)
      .post('/api/v1/tenants/admin-onboard')
      .send({
        passcode: validPasscode,
        companyName: 'Admin Onboard Corp',
        slug: tenantSlug,
        adminEmail,
        adminPassword: 'Password123!',
        adminName: 'Contracted Client Admin',
        baseCurrency: 'GHS',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.tenant.slug).toBe(tenantSlug);
    expect(res.body.data.admin.email).toBe(adminEmail);

    // The core behavior this feature exists for: no verification round-trip.
    const dbUser = await prisma.user.findUnique({ where: { email: adminEmail } });
    expect(dbUser?.isActive).toBe(true);
    expect(dbUser?.isEmailVerified).toBe(true);
    expect(dbUser?.isPhoneVerified).toBe(true);
    expect(dbUser?.emailVerificationToken).toBeNull();
    expect(dbUser?.smsVerificationCode).toBeNull();

    // A real, immediate login works - no /auth/verify step required first.
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: adminEmail, password: 'Password123!' });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.success).toBe(true);
    expect(loginRes.body.data.token).toBeTruthy();

    const auditRows = await prisma.auditLog.findMany({
      where: { tenantId: res.body.data.tenant.id, action: 'TENANT.ADMIN_ONBOARDED' },
    });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].details).toContain(adminEmail);
  });

  it('rejects a duplicate email exactly like the self-serve endpoint does', async () => {
    const validPasscode = process.env.BROADCAST_MASTER_SECRET as string;

    const res = await request(app)
      .post('/api/v1/tenants/admin-onboard')
      .send({
        passcode: validPasscode,
        companyName: 'Duplicate Admin Onboard Corp',
        slug: `${tenantSlug}-dup`,
        adminEmail, // same email as the tenant already onboarded above
        adminPassword: 'Password123!',
        adminName: 'Duplicate Admin',
      });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);

    await deleteTenantBySlug(prisma, `${tenantSlug}-dup`).catch(() => {});
    await dropTenantSchema(prisma, `${tenantSchema}_dup`).catch(() => {});
  });

  it('cannot skip verification through the public self-serve endpoint by sending skipVerification in the body', async () => {
    const smuggleSlug = `${tenantSlug}-smuggle`;
    const smuggleEmail = `admin_smuggle_${runId}@corp.com`;

    const res = await request(app)
      .post('/api/v1/tenants/onboard')
      .send({
        companyName: 'Smuggle Corp',
        slug: smuggleSlug,
        adminEmail: smuggleEmail,
        adminPassword: 'Password123!',
        adminName: 'Smuggle Admin',
        termsAccepted: true,
        acceptedTermsVersion: 'v1.0.0',
        skipVerification: true, // not a real DTO field - must be ignored entirely
      });

    expect(res.status).toBe(201);
    const dbUser = await prisma.user.findUnique({ where: { email: smuggleEmail } });
    expect(dbUser?.isActive).toBe(false);
    expect(dbUser?.isEmailVerified).toBe(false);
    expect(dbUser?.isPhoneVerified).toBe(false);

    await deleteTenantBySlug(prisma, smuggleSlug).catch(() => {});
    await deleteUserByEmail(prisma, smuggleEmail).catch(() => {});
    await dropTenantSchema(prisma, `${tenantSchema}_smuggle`).catch(() => {});
  });
});
