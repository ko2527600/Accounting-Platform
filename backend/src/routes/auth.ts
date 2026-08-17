import { Router, Request, Response } from 'express';
import crypto from 'node:crypto';
import { prisma } from '../config/db';
import { hashPassword, verifyPassword } from '../utils/password';
import { validatePasswordStrength } from '../utils/passwordPolicy';
import { generateJwtToken, verifyJwtToken, computeTokenHash, evictFromJwtCache } from '../utils/jwt';
import { createUser, findUserByEmail, findUserById, UserRecord } from '../repository/userRepository';
import { authenticateJwt } from '../middleware/authMiddleware';
import { authRateLimiter } from '../middleware/rateLimiterMiddleware';
import { requireRole } from '../middleware/rbacMiddleware';
import { recordAuditLog, recordAuditLogTx } from '../services/auditLogService';
import { revokeToken } from '../services/tokenRevocationService';
import {
  generateTotpSecret,
  buildOtpAuthUrl,
  generateQrCodeDataUrl,
  verifyTotpCode,
  generateBackupCodes,
  hashBackupCode,
  matchBackupCode,
} from '../utils/totp';

const router = Router();

const VALID_ROLES = ['Admin', 'Accountant', 'Auditor', 'Viewer'];
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Constant-time comparison for secret-like values (verification codes/tokens).
 * Returns false (not a throw) whenever either side is missing/mismatched length.
 */
function timingSafeStringEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * POST /api/v1/auth/register
 * Registers a new platform/tenant user.
 */
router.post('/register', authRateLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password, name, role, tenantId } = req.body;

    if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
      res.status(400).json({
        error: 'Validation Error',
        message: 'A valid email address is required.',
      });
      return;
    }

    const passwordError = validatePasswordStrength(password);
    if (passwordError) {
      res.status(400).json({
        error: 'Validation Error',
        message: passwordError,
      });
      return;
    }

    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({
        error: 'Validation Error',
        message: 'User full name is required.',
      });
      return;
    }

    const assignedRole = role || 'Viewer';
    if (!VALID_ROLES.includes(assignedRole)) {
      res.status(400).json({
        error: 'Validation Error',
        message: `Invalid role "${role}". Allowed roles are: ${VALID_ROLES.join(', ')}`,
      });
      return;
    }

    // Check if user already exists
    const existingUser = await findUserByEmail(prisma, email);
    if (existingUser) {
      res.status(409).json({
        error: 'Conflict Error',
        message: `User with email "${email}" already exists.`,
      });
      return;
    }

    // Check if tenant exists (by ID or Slug) to satisfy foreign key constraints
    let associatedTenantId: string | null = null;
    let associatedTenantOrgType: string | undefined;
    if (tenantId) {
      const tenant = await prisma.tenant.findFirst({
        where: {
          OR: [
            { id: tenantId },
            { slug: tenantId },
          ],
        },
      });
      if (tenant) {
        associatedTenantId = tenant.id;
        associatedTenantOrgType = tenant.orgType;
      }
    }

    // Hash password and store user
    const hashedPassword = hashPassword(password);
    const user = await createUser(prisma, {
      email,
      password: hashedPassword,
      name,
      role: assignedRole,
      tenantId: associatedTenantId,
    });

    // Generate JWT token
    const tokenPayload = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      tenantId: user.tenantId || undefined,
      orgType: associatedTenantOrgType,
    };
    const token = generateJwtToken(tokenPayload);

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          tenantId: user.tenantId,
          orgType: associatedTenantOrgType,
          createdAt: user.createdAt,
        },
        token,
      },
    });
  } catch (error: any) {
    console.error('[Auth Service] Registration error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to complete user registration.',
    });
  }
});

/**
 * POST /api/v1/auth/verify
 * Validates Email verification token and/or 4-digit SMS code.
 * Account becomes Active once both are verified, triggering Welcome Email + PDF attachment.
 */
