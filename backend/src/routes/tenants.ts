import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { prisma } from '../config/db';
import { onboardTenant, TenantOnboardingError } from '../services/tenantService';
import * as tenantRepository from '../repository/tenantRepository';
import { authenticateJwt } from '../middleware/authMiddleware';
import { tenantContextMiddleware } from '../middleware/tenantContextMiddleware';
import { requireRole } from '../middleware/rbacMiddleware';
import { seatLimitForTier, planName } from '../middleware/tierEnforcementMiddleware';
import { invalidateTenantCacheById } from '../cache/tenantCache';
import { BroadcastService } from '../services/broadcastService';
import { CLOSED_ROLES, isLocationScopedRole } from '../services/warehouseAccessService';
import { recordAuditLog, recordAuditLogTx, actorFromRequest, diffFields } from '../services/auditLogService';
import { onboardingRateLimiter } from '../middleware/rateLimiterMiddleware';
import { encryptCredential } from '../utils/credentialEncryption';

const router = Router();

/**
 * Never return any encrypted credential ciphertext to a client - replace
 * each with a plain boolean so the frontend can show "configured" without
 * ever having a chance to leak or re-display the secret.
 */
function sanitizeTenantForResponse(tenant: any) {
  if (!tenant) return tenant;
  const {
    graSecurityKeyEncrypted,
    momoSubscriptionKeyEncrypted,
    momoApiKeyEncrypted,
    tellerApiKeyEncrypted,
    paystackSecretKeyEncrypted,
    ...rest
  } = tenant;
  return {
    ...rest,
    graSecurityKeyConfigured: Boolean(graSecurityKeyEncrypted),
    momoConfigured: Boolean(rest.momoApiUser && momoSubscriptionKeyEncrypted && momoApiKeyEncrypted),
    tellerConfigured: Boolean(rest.tellerApiUsername && rest.tellerMerchantId && tellerApiKeyEncrypted),
    paystackConfigured: Boolean(paystackSecretKeyEncrypted),
  };
}

/**
 * POST /api/v1/tenants/onboard
 * Registers a new tenant in public.tenants, provisions PostgreSQL schema (tenant_<slug>),
 * runs initial DDL migrations, registers tenant Admin user in public.users,
 * and returns tenant details and Admin JWT token.
 */
router.post('/onboard', onboardingRateLimiter, async (req: Request, res: Response) => {
  try {
    const result = await onboardTenant(prisma, req.body);

    return res.status(201).json({
      success: true,
      message: 'Tenant onboarded successfully',
      data: result,
    });
  } catch (error: any) {
    if (error instanceof TenantOnboardingError) {
      return res.status(error.statusCode).json({
        success: false,
        error: error.message,
      });
    }

    console.error('[TenantOnboarding] Unexpected error:', error?.stack || error);
    return res.status(500).json({
      success: false,
      error: error?.message || 'Internal server error during tenant onboarding',
    });
  }
});

/**
 * GET /api/v1/tenants
 * Lists all registered tenants across the platform. This is a platform-operator
 * function (used by the Admin Core Engine console), not a tenant-scoped one, so
 * it's gated by the master broadcast passcode rather than a tenant JWT - no
 * individual tenant's token should grant visibility into every other tenant.
 * Previously had no auth at all.
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const passcode = (req.query.passcode as string) || req.headers['x-admin-passcode'];
    if (!passcode || !BroadcastService.verifyPasscode(passcode as string)) {
      return res.status(401).json({ success: false, error: 'Unauthorized: valid master passcode required.' });
    }

    const tenants = await tenantRepository.listTenants(prisma);
    return res.status(200).json({
      success: true,
      data: { tenants: tenants.map(sanitizeTenantForResponse) },
    });
  } catch (error: any) {
    console.error('[TenantsList] Unexpected error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve tenants list',
    });
  }
});

/**
 * POST /api/v1/tenants/admin-onboard
 * Platform-operator onboarding for a contracted client - identical to the
 * self-serve POST /onboard flow (same tenant/schema/migration provisioning),
 * except the resulting Admin account is created pre-verified (isActive/
 * isEmailVerified/isPhoneVerified all true immediately) instead of requiring
 * the normal email/SMS verification round-trip. Appropriate only when the
 * business has already been vetted directly (a signed contract, not a
 * self-service signup) - gated by the same master broadcast passcode as
 * every other platform-operator endpoint in this file, never a tenant JWT.
 */
