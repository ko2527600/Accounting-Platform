import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';
import crypto from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Decode(secret: string): Buffer {
  const cleaned = secret.toUpperCase().replace(/=+$/, '');
  let bits = '';
  for (const char of cleaned) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) continue;
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

/**
 * Test-only TOTP generator, standing in for a real authenticator app (which
 * these tests obviously can't drive). Deliberately reimplements RFC 6238
 * independently rather than importing utils/totp.ts's own hotp()/verifyTotpCode(),
 * so a bug shared between "generate" and "verify" here wouldn't silently
 * self-cancel. RFC-correctness of the algorithm itself is checked separately
 * against Python's pyotp (see the ad-hoc cross-check run during development).
 */
function generateTestTotpCode(secret: string, stepOffset = 0): string {
  const secretBytes = base32Decode(secret);
  const step = Math.floor(Date.now() / 1000 / 30) + stepOffset;
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeUInt32BE(Math.floor(step / 2 ** 32), 0);
  counterBuffer.writeUInt32BE(step % 2 ** 32, 4);
  const digest = crypto.createHmac('sha1', secretBytes).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0xf;
  const truncated =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return (truncated % 1000000).toString().padStart(6, '0');
}

describe('MFA / TOTP login', () => {
  const runId = Date.now();
  const tenantSlug = `mfa-corp-${runId}`;
  const tenantSchema = `tenant_mfa_corp_${runId}`;
  const adminEmail = `mfa_admin_${runId}@corp.com`;
  const adminPassword = 'Password123!';

  let adminToken: string;
  let tenantId: string;
  let userId: string;

  async function cleanupTestData() {
    if (tenantId) {
      await prisma.auditLog.deleteMany({ where: { tenantId } }).catch(() => {});
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

    // admin-onboard (not the self-serve /tenants/onboard) is required here,
    // not just convenient: self-serve onboarding creates the admin pending
    // email/SMS verification (isActive: false), which POST /login correctly
    // rejects with "account deactivated" - these tests need a real,
    // repeatable POST /login, not just the one-time bootstrap token
    // onboardTenant() itself returns, so the account must be pre-verified.
    const onboard = await request(app).post('/api/v1/tenants/admin-onboard').send({
      passcode: process.env.BROADCAST_MASTER_SECRET,
      companyName: 'MFA Corp',
      slug: tenantSlug,
      adminEmail,
      adminPassword,
      adminName: 'MFA Admin',
    });
    if (onboard.status !== 201) {
      throw new Error(`admin-onboard failed in test setup: ${JSON.stringify(onboard.body)}`);
    }
    adminToken = onboard.body.data.token;
    tenantId = onboard.body.data.tenant.id;
    userId = onboard.body.data.admin.id;
  }, 120000);

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  afterEach(async () => {
    // Reset MFA state between tests so each test starts from a known baseline.
    await prisma.user.update({
      where: { id: userId },
      data: { isMfaEnabled: false, totpSecret: null, mfaBackupCodes: [] },
    });
  });

  it('logs in normally (no mfaRequired) when MFA is not enabled', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: adminEmail, password: adminPassword });
    expect(res.status).toBe(200);
    expect(res.body.data.token).toBeTruthy();
    expect(res.body.mfaRequired).toBeUndefined();
    expect(res.body.data.user.isMfaEnabled).toBe(false);
  });

  it('rejects /mfa/verify-setup and /mfa/disable when MFA setup was never started', async () => {
    const verifyRes = await request(app)
      .post('/api/v1/auth/mfa/verify-setup')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: '123456' });
    expect(verifyRes.status).toBe(400);

    const disableRes = await request(app)
      .post('/api/v1/auth/mfa/disable')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ password: adminPassword });
    expect(disableRes.status).toBe(400);
  });

  it('full enrollment flow: setup -> reject wrong code -> confirm with real code -> backup codes issued', async () => {
    const setupRes = await request(app)
      .post('/api/v1/auth/mfa/setup')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(setupRes.status).toBe(200);
    const { secret, otpAuthUrl, qrCodeDataUrl } = setupRes.body.data;
    expect(secret).toBeTruthy();
    expect(otpAuthUrl).toContain('otpauth://totp/');
    expect(qrCodeDataUrl).toContain('data:image/png;base64,');

    const wrongCodeRes = await request(app)
      .post('/api/v1/auth/mfa/verify-setup')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: '000000' });
    expect(wrongCodeRes.status).toBe(400);

    const realCode = generateTestTotpCode(secret);
    const confirmRes = await request(app)
      .post('/api/v1/auth/mfa/verify-setup')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: realCode });
    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.data.backupCodes).toHaveLength(10);

    const meRes = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${adminToken}`);
    expect(meRes.body.data.user.isMfaEnabled).toBe(true);
  });

  it('login for an MFA-enabled account issues a challenge, not a real token', async () => {
    const setupRes = await request(app).post('/api/v1/auth/mfa/setup').set('Authorization', `Bearer ${adminToken}`);
    const realCode = generateTestTotpCode(setupRes.body.data.secret);
    await request(app).post('/api/v1/auth/mfa/verify-setup').set('Authorization', `Bearer ${adminToken}`).send({ code: realCode });

    const loginRes = await request(app).post('/api/v1/auth/login').send({ email: adminEmail, password: adminPassword });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.mfaRequired).toBe(true);
    expect(loginRes.body.data.mfaToken).toBeTruthy();
    expect(loginRes.body.data.token).toBeUndefined();
  });

  it('rejects using the mfaToken as a real session token against a protected route', async () => {
    const setupRes = await request(app).post('/api/v1/auth/mfa/setup').set('Authorization', `Bearer ${adminToken}`);
    const realCode = generateTestTotpCode(setupRes.body.data.secret);
    await request(app).post('/api/v1/auth/mfa/verify-setup').set('Authorization', `Bearer ${adminToken}`).send({ code: realCode });

    const loginRes = await request(app).post('/api/v1/auth/login').send({ email: adminEmail, password: adminPassword });
    const { mfaToken } = loginRes.body.data;

    const meRes = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${mfaToken}`);
    expect(meRes.status).toBe(401);
  });

  it('rejects a wrong TOTP code at the verify-mfa step, then accepts the real one', async () => {
    const setupRes = await request(app).post('/api/v1/auth/mfa/setup').set('Authorization', `Bearer ${adminToken}`);
    const { secret } = setupRes.body.data;
    const realCode = generateTestTotpCode(secret);
    await request(app).post('/api/v1/auth/mfa/verify-setup').set('Authorization', `Bearer ${adminToken}`).send({ code: realCode });

    const loginRes = await request(app).post('/api/v1/auth/login').send({ email: adminEmail, password: adminPassword });
    const { mfaToken } = loginRes.body.data;

    const wrongRes = await request(app).post('/api/v1/auth/login/verify-mfa').send({ mfaToken, code: '000000' });
    expect(wrongRes.status).toBe(401);

    const nextCode = generateTestTotpCode(secret, 1);
    const rightRes = await request(app).post('/api/v1/auth/login/verify-mfa').send({ mfaToken, code: nextCode });
    expect(rightRes.status).toBe(200);
    expect(rightRes.body.data.token).toBeTruthy();
    expect(rightRes.body.data.user.isMfaEnabled).toBe(true);
  });

  it('accepts a valid backup code exactly once, then rejects it on reuse', async () => {
    const setupRes = await request(app).post('/api/v1/auth/mfa/setup').set('Authorization', `Bearer ${adminToken}`);
    const { secret } = setupRes.body.data;
    const realCode = generateTestTotpCode(secret);
    const confirmRes = await request(app)
      .post('/api/v1/auth/mfa/verify-setup')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: realCode });
    const backupCode = confirmRes.body.data.backupCodes[0];

    const loginRes = await request(app).post('/api/v1/auth/login').send({ email: adminEmail, password: adminPassword });
    const { mfaToken } = loginRes.body.data;

    const firstUseRes = await request(app).post('/api/v1/auth/login/verify-mfa').send({ mfaToken, backupCode });
    expect(firstUseRes.status).toBe(200);
    expect(firstUseRes.body.data.token).toBeTruthy();

    const login2Res = await request(app).post('/api/v1/auth/login').send({ email: adminEmail, password: adminPassword });
    const secondReuseRes = await request(app)
      .post('/api/v1/auth/login/verify-mfa')
      .send({ mfaToken: login2Res.body.data.mfaToken, backupCode });
    expect(secondReuseRes.status).toBe(401);
  });

  it('requires the correct password to disable MFA, then a subsequent login skips the challenge', async () => {
    const setupRes = await request(app).post('/api/v1/auth/mfa/setup').set('Authorization', `Bearer ${adminToken}`);
    const realCode = generateTestTotpCode(setupRes.body.data.secret);
    await request(app).post('/api/v1/auth/mfa/verify-setup').set('Authorization', `Bearer ${adminToken}`).send({ code: realCode });

    const wrongPasswordRes = await request(app)
      .post('/api/v1/auth/mfa/disable')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ password: 'totally-wrong-password' });
    expect(wrongPasswordRes.status).toBe(401);

    const disableRes = await request(app)
      .post('/api/v1/auth/mfa/disable')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ password: adminPassword });
    expect(disableRes.status).toBe(200);

    const loginRes = await request(app).post('/api/v1/auth/login').send({ email: adminEmail, password: adminPassword });
    expect(loginRes.body.mfaRequired).toBeUndefined();
    expect(loginRes.body.data.token).toBeTruthy();
  });
});