router.post('/verify', authRateLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, emailVerificationToken, smsCode } = req.body;

    if (!email) {
      res.status(400).json({ success: false, error: 'User email is required.' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: { tenant: true },
    });

    if (!user) {
      res.status(404).json({ success: false, error: 'User account not found.' });
      return;
    }

    let isEmailVerified = user.isEmailVerified;
    let isPhoneVerified = user.isPhoneVerified;

    // Check email token if provided
    if (emailVerificationToken && timingSafeStringEqual(user.emailVerificationToken, emailVerificationToken)) {
      isEmailVerified = true;
    }

    // Check SMS code if provided
    if (smsCode && timingSafeStringEqual(user.smsVerificationCode, smsCode)) {
      isPhoneVerified = true;
    }

    const isFullyVerified = isEmailVerified && isPhoneVerified;
    const isActive = isFullyVerified ? true : user.isActive;

    // Update user record
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        isEmailVerified,
        isPhoneVerified,
        isActive,
      },
    });

    // If account was just fully verified, send Welcome Package with Quick Start Guide PDF
    if (isFullyVerified && (!user.isEmailVerified || !user.isPhoneVerified)) {
      const { EmailService } = require('../services/EmailService');
      EmailService.sendWelcomePackage(updatedUser.email, updatedUser.name, user.tenant?.name).catch((err: any) => {
        console.error('[AuthVerify] Error sending welcome package:', err);
      });
    }

    res.status(200).json({
      success: true,
      message: isFullyVerified ? 'Account fully verified and activated!' : 'Verification step updated.',
      data: {
        email: updatedUser.email,
        isEmailVerified: updatedUser.isEmailVerified,
        isPhoneVerified: updatedUser.isPhoneVerified,
        isActive: updatedUser.isActive,
      },
    });
  } catch (error: any) {
    console.error('[AuthVerify] Error verifying user:', error);
    res.status(500).json({ success: false, error: 'Failed to complete verification.' });
  }
});

/**
 * POST /api/v1/auth/resend-verification
 * Regenerates and resends the email verification link and/or SMS code for
 * whichever channel(s) are still unverified, so a user stuck on a
 * "deactivated" account (verification email lost/never arrived) can
 * continue without needing to re-register.
 */
router.post('/resend-verification', authRateLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body;

    if (!email) {
      res.status(400).json({ success: false, error: 'Email is required.' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: { tenant: true },
    });

    if (!user) {
      res.status(404).json({ success: false, error: 'No account found for this email.' });
      return;
    }

    if (user.isEmailVerified && user.isPhoneVerified) {
      res.status(400).json({ success: false, error: 'This account is already fully verified. Please log in.' });
      return;
    }

    const updateData: { emailVerificationToken?: string; smsVerificationCode?: string } = {};
    if (!user.isEmailVerified) {
      updateData.emailVerificationToken = crypto.randomUUID();
    }
    if (!user.isPhoneVerified) {
      updateData.smsVerificationCode = Math.floor(1000 + Math.random() * 9000).toString();
    }

    const updatedUser = await prisma.$transaction(async (tx) => {
      const updatedUser = await tx.user.update({
        where: { id: user.id },
        data: updateData,
      });

      await recordAuditLogTx(tx, {
        action: 'AUTH.VERIFICATION_RESENT',
        entity: 'User',
        entityId: user.id,
        tenantId: user.tenantId || null,
        actor: { userEmail: user.email, ipAddress: req.ip || req.socket?.remoteAddress || null },
        details: `Resent verification for "${user.email}" (email: ${!user.isEmailVerified}, sms: ${!user.isPhoneVerified}).`,
      });

      return updatedUser;
    });

    if (!user.isEmailVerified) {
      const { EmailService } = require('../services/EmailService');
      EmailService.sendVerificationEmail(updatedUser.email, updatedUser.name, updatedUser.emailVerificationToken).catch((err: any) => {
        console.error('[AuthResendVerification] Error resending verification email:', err);
      });
    }
    if (!user.isPhoneVerified && updatedUser.phone) {
      const { SmsService } = require('../services/smsService');
      SmsService.send(updatedUser.phone, `Ledgio Verification Code: ${updatedUser.smsVerificationCode}. Do not share this code.`).catch((err: any) => {
        console.error('[AuthResendVerification] Error resending SMS code:', err);
      });
    }

    res.status(200).json({
      success: true,
      message: 'Verification instructions have been resent.',
      data: {
        emailResent: !user.isEmailVerified,
        smsResent: !user.isPhoneVerified,
      },
    });
  } catch (error: any) {
    console.error('[AuthResendVerification] Error:', error);
    res.status(500).json({ success: false, error: 'Failed to resend verification.' });
  }
});