router.post('/admin-onboard', onboardingRateLimiter, async (req: Request, res: Response) => {
  try {
    const passcode = (req.body?.passcode as string) || (req.query.passcode as string) || req.headers['x-admin-passcode'];
    if (!passcode || !BroadcastService.verifyPasscode(passcode as string)) {
      return res.status(401).json({ success: false, error: 'Unauthorized: valid master passcode required.' });
    }

    const { passcode: _omit, ...dto } = req.body || {};
    const result = await onboardTenant(prisma, {
      ...dto,
      termsAccepted: true,
      acceptedTermsVersion: dto.acceptedTermsVersion || 'v1.0.0',
    }, { skipVerification: true });

    await recordAuditLog({
      action: 'TENANT.ADMIN_ONBOARDED',
      entity: 'Tenant',
      entityId: result.tenant.id,
      tenantId: result.tenant.id,
      actor: { ipAddress: req.ip || req.socket?.remoteAddress || null },
      details: `Contracted client "${result.tenant.name}" (${result.tenant.slug}) onboarded directly by platform admin, pre-verified. Admin: ${result.admin.email}.`,
    });

    return res.status(201).json({
      success: true,
      message: 'Contracted client onboarded and pre-verified. They can log in immediately.',
      data: result,
    });
  } catch (error: any) {
    if (error instanceof TenantOnboardingError) {
      return res.status(error.statusCode).json({ success: false, error: error.message });
    }
    console.error('[TenantAdminOnboard] Unexpected error:', error?.stack || error);
    return res.status(500).json({
      success: false,
      error: error?.message || 'Internal server error during contracted-client onboarding',
    });
  }
});

/**
 * PUT /api/v1/tenants/:id/tier
 * Sets a tenant's plan tier (1=Shop, 2=Business, 3=Enterprise). There is no
 * self-serve billing yet, so upgrading/downgrading a tenant is a
 * platform-admin action through the passcode-gated Admin Core Engine
 * console, same auth pattern as admin-onboard - never a tenant JWT.
 */
router.put('/:id/tier', async (req: Request, res: Response) => {
  try {
    const passcode = (req.body?.passcode as string) || (req.query.passcode as string) || req.headers['x-admin-passcode'];
    if (!passcode || !BroadcastService.verifyPasscode(passcode as string)) {
      return res.status(401).json({ success: false, error: 'Unauthorized: valid master passcode required.' });
    }

    const tier = Number(req.body?.tier);
    if (![1, 2, 3].includes(tier)) {
      return res.status(400).json({ success: false, error: 'Tier must be 1 (Shop), 2 (Business), or 3 (Enterprise).' });
    }

    const before = await tenantRepository.findTenantById(prisma, req.params.id);
    if (!before) {
      return res.status(404).json({ success: false, error: 'Tenant not found.' });
    }

    const updated = await prisma.tenant.update({ where: { id: req.params.id }, data: { tier } });

    // tenantContextMiddleware reads tier off a 30-minute Redis cache keyed
    // by id/slug/schema (see cache/tenantCache.ts) - without invalidating
    // it here, an upgrade wouldn't actually unlock anything until that
    // cache happened to expire, which would make this endpoint's whole
    // purpose silently not work for up to half an hour.
    await invalidateTenantCacheById(updated.id);

    await recordAuditLog({
      action: 'TENANT.TIER_CHANGED',
      entity: 'Tenant',
      entityId: updated.id,
      tenantId: updated.id,
      actor: { ipAddress: req.ip || req.socket?.remoteAddress || null },
      details: `Tenant "${updated.name}" (${updated.slug}) plan tier changed from ${before.tier} to ${tier} by platform admin.`,
    });

    return res.status(200).json({ success: true, message: 'Tenant tier updated.', data: { tenant: sanitizeTenantForResponse(updated) } });
  } catch (error: any) {
    console.error('[TenantTierUpdate] Unexpected error:', error);
    return res.status(500).json({ success: false, error: 'Failed to update tenant tier.' });
  }
});

