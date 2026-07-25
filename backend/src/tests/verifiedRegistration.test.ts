import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';

jest.setTimeout(180000);

describe('Verified Registration Flow Suite (Email & SMS)', () => {
  const timestamp = Date.now();
  const testEmail = `verify.user.${timestamp}@example.com`;
  const testCompany = `Verify Company ${timestamp}`;
  const testSlug = `verify-slug-${timestamp}`;

  it('1. should register a new tenant and user with inactive status and verification tokens', async () => {
    const res = await request(app)
      .post('/api/v1/tenants/onboard')
      .send({
        companyName: testCompany,
        slug: testSlug,
        email: testEmail,
        password: 'Password123!',
        adminName: 'Unverified Admin',
        phone: '+233201234567',
        termsAccepted: true,
        acceptedTermsVersion: 'v1.0.0',
      });

    expect(res.status).toBe(201);

    // Query user in DB
    const dbUser = await prisma.user.findUnique({ where: { email: testEmail } });
    expect(dbUser).not.toBeNull();
    expect(dbUser?.isActive).toBe(false);
    expect(dbUser?.isEmailVerified).toBe(false);
    expect(dbUser?.isPhoneVerified).toBe(false);
    expect(dbUser?.emailVerificationToken).toBeDefined();
    expect(dbUser?.smsVerificationCode).toBeDefined();
  });

  it('2. POST /api/v1/auth/verify - should verify SMS code and activate user account', async () => {
    const dbUserBefore = await prisma.user.findUnique({ where: { email: testEmail } });
    expect(dbUserBefore).not.toBeNull();

    const res = await request(app)
      .post('/api/v1/auth/verify')
      .send({
        email: testEmail,
        emailVerificationToken: dbUserBefore?.emailVerificationToken,
        smsCode: dbUserBefore?.smsVerificationCode,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.isEmailVerified).toBe(true);
    expect(res.body.data.isPhoneVerified).toBe(true);
    expect(res.body.data.isActive).toBe(true);

    // Verify DB update
    const dbUserAfter = await prisma.user.findUnique({ where: { email: testEmail } });
    expect(dbUserAfter?.isActive).toBe(true);
    expect(dbUserAfter?.isEmailVerified).toBe(true);
    expect(dbUserAfter?.isPhoneVerified).toBe(true);
  });
});