/**
 * Issues the real, fully-authenticated session token and sends the login
 * success response. Shared by the direct (no-MFA) login path and the
 * post-MFA-verification path so both end up with byte-identical behavior.
 */
async function completeLogin(user: UserRecord, req: Request, res: Response): Promise<void> {
  // Org type rides on the token so nav filtering never needs an extra DB
  // round trip on later requests - only fetched here at login time.
  const loginTenant = user.tenantId
    ? await prisma.tenant.findUnique({ where: { id: user.tenantId }, select: { orgType: true } })
    : null;

  const tokenPayload = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    tenantId: user.tenantId || undefined,
    orgType: loginTenant?.orgType,
  };
  const token = generateJwtToken(tokenPayload);

  await recordAuditLog({
    action: 'AUTH.LOGIN_SUCCESS',
    entity: 'User',
    entityId: user.id,
    tenantId: user.tenantId || null,
    actor: { userId: user.id, userEmail: user.email, ipAddress: req.ip || req.socket?.remoteAddress || null },
  });

  res.status(200).json({
    success: true,
    message: 'Login successful',
    data: {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        role: user.role,
        tenantId: user.tenantId,
        orgType: loginTenant?.orgType,
        createdAt: user.createdAt,
        isMfaEnabled: user.isMfaEnabled || false,
      },
      token,
    },
  });
}

/**
 * POST /api/v1/auth/login
 * Authenticates user credentials and returns JWT token.
 */
router.post('/login', authRateLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({
        error: 'Validation Error',
        message: 'Email and password are required.',
      });
      return;
    }

    const user = await findUserByEmail(prisma, email);
    if (!user || !user.password) {
      await recordAuditLog({
        action: 'AUTH.LOGIN_FAILED',
        entity: 'User',
        actor: { userEmail: email, ipAddress: req.ip || req.socket?.remoteAddress || null },
        details: `Login failed for "${email}": no matching account.`,
      });
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid email or password.',
      });
      return;
    }

    if (!user.isActive) {
      await recordAuditLog({
        action: 'AUTH.LOGIN_FAILED',
        entity: 'User',
        entityId: user.id,
        tenantId: user.tenantId || null,
        actor: { userId: user.id, userEmail: user.email, ipAddress: req.ip || req.socket?.remoteAddress || null },
        details: `Login failed for "${email}": account deactivated.`,
      });
      res.status(401).json({
        error: 'Unauthorized',
        message: 'User account has been deactivated.',
      });
      return;
    }

    const isPasswordValid = verifyPassword(password, user.password);
    if (!isPasswordValid) {
      await recordAuditLog({
        action: 'AUTH.LOGIN_FAILED',
        entity: 'User',
        entityId: user.id,
        tenantId: user.tenantId || null,
        actor: { userId: user.id, userEmail: user.email, ipAddress: req.ip || req.socket?.remoteAddress || null },
        details: `Login failed for "${email}": invalid password.`,
      });
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid email or password.',
      });
      return;
    }

    if (user.isMfaEnabled) {
      // Short-lived (5min), narrow-claim token - proves the password was
      // correct but not that MFA was completed. authenticateJwt rejects it
      // outright for every other route (see authMiddleware.ts); the only
      // thing it's good for is POST /auth/login/verify-mfa below.
      const mfaToken = generateJwtToken({ id: user.id, email: user.email, role: user.role, mfaPending: true }, 300);

      await recordAuditLog({
        action: 'AUTH.MFA_CHALLENGE_ISSUED',
        entity: 'User',
        entityId: user.id,
        tenantId: user.tenantId || null,
        actor: { userId: user.id, userEmail: user.email, ipAddress: req.ip || req.socket?.remoteAddress || null },
      });

      res.status(200).json({
        success: true,
        mfaRequired: true,
        message: 'MFA verification required.',
        data: { mfaToken },
      });
      return;
    }

    await completeLogin(user, req, res);
  } catch (error: any) {
    console.error('[Auth Service] Login error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to authenticate user.',
    });
  }
});

/**
 * POST /api/v1/auth/login/verify-mfa
 * Second step of login for MFA-enabled accounts. Exchanges the short-lived
 * mfaToken from POST /login (proves password was correct) plus either a
 * live TOTP code or a one-time backup code for a real, fully-authenticated
 * session token - mirrors POST /login's own success response shape exactly.
 */