/**
 * GET /api/v1/tenants/current
 * Returns active workspace profile settings.
 */
router.get('/current', authenticateJwt, tenantContextMiddleware, async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId || (req as any).user?.tenantId;
    if (!tenantId) {
      return res.status(400).json({ success: false, error: 'Tenant ID context required.' });
    }

    const tenant = await tenantRepository.findTenantById(prisma, tenantId);
    if (!tenant) {
      return res.status(404).json({ success: false, error: 'Tenant not found.' });
    }

    return res.status(200).json({
      success: true,
      data: { tenant: sanitizeTenantForResponse(tenant) },
    });
  } catch (error: any) {
    console.error('[TenantCurrent] Error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch tenant profile.' });
  }
});

/**
 * PUT /api/v1/tenants/current
 * Updates workspace profile settings.
 */
router.put('/current', authenticateJwt, tenantContextMiddleware, requireRole('Admin'), async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId || (req as any).user?.tenantId;
    const {
      companyName,
      name,
      slug,
      baseCurrency,
      bossPhone,
      graTin,
      vatRegistered,
      graDeviceNumber,
      graSecurityKey,
      momoApiUser,
      momoSubscriptionKey,
      momoApiKey,
      tellerApiUsername,
      tellerMerchantId,
      tellerApiKey,
      paystackSecretKey,
    } = req.body;
    const newName = (companyName || name || '').trim();

    if (!tenantId) {
      return res.status(400).json({ success: false, error: 'Tenant ID context required.' });
    }

    // Same tolerant shape SmsService.send() already normalizes at send time
    // (optional leading +, spaces/dashes/parens, 7-15 digits) - reject
    // obvious garbage early rather than storing something that will always
    // fail to send. An empty string clears the field (opts back out of SMS
    // alerts) - only reject a non-empty value that doesn't look like a phone.
    let normalizedBossPhone: string | null | undefined;
    if (bossPhone !== undefined) {
      const trimmed = String(bossPhone).trim();
      if (trimmed === '') {
        normalizedBossPhone = null;
      } else if (!/^\+?[\d\s\-()]{7,20}$/.test(trimmed)) {
        return res.status(400).json({ success: false, error: 'Boss phone number is not a valid phone number.' });
      } else {
        normalizedBossPhone = trimmed;
      }
    }

    // Previously only settable once, at onboarding (see
    // onboardingWizardService.ts) - a business whose TIN was wrong or
    // unregistered at the time had no way to correct it afterward.
    let normalizedGraTin: string | null | undefined;
    if (graTin !== undefined) {
      const trimmed = String(graTin).trim();
      normalizedGraTin = trimmed === '' ? null : trimmed;
    }

    // Device/branch suffix GRA appends to the TIN in the VSDC API URL path
    // (see graEvatService.ts) - assigned by GRA during onboarding, not
    // invented here.
    let normalizedGraDeviceNumber: string | null | undefined;
    if (graDeviceNumber !== undefined) {
      const trimmed = String(graDeviceNumber).trim();
      normalizedGraDeviceNumber = trimmed === '' ? null : trimmed;
    }

    // Write-only: an empty string clears the stored credential (tenant wants
    // to remove it), any other value is encrypted before storage. Omitting
    // the field entirely (undefined) leaves whatever is already stored
    // untouched - the frontend never has the plaintext to re-send anyway.
    let normalizedGraSecurityKeyEncrypted: string | null | undefined;
    if (graSecurityKey !== undefined) {
      const trimmed = String(graSecurityKey).trim();
      normalizedGraSecurityKeyEncrypted = trimmed === '' ? null : encryptCredential(trimmed);
    }

    // Per-tenant payment-collector credentials (see momoService.ts/
    // tellerService.ts/paystackService.ts). apiUser/apiUsername/merchantId
    // are account identifiers, not secrets, so stored plaintext; the actual
    // keys are write-only and encrypted before storage, same pattern as
    // graSecurityKey above.
    let normalizedMomoApiUser: string | null | undefined;
    if (momoApiUser !== undefined) {
      const trimmed = String(momoApiUser).trim();
      normalizedMomoApiUser = trimmed === '' ? null : trimmed;
    }
    let normalizedMomoSubscriptionKeyEncrypted: string | null | undefined;
    if (momoSubscriptionKey !== undefined) {
      const trimmed = String(momoSubscriptionKey).trim();
      normalizedMomoSubscriptionKeyEncrypted = trimmed === '' ? null : encryptCredential(trimmed);
    }
    let normalizedMomoApiKeyEncrypted: string | null | undefined;
    if (momoApiKey !== undefined) {
      const trimmed = String(momoApiKey).trim();
      normalizedMomoApiKeyEncrypted = trimmed === '' ? null : encryptCredential(trimmed);
    }
    let normalizedTellerApiUsername: string | null | undefined;
    if (tellerApiUsername !== undefined) {
      const trimmed = String(tellerApiUsername).trim();
      normalizedTellerApiUsername = trimmed === '' ? null : trimmed;
    }
    let normalizedTellerMerchantId: string | null | undefined;
    if (tellerMerchantId !== undefined) {
      const trimmed = String(tellerMerchantId).trim();
      normalizedTellerMerchantId = trimmed === '' ? null : trimmed;
    }
    let normalizedTellerApiKeyEncrypted: string | null | undefined;
    if (tellerApiKey !== undefined) {
      const trimmed = String(tellerApiKey).trim();
      normalizedTellerApiKeyEncrypted = trimmed === '' ? null : encryptCredential(trimmed);
    }
    let normalizedPaystackSecretKeyEncrypted: string | null | undefined;
    if (paystackSecretKey !== undefined) {
      const trimmed = String(paystackSecretKey).trim();
      normalizedPaystackSecretKeyEncrypted = trimmed === '' ? null : encryptCredential(trimmed);
    }

    const before = await tenantRepository.findTenantById(prisma, tenantId);

    const updated = await prisma.$transaction(async (tx) => {
      const updated = await tx.tenant.update({
        where: { id: tenantId },
        data: {
          ...(newName && { name: newName }),
          ...(slug && { slug: slug.trim().toLowerCase() }),
          ...(baseCurrency && { baseCurrency: baseCurrency.trim().toUpperCase() }),
          ...(normalizedBossPhone !== undefined && { bossPhone: normalizedBossPhone }),
          ...(normalizedGraTin !== undefined && { graTin: normalizedGraTin }),
          ...(vatRegistered !== undefined && { vatRegistered: Boolean(vatRegistered) }),
          ...(normalizedGraDeviceNumber !== undefined && { graDeviceNumber: normalizedGraDeviceNumber }),
          ...(normalizedGraSecurityKeyEncrypted !== undefined && { graSecurityKeyEncrypted: normalizedGraSecurityKeyEncrypted }),
          ...(normalizedMomoApiUser !== undefined && { momoApiUser: normalizedMomoApiUser }),
          ...(normalizedMomoSubscriptionKeyEncrypted !== undefined && { momoSubscriptionKeyEncrypted: normalizedMomoSubscriptionKeyEncrypted }),
          ...(normalizedMomoApiKeyEncrypted !== undefined && { momoApiKeyEncrypted: normalizedMomoApiKeyEncrypted }),
          ...(normalizedTellerApiUsername !== undefined && { tellerApiUsername: normalizedTellerApiUsername }),
          ...(normalizedTellerMerchantId !== undefined && { tellerMerchantId: normalizedTellerMerchantId }),
          ...(normalizedTellerApiKeyEncrypted !== undefined && { tellerApiKeyEncrypted: normalizedTellerApiKeyEncrypted }),
          ...(normalizedPaystackSecretKeyEncrypted !== undefined && { paystackSecretKeyEncrypted: normalizedPaystackSecretKeyEncrypted }),
        },
      });

      await recordAuditLogTx(tx, {
        action: 'TENANT_SETTINGS.UPDATED',
        entity: 'Tenant',
        entityId: tenantId,
        actor: actorFromRequest(req),
        // Encrypted credential ciphertext deliberately excluded - even the
        // ciphertext shouldn't be persisted into the audit log's diff
        // payload. momoApiUser/tellerApiUsername/tellerMerchantId are plain
        // identifiers (not secrets) so they're safe to diff.
        changes: diffFields(before, updated, [
          'name',
          'slug',
          'baseCurrency',
          'bossPhone',
          'graTin',
          'vatRegistered',
          'graDeviceNumber',
          'momoApiUser',
          'tellerApiUsername',
          'tellerMerchantId',
        ]),
      });

      return updated;
    });

    return res.status(200).json({
      success: true,
      message: 'Tenant settings updated successfully',
      data: { tenant: sanitizeTenantForResponse(updated) },
    });
  } catch (error: any) {
    console.error('[TenantUpdate] Error:', error);
    return res.status(500).json({ success: false, error: 'Failed to update tenant profile.' });
  }
});

