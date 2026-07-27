import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { prisma } from '../config/db';
import { onboardTenant, TenantOnboardingError } from '../services/tenantService';
import * as tenantRepository from '../repository/tenantRepository';
import { authenticateJwt } from '../middleware/authMiddleware';
import { tenantContextMiddleware } from '../middleware/tenantContextMiddleware';
import { requireRole } from '../middleware/rbacMiddleware';
import { BroadcastService } from '../services/broadcastService';
import { CLOSED_ROLES, isLocationScopedRole } from '../services/warehouseAccessService';
import { recordAuditLog, actorFromRequest, diffFields } from '../services/auditLogService';

const router = Router();

/**
 * POST /api/v1/tenants/onboard
 * Registers a new tenant in public.tenants, provisions PostgreSQL schema (tenant_<slug>),
 * runs initial DDL migrations, registers tenant Admin user in public.users,
 * and returns tenant details and Admin JWT token.
 */
router.post('/onboard', async (req: Request, res: Response) => {
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
      data: { tenants },
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
      data: { tenant },
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
    const { companyName, name, slug, baseCurrency } = req.body;
    const newName = (companyName || name || '').trim();

    if (!tenantId) {
      return res.status(400).json({ success: false, error: 'Tenant ID context required.' });
    }

    const updated = await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        ...(newName && { name: newName }),
        ...(slug && { slug: slug.trim().toLowerCase() }),
        ...(baseCurrency && { baseCurrency: baseCurrency.trim().toUpperCase() }),
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Tenant settings updated successfully',
      data: { tenant: updated },
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
    const invitation = await prisma.invitation.create({
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

    await recordAuditLog({
      action: 'INVITATION.SENT',
      entity: 'Invitation',
      entityId: invitation.id,
      tenantId,
      actor: actorFromRequest(req),
      details: `Invited ${invitation.email} as ${invitation.role}.`,
    });

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

    await prisma.$transaction([
      prisma.warehouseAccess.deleteMany({ where: { tenantId, userId: id } }),
      ...(warehouseIds.length > 0
        ? [prisma.warehouseAccess.createMany({
            data: warehouseIds.map((warehouseId: string) => ({ tenantId, userId: id, warehouseId })),
          })]
        : []),
    ]);

    await recordAuditLog({
      action: 'WAREHOUSE_ACCESS.UPDATED',
      entity: 'WarehouseAccess',
      entityId: id,
      tenantId,
      actor: actorFromRequest(req),
      changes: { warehouseIds: { from: previousWarehouseIds, to: warehouseIds } },
      details: `Shop access updated for team member ${member.email}.`,
    });

    return res.status(200).json({ success: true, message: 'Warehouse access updated.', data: { warehouseIds } });
  } catch (error: any) {
    console.error('[TenantMembers] Error updating warehouse access:', error);
    return res.status(500).json({ success: false, error: 'Failed to update warehouse access.' });
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