router.post('/login/verify-mfa', authRateLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { mfaToken, code, backupCode } = req.body;

    if (!mfaToken || (!code && !backupCode)) {
      res.status(400).json({
        error: 'Validation Error',
        message: 'mfaToken and either code or backupCode are required.',
      });
      return;
    }

    let payload;
    try {
      payload = await verifyJwtToken(mfaToken);
    } catch {
      res.status(401).json({ error: 'Unauthorized', message: 'Invalid or expired MFA session. Please log in again.' });
      return;
    }

    if (!payload.mfaPending) {
      res.status(401).json({ error: 'Unauthorized', message: 'Invalid MFA session token.' });
      return;
    }

    const user = await findUserById(prisma, payload.id);
    if (!user || !user.isMfaEnabled || !user.totpSecret) {
      res.status(401).json({ error: 'Unauthorized', message: 'MFA session is no longer valid.' });
      return;
    }

    const usedBackupCode = !code;
    const backupCodeIndex = usedBackupCode ? matchBackupCode(backupCode, user.mfaBackupCodes || []) : -1;
    const verified = usedBackupCode ? backupCodeIndex !== -1 : verifyTotpCode(user.totpSecret, code);

    if (!verified) {
      await recordAuditLog({
        action: 'AUTH.MFA_LOGIN_FAILED',
        entity: 'User',
        entityId: user.id,
        tenantId: user.tenantId || null,
        actor: { userId: user.id, userEmail: user.email, ipAddress: req.ip || req.socket?.remoteAddress || null },
        details: usedBackupCode ? 'Invalid backup code.' : 'Invalid TOTP code.',
      });
      res.status(401).json({
        error: 'Unauthorized',
        message: usedBackupCode ? 'Invalid backup code.' : 'Invalid verification code.',
      });
      return;
    }

    if (usedBackupCode) {
      // Single-use: remove the matched code so it can never be replayed.
      const remainingCodes = [...(user.mfaBackupCodes || [])];
      remainingCodes.splice(backupCodeIndex, 1);
      await prisma.user.update({ where: { id: user.id }, data: { mfaBackupCodes: remainingCodes } });
      await recordAuditLog({
        action: 'AUTH.MFA_BACKUP_CODE_USED',
        entity: 'User',
        entityId: user.id,
        tenantId: user.tenantId || null,
        actor: { userId: user.id, userEmail: user.email, ipAddress: req.ip || req.socket?.remoteAddress || null },
        details: `${remainingCodes.length} backup code(s) remaining.`,
      });
    }

    await completeLogin(user, req, res);
  } catch (error: any) {
    console.error('[Auth Service] MFA verification error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to verify MFA code.',
    });
  }
});

/**
 * POST /api/v1/auth/logout
 * Revokes the presented token so it's rejected by authenticateJwt for the
 * remainder of its natural lifetime, even though JWTs are otherwise stateless.
 */
router.post('/logout', authenticateJwt, async (req: Request, res: Response): Promise<void> => {
  try {
    const authHeader = req.headers.authorization || (req.headers['x-auth-token'] as string) || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : authHeader;

    const expiresAt = req.user?.exp ?? Math.floor(Date.now() / 1000) + 86400;
    const ttlSeconds = expiresAt - Math.floor(Date.now() / 1000);

    await revokeToken(computeTokenHash(token), ttlSeconds);
    evictFromJwtCache(token);

    await recordAuditLog({
      action: 'AUTH.LOGOUT',
      entity: 'User',
      entityId: req.user?.id,
      tenantId: req.user?.tenantId || null,
      actor: { userId: req.user?.id, userEmail: req.user?.email, ipAddress: req.ip || req.socket?.remoteAddress || null },
    });

    res.status(200).json({ success: true, message: 'Logged out successfully.' });
  } catch (error: any) {
    console.error('[Auth Service] Logout error:', error);
    res.status(500).json({ success: false, error: 'Failed to log out.' });
  }
});

/**
 * GET /api/v1/auth/me
 * Retrieves current authenticated user profile.
 */