/**
 * POST /api/v1/tenants/invite (Admin only)
 * Generates a secure invitation token for a new staff member and logs/sends an email.
 */
router.post('/invite', authenticateJwt, tenantContextMiddleware, requireRole('Admin'), async (req: Request, res: Response) => {
  try {
    const { email, role, warehouseIds } = req.body;
    const tenantId = (req as any).tenantId || (req as any).user?.tenantId;

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: 'Tenant ID context is required to issue staff invitations.',
      });
    }

    if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return res.status(400).json({
        success: false,
        error: 'A valid email address is required.',
      });
    }

    const matchedRole = CLOSED_ROLES.find((r) => r.toLowerCase() === String(role || '').trim().toLowerCase());
    if (!matchedRole) {
      return res.status(400).json({
        success: false,
        error: `Please select a valid role: ${CLOSED_ROLES.join(', ')}.`,
      });
    }

    // Plan seat limit - counts every real member of this tenant (a pending
    // invite doesn't consume a seat until accepted, so this only ever
    // blocks the invite that would actually push the tenant over its
    // plan's cap). Deliberately NOT filtered to isActive:true - that flag
    // means "has verified their email" here (tenantService.ts), not
    // "occupies a seat" - an admin mid-verification still fully counts.
    const currentTier = req.tenantContext?.tenantTier ?? 1;
    const seatLimit = seatLimitForTier(currentTier);
    if (Number.isFinite(seatLimit)) {
      const memberCount = await prisma.user.count({ where: { tenantId } });
      if (memberCount >= seatLimit) {
        return res.status(403).json({
          success: false,
          error: `Your ${planName(currentTier)} plan is limited to ${seatLimit} team members. Upgrade your plan to invite more.`,
          upgradeRequired: true,
          currentTier,
          seatLimit,
        });
      }
    }
    const assignedRole = matchedRole;

    const requestedWarehouseIds: string[] = Array.isArray(warehouseIds) ? warehouseIds.filter((id) => typeof id === 'string') : [];
    if (isLocationScopedRole(assignedRole)) {
      if (requestedWarehouseIds.length === 0) {
        return res.status(400).json({
          success: false,
          error: `"${assignedRole}" is a shop-scoped role - select at least one warehouse/shop to grant access to.`,
        });
      }
      const validWarehouses = await prisma.warehouse.findMany({
        where: { id: { in: requestedWarehouseIds }, tenantId },
        select: { id: true },
      });
      if (validWarehouses.length !== requestedWarehouseIds.length) {
        return res.status(400).json({
          success: false,
          error: 'One or more selected warehouses do not belong to this business.',
        });
      }
    }

    // Check if user with this email is already a member of this tenant
    const existingUser = await prisma.user.findFirst({
      where: { email: email.trim().toLowerCase(), tenantId },
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: `User with email "${email}" is already a member of this workspace.`,
      });
    }

    // Generate secure 64-character token
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    // Upsert or create invitation
    const invitation = await prisma.$transaction(async (tx) => {
      const invitation = await tx.invitation.create({
        data: {
          email: email.trim().toLowerCase(),
          tenantId,
          role: assignedRole,
          warehouseIds: isLocationScopedRole(assignedRole) ? requestedWarehouseIds : [],
          token,
          status: 'PENDING',
          expiresAt,
        },
      });

      await recordAuditLogTx(tx, {
        action: 'INVITATION.SENT',
        entity: 'Invitation',
        entityId: invitation.id,
        tenantId,
        actor: actorFromRequest(req),
        details: `Invited ${invitation.email} as ${invitation.role}.`,
      });

      return invitation;
    });

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    const companyName = tenant?.name || 'Ledgio Workspace';
    const inviteUrl = `${(process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '')}/accept-invite?token=${token}`;

    // Dispatch actual Email Invitation via Nodemailer (Gmail SMTP)
    const { EmailService } = require('../services/EmailService');
    const emailSubject = `📩 You've been invited to join ${companyName} on Ledgio ERP`;
    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
        <h2 style="color: #0f172a; border-bottom: 2px solid #10b981; padding-bottom: 10px; margin-top: 0;">
          Workspace Staff Invitation
        </h2>
        <p style="font-size: 14px; color: #334155; line-height: 1.6;">
          Hello! You have been invited to join <strong>${companyName}</strong> on Ledgio ERP with the role of <strong>${invitation.role}</strong>.
        </p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${inviteUrl}" style="background-color: #10b981; color: #ffffff; padding: 12px 28px; font-[bold]; font-size: 14px; border-radius: 8px; text-decoration: none; display: inline-block;">
            Accept Invitation & Join Team
          </a>
        </div>
        <p style="font-size: 12px; color: #64748b;">
          If the button above does not work, copy and paste this link into your browser:<br />
          <a href="${inviteUrl}" style="color: #2563eb;">${inviteUrl}</a>
        </p>
        <p style="font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 15px; margin-bottom: 0;">
          This invitation expires in 7 days. If you were not expecting this invitation, you can safely ignore this email.
        </p>
      </div>
    `;

    EmailService.sendMail(invitation.email, emailSubject, emailHtml).catch((emailErr: any) => {
      console.error('[TenantInvite] Email dispatch error:', emailErr);
    });

    console.log(`\n======================================================`);
    console.log(`[STAFF INVITATION EMAIL SENT VIA NODEMAILER]`);
    console.log(`To: ${invitation.email}`);
    console.log(`Role: ${invitation.role}`);
    console.log(`Invite URL: ${inviteUrl}`);
    console.log(`======================================================\n`);

    return res.status(201).json({
      success: true,
      message: 'Invitation email dispatched successfully.',
      data: {
        invitation,
        inviteUrl,
      },
    });
  } catch (error: any) {
    console.error('[TenantInvite] Error sending invitation:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to create staff invitation',
    });
  }
});

/**
 * GET /api/v1/tenants/members (Admin / Accountant / Viewer)
 * Returns all active users in the current tenant.
 */
router.get('/members', authenticateJwt, tenantContextMiddleware, async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId || (req as any).user?.tenantId;
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: 'Tenant ID context is required to view workspace members.',
      });
    }

    const members = await prisma.user.findMany({
      where: { tenantId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
        warehouseAccess: { select: { warehouseId: true, warehouse: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.status(200).json({
      success: true,
      data: { members },
    });
  } catch (error: any) {
    console.error('[TenantMembers] Error fetching team members:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve team members',
    });
  }
});

/**
 * PUT /api/v1/tenants/members/:id/warehouse-access (Admin only)
 * Replaces a team member's set of assigned warehouses wholesale - only
 * meaningful for location-scoped roles ('Shop Manager'/'Cashier'), but
 * allowed for any member so an admin can pre-assign access before/after
 * changing someone's role.
 */
router.put('/members/:id/warehouse-access', authenticateJwt, tenantContextMiddleware, requireRole('Admin'), async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId || (req as any).user?.tenantId;
    const { id } = req.params;
    const { warehouseIds } = req.body;

    if (!Array.isArray(warehouseIds) || warehouseIds.some((w) => typeof w !== 'string')) {
      return res.status(400).json({ success: false, error: 'warehouseIds must be an array of warehouse IDs.' });
    }

    const member = await prisma.user.findFirst({ where: { id, tenantId } });
    if (!member) {
      return res.status(404).json({ success: false, error: 'Team member not found.' });
    }

    if (warehouseIds.length > 0) {
      const validWarehouses = await prisma.warehouse.findMany({
        where: { id: { in: warehouseIds }, tenantId },
        select: { id: true },
      });
      if (validWarehouses.length !== new Set(warehouseIds).size) {
        return res.status(400).json({ success: false, error: 'One or more selected warehouses do not belong to this business.' });
      }
    }

    const previousAccess = await prisma.warehouseAccess.findMany({ where: { tenantId, userId: id }, select: { warehouseId: true } });
    const previousWarehouseIds = previousAccess.map((a) => a.warehouseId);

    await prisma.$transaction(async (tx) => {
      await tx.warehouseAccess.deleteMany({ where: { tenantId, userId: id } });
      if (warehouseIds.length > 0) {
        await tx.warehouseAccess.createMany({
          data: warehouseIds.map((warehouseId: string) => ({ tenantId, userId: id, warehouseId })),
        });
      }

      await recordAuditLogTx(tx, {
        action: 'WAREHOUSE_ACCESS.UPDATED',
        entity: 'WarehouseAccess',
        entityId: id,
        tenantId,
        actor: actorFromRequest(req),
        changes: { warehouseIds: { from: previousWarehouseIds, to: warehouseIds } },
        details: `Shop access updated for team member ${member.email}.`,
      });
    });

    return res.status(200).json({ success: true, message: 'Warehouse access updated.', data: { warehouseIds } });
  } catch (error: any) {
    console.error('[TenantMembers] Error updating warehouse access:', error);
    return res.status(500).json({ success: false, error: 'Failed to update warehouse access.' });
  }
});

/**
 * PUT /api/v1/tenants/members/:id/role (Admin only)
 * Changes an existing team member's role. Role is otherwise only ever set
 * once, at invite time - this is the first way to change it afterward.
 * Note: role is baked into the member's JWT at login, so this takes effect
 * the next time they log in, not on their currently active session.
 */
router.put('/members/:id/role', authenticateJwt, tenantContextMiddleware, requireRole('Admin'), async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId || (req as any).user?.tenantId;
    const { id } = req.params;
    const { role } = req.body;

    if (typeof role !== 'string' || !CLOSED_ROLES.includes(role as any)) {
      return res.status(400).json({
        success: false,
        error: `Role must be one of: ${CLOSED_ROLES.join(', ')}.`,
      });
    }

    const member = await prisma.user.findFirst({ where: { id, tenantId } });
    if (!member) {
      return res.status(404).json({ success: false, error: 'Team member not found.' });
    }

    if (member.role === role) {
      return res.status(200).json({ success: true, message: 'Member already has this role.', data: { role } });
    }

    // Never allow a tenant to lock itself out by demoting its last Admin.
    if (member.role === 'Admin' && role !== 'Admin') {
      const otherAdmins = await prisma.user.count({ where: { tenantId, role: 'Admin', isActive: true, id: { not: id } } });
      if (otherAdmins === 0) {
        return res.status(400).json({
          success: false,
          error: 'Cannot change this role - they are the only Admin on this workspace. Promote another member to Admin first.',
        });
      }
    }

    const previousRole = member.role;
    const updated = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({ where: { id }, data: { role } });

      await recordAuditLogTx(tx, {
        action: 'TEAM_MEMBER.ROLE_CHANGED',
        entity: 'User',
        entityId: id,
        tenantId,
        actor: actorFromRequest(req),
        changes: { role: { from: previousRole, to: role } },
        details: `Role changed for team member ${member.email} (${previousRole} -> ${role}).`,
      });

      return updated;
    });

    return res.status(200).json({
      success: true,
      message: 'Role updated. This takes effect the next time the member logs in.',
      data: { id: updated.id, role: updated.role },
    });
  } catch (error: any) {
    console.error('[TenantMembers] Error updating member role:', error);
    return res.status(500).json({ success: false, error: 'Failed to update team member role.' });
  }
});

/**
 * DELETE /api/v1/tenants/members/:id (Admin only)
 * Permanently removes a team member from the workspace - there was
 * previously no way to do this at all. Frees up their email (globally
 * unique on User) for reuse elsewhere, e.g. registering their own separate
 * tenant. WarehouseAccess rows cascade-delete via the schema's onDelete:
 * Cascade FK; AuditLog/Notification rows referencing this userId are bare
 * columns (no FK) by existing convention and are intentionally left intact
 * as historical record.
 */
router.delete('/members/:id', authenticateJwt, tenantContextMiddleware, requireRole('Admin'), async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId || (req as any).user?.tenantId;
    const callerId = (req as any).user?.id;
    const { id } = req.params;

    if (id === callerId) {
      return res.status(400).json({ success: false, error: 'You cannot remove your own account. Have another Admin do it.' });
    }

    const member = await prisma.user.findFirst({ where: { id, tenantId } });
    if (!member) {
      return res.status(404).json({ success: false, error: 'Team member not found.' });
    }

    // Never allow a tenant to lock itself out by removing its last Admin.
    if (member.role === 'Admin') {
      const otherAdmins = await prisma.user.count({ where: { tenantId, role: 'Admin', isActive: true, id: { not: id } } });
      if (otherAdmins === 0) {
        return res.status(400).json({
          success: false,
          error: 'Cannot remove this member - they are the only Admin on this workspace. Promote another member to Admin first.',
        });
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.user.delete({ where: { id } });

      await recordAuditLogTx(tx, {
        action: 'TEAM_MEMBER.REMOVED',
        entity: 'User',
        entityId: id,
        tenantId,
        actor: actorFromRequest(req),
        details: `Team member removed: ${member.name} (${member.email}), role ${member.role}.`,
      });
    });

    return res.status(200).json({ success: true, message: 'Team member removed.' });
  } catch (error: any) {
    console.error('[TenantMembers] Error removing member:', error);
    return res.status(500).json({ success: false, error: 'Failed to remove team member.' });
  }
});

/**
 * GET /api/v1/tenants/invitations (Admin / Accountant)
 * Returns all pending invitations for the current tenant.
 */
router.get('/invitations', authenticateJwt, tenantContextMiddleware, requireRole('Accountant'), async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId || (req as any).user?.tenantId;
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: 'Tenant ID context is required to view invitations.',
      });
    }

    const invitations = await prisma.invitation.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });

    return res.status(200).json({
      success: true,
      data: { invitations },
    });
  } catch (error: any) {
    console.error('[TenantInvitations] Error fetching invitations:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve invitations',
    });
  }
});

export default router;
