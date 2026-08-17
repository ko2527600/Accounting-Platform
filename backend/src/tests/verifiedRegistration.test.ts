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

  it('1b. should NOT verify phone with the legacy hardcoded "1234" bypass code', async () => {
    const res = await request(app)
      .post('/api/v1/auth/verify')
      .send({
        email: testEmail,
        smsCode: '1234',
      });

    expect(res.status).toBe(200);
    expect(res.body.data.isPhoneVerified).toBe(false);

    const dbUser = await prisma.user.findUnique({ where: { email: testEmail } });
    expect(dbUser?.isPhoneVerified).toBe(false);
    expect(dbUser?.isActive).toBe(false);
  });

  it('1c. POST /api/v1/auth/resend-verification - should regenerate tokens and resend for an unverified account', async () => {
    const dbUserBefore = await prisma.user.findUnique({ where: { email: testEmail } });
    expect(dbUserBefore).not.toBeNull();

    const res = await request(app)
      .post('/api/v1/auth/resend-verification')
      .send({ email: testEmail });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.emailResent).toBe(true);
    expect(res.body.data.smsResent).toBe(true);

    const dbUserAfter = await prisma.user.findUnique({ where: { email: testEmail } });
    // A fresh token/code should have been generated - proves this isn't a no-op.
    expect(dbUserAfter?.emailVerificationToken).not.toBe(dbUserBefore?.emailVerificationToken);
    expect(dbUserAfter?.smsVerificationCode).not.toBe(dbUserBefore?.smsVerificationCode);
    // Account still stays inactive/unverified - resending never verifies anything by itself.
    expect(dbUserAfter?.isActive).toBe(false);
  });

  it('1d. POST /api/v1/auth/resend-verification - should 404 for an unknown email', async () => {
    const res = await request(app)
      .post('/api/v1/auth/resend-verification')
      .send({ email: `no-such-user-${timestamp}@example.com` });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
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

  it('3. POST /api/v1/auth/resend-verification - should reject a fully-verified account', async () => {
    const res = await request(app)
      .post('/api/v1/auth/resend-verification')
      .send({ email: testEmail });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