router.get('/me', authenticateJwt, async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
      return;
    }

    const user = await findUserById(prisma, req.user.id);
    if (!user) {
      res.status(404).json({ error: 'Not Found', message: 'User record not found.' });
      return;
    }

    res.status(200).json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          phone: user.phone,
          role: user.role,
          tenantId: user.tenantId,
          // Rides on the already-verified JWT rather than a fresh tenant
          // lookup - orgType is immutable after onboarding, so the token's
          // value can never be stale.
          orgType: req.user.orgType,
          createdAt: user.createdAt,
          isMfaEnabled: user.isMfaEnabled || false,
        },
      },
    });
  } catch (error: any) {
    console.error('[Auth Service] Me profile error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch user profile.',
    });
  }
});

/**
 * PUT /api/v1/auth/profile
 * Updates authenticated user's mobile phone and email in PostgreSQL database.
 */
router.put('/profile', authenticateJwt, async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, error: 'Unauthorized: User not authenticated.' });
      return;
    }

    const { email, phone, name } = req.body;

    const updatedUser = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        ...(email && { email: email.toLowerCase().trim() }),
        ...(phone !== undefined && { phone: phone ? phone.trim() : null }),
        ...(name && { name: name.trim() }),
      },
    });

    res.status(200).json({
      success: true,
      message: 'Account profile updated successfully in database.',
      data: {
        user: {
          id: updatedUser.id,
          email: updatedUser.email,
          name: updatedUser.name,
          phone: updatedUser.phone,
          role: updatedUser.role,
          tenantId: updatedUser.tenantId,
        },
      },
    });
  } catch (error: any) {
    console.error('[Auth Service] Update profile error:', error);
    res.status(500).json({ success: false, error: 'Failed to update user profile in database.' });
  }
});

/**
 * POST /api/v1/auth/mfa/setup
 * Starts (or restarts) MFA enrollment: generates a new TOTP secret, persists
 * it on the user (isMfaEnabled stays false until confirmed via
 * /mfa/verify-setup below), and returns the secret plus a scannable QR code.
 * Safe to call again before confirming - each call just overwrites the
 * pending secret.
 */
router.post('/mfa/setup', authenticateJwt, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await findUserById(prisma, req.user!.id);
    if (!user) {
      res.status(404).json({ success: false, error: 'User record not found.' });
      return;
    }
    if (user.isMfaEnabled) {
      res.status(400).json({ success: false, error: 'MFA is already enabled. Disable it first to re-enroll.' });
      return;
    }

    const secret = generateTotpSecret();
    await prisma.user.update({ where: { id: user.id }, data: { totpSecret: secret } });

    const otpAuthUrl = buildOtpAuthUrl(secret, user.email);
    const qrCodeDataUrl = await generateQrCodeDataUrl(otpAuthUrl);

    res.status(200).json({
      success: true,
      data: { secret, otpAuthUrl, qrCodeDataUrl },
    });
  } catch (error: any) {
    console.error('[Auth Service] MFA setup error:', error);
    res.status(500).json({ success: false, error: 'Failed to start MFA setup.' });
  }
});

/**
 * POST /api/v1/auth/mfa/verify-setup
 * Confirms enrollment by checking a real code from the user's authenticator
 * app against the pending secret from /mfa/setup. On success, activates MFA
 * and returns one-time backup codes in plain text - shown to the user
 * exactly once here, only hashed copies are ever persisted.
 */
router.post('/mfa/verify-setup', authenticateJwt, async (req: Request, res: Response): Promise<void> => {
  try {
    const { code } = req.body;
    if (!code) {
      res.status(400).json({ success: false, error: 'A verification code is required.' });
      return;
    }

    const user = await findUserById(prisma, req.user!.id);
    if (!user) {
      res.status(404).json({ success: false, error: 'User record not found.' });
      return;
    }
    if (user.isMfaEnabled) {
      res.status(400).json({ success: false, error: 'MFA is already enabled.' });
      return;
    }
    if (!user.totpSecret) {
      res.status(400).json({ success: false, error: 'Start MFA setup first via POST /auth/mfa/setup.' });
      return;
    }

    if (!verifyTotpCode(user.totpSecret, code)) {
      res.status(400).json({ success: false, error: 'Invalid code. Please check your authenticator app and try again.' });
      return;
    }

    const backupCodes = generateBackupCodes();
    const hashedBackupCodes = backupCodes.map(hashBackupCode);

    await prisma.user.update({
      where: { id: user.id },
      data: { isMfaEnabled: true, mfaBackupCodes: hashedBackupCodes },
    });

    await recordAuditLog({
      action: 'AUTH.MFA_ENABLED',
      entity: 'User',
      entityId: user.id,
      tenantId: user.tenantId || null,
      actor: { userId: user.id, userEmail: user.email, ipAddress: req.ip || req.socket?.remoteAddress || null },
    });

    res.status(200).json({
      success: true,
      message: 'MFA enabled successfully. Save these backup codes somewhere safe - each one can be used once if you lose access to your authenticator app, and they will not be shown again.',
      data: { backupCodes },
    });
  } catch (error: any) {
    console.error('[Auth Service] MFA setup verification error:', error);
    res.status(500).json({ success: false, error: 'Failed to verify MFA setup.' });
  }
});

/**
 * POST /api/v1/auth/mfa/disable
 * Requires the account password as re-confirmation (not just an existing
 * session) before turning MFA off, since a stolen unlocked session
 * shouldn't be enough on its own to strip a security control.
 */
router.post('/mfa/disable', authenticateJwt, async (req: Request, res: Response): Promise<void> => {
  try {
    const { password } = req.body;
    if (!password) {
      res.status(400).json({ success: false, error: 'Your password is required to disable MFA.' });
      return;
    }

    const user = await findUserById(prisma, req.user!.id);
    if (!user) {
      res.status(404).json({ success: false, error: 'User record not found.' });
      return;
    }
    if (!user.isMfaEnabled) {
      res.status(400).json({ success: false, error: 'MFA is not currently enabled.' });
      return;
    }
    if (!user.password || !verifyPassword(password, user.password)) {
      await recordAuditLog({
        action: 'AUTH.MFA_DISABLE_FAILED',
        entity: 'User',
        entityId: user.id,
        tenantId: user.tenantId || null,
        actor: { userId: user.id, userEmail: user.email, ipAddress: req.ip || req.socket?.remoteAddress || null },
        details: 'Incorrect password.',
      });
      res.status(401).json({ success: false, error: 'Incorrect password.' });
      return;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { isMfaEnabled: false, totpSecret: null, mfaBackupCodes: [] },
    });

    await recordAuditLog({
      action: 'AUTH.MFA_DISABLED',
      entity: 'User',
      entityId: user.id,
      tenantId: user.tenantId || null,
      actor: { userId: user.id, userEmail: user.email, ipAddress: req.ip || req.socket?.remoteAddress || null },
    });

    res.status(200).json({ success: true, message: 'MFA has been disabled on your account.' });
  } catch (error: any) {
    console.error('[Auth Service] MFA disable error:', error);
    res.status(500).json({ success: false, error: 'Failed to disable MFA.' });
  }
});

/**
 * POST /api/v1/auth/verify-token
 * Verifies JWT token validity and returns claims.
 * Note: named distinctly from POST /verify (email/SMS account verification above),
 * which would otherwise shadow this handler since Express dispatches to the first
 * matching route registration.
 */
router.post('/verify-token', authRateLimiter, async (req: Request, res: Response): Promise<void> => {
  const authHeader = req.headers.authorization || (req.headers['x-auth-token'] as string) || req.body.token;

  if (!authHeader) {
    res.status(400).json({
      success: false,
      valid: false,
      message: 'No token provided for verification.',
    });
    return;
  }

  let token = authHeader;
  if (authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  }

  try {
    const { verifyJwtToken } = require('../utils/jwt');
    const payload = await verifyJwtToken(token);
    res.status(200).json({
      success: true,
      valid: true,
      data: {
        user: payload,
      },
    });
  } catch (error: any) {
    res.status(401).json({
      success: false,
      valid: false,
      message: error.message || 'Token verification failed.',
    });
  }
});

/**
 * GET /api/v1/auth/invitation/:token
 * Validates invitation token and returns basic details for accept UI.
 */
router.get('/invitation/:token', authRateLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.params;
    const invitation = await prisma.invitation.findUnique({
      where: { token },
      include: { tenant: true },
    });

    if (!invitation) {
      res.status(404).json({
        success: false,
        error: 'Invalid invitation token.',
      });
      return;
    }

    if (invitation.status !== 'PENDING') {
      res.status(400).json({
        success: false,
        error: `This invitation has already been ${invitation.status.toLowerCase()}.`,
      });
      return;
    }

    if (invitation.expiresAt < new Date()) {
      res.status(400).json({
        success: false,
        error: 'This invitation has expired. Please ask your administrator for a new invite.',
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: {
        invitation: {
          email: invitation.email,
          role: invitation.role,
          tenantName: invitation.tenant?.name || 'Workspace',
          tenantId: invitation.tenantId,
        },
      },
    });
  } catch (error: any) {
    console.error('[Auth Service] Error verifying invitation token:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to verify invitation token.',
    });
  }
});

/**
 * POST /api/v1/auth/accept-invitation
 * Accepts invitation token, sets user password and name, links to tenantId.
 */
router.post('/accept-invitation', authRateLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { token, name, password } = req.body;

    if (!token || !password || !name) {
      res.status(400).json({
        success: false,
        error: 'Token, name, and password are required.',
      });
      return;
    }

    const passwordError = validatePasswordStrength(password);
    if (passwordError) {
      res.status(400).json({
        success: false,
        error: passwordError,
      });
      return;
    }

    const invitation = await prisma.invitation.findUnique({
      where: { token },
      include: { tenant: true },
    });

    if (!invitation || invitation.status !== 'PENDING' || invitation.expiresAt < new Date()) {
      res.status(400).json({
        success: false,
        error: 'Invalid or expired invitation token.',
      });
      return;
    }

    const hashedPassword = hashPassword(password);

    const user = await prisma.$transaction(async (tx) => {
      // Upsert or create user linked to tenant
      const existingUser = await findUserByEmail(tx as any, invitation.email);
      let user;

      if (existingUser) {
        user = await tx.user.update({
          where: { id: existingUser.id },
          data: {
            name: name.trim(),
            password: hashedPassword,
            tenantId: invitation.tenantId,
            role: invitation.role,
            isActive: true,
          },
        });
      } else {
        user = await createUser(tx as any, {
          email: invitation.email,
          password: hashedPassword,
          name: name.trim(),
          role: invitation.role,
          tenantId: invitation.tenantId,
        });
      }

      // Grant the warehouses selected at invite time (only meaningful for
      // location-scoped roles - empty for company-wide roles). Idempotent via
      // skipDuplicates so re-accepting (existingUser update path above) never
      // errors on the unique (userId, warehouseId) constraint.
      if (invitation.warehouseIds && invitation.warehouseIds.length > 0) {
        await tx.warehouseAccess.createMany({
          data: invitation.warehouseIds.map((warehouseId) => ({
            tenantId: invitation.tenantId,
            userId: user.id,
            warehouseId,
          })),
          skipDuplicates: true,
        });
      }

      // Mark invitation as accepted
      await tx.invitation.update({
        where: { id: invitation.id },
        data: { status: 'ACCEPTED' },
      });

      await recordAuditLogTx(tx, {
        action: 'AUTH.INVITATION_ACCEPTED',
        entity: 'User',
        entityId: user.id,
        tenantId: invitation.tenantId,
        actor: { userId: user.id, userEmail: user.email, ipAddress: req.ip || req.socket?.remoteAddress || null },
        details: `${user.email} accepted invitation with role ${invitation.role}.`,
      });

      return user;
    });

    // Generate JWT token
    const tokenPayload = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      tenantId: user.tenantId || undefined,
      orgType: invitation.tenant.orgType,
    };
    const jwtToken = generateJwtToken(tokenPayload);

    res.status(200).json({
      success: true,
      message: 'Invitation accepted successfully.',
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          tenantId: user.tenantId,
          orgType: invitation.tenant.orgType,
        },
        token: jwtToken,
      },
    });
  } catch (error: any) {
    console.error('[Auth Service] Error accepting invitation:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to accept invitation.',
    });
  }
});

/**
 * RBAC Protected Test Routes
 */
router.get('/admin-only', authenticateJwt, requireRole('Admin'), (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: 'Access granted to Admin-only route',
    user: req.user,
  });
});

router.get('/accountant-only', authenticateJwt, requireRole('Accountant'), (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: 'Access granted to Accountant route',
    user: req.user,
  });
});

router.get('/auditor-only', authenticateJwt, requireRole('Auditor'), (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: 'Access granted to Auditor route',
    user: req.user,
  });
});

router.get('/viewer-only', authenticateJwt, requireRole('Viewer'), (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: 'Access granted to Viewer route',
    user: req.user,
  });
});

export default router;
