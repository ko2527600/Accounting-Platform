import { Router, Request, Response } from 'express';
import { prisma } from '../config/db';
import { BroadcastService } from '../services/broadcastService';

const router = Router();

const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

function verifyAdminPasscode(req: Request): boolean {
  const passcode = (req.query.passcode as string) || (req.headers['x-admin-passcode'] as string | undefined);
  return !!passcode && BroadcastService.verifyPasscode(passcode);
}

/**
 * GET /api/v1/admin/feedback
 * Platform-wide feedback view across ALL tenants — Admin Core Engine only,
 * gated by the master broadcast passcode. The tenant-scoped GET /api/v1/feedback
 * route (Admin/Auditor JWT) remains separate. This endpoint is read-only;
 * mark-reviewed is intentionally omitted here since that route requires a
 * tenant JWT.
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    if (!verifyAdminPasscode(req)) {
      res.status(401).json({ success: false, error: 'Unauthorized: valid master passcode required.' });
      return;
    }

    const { tenantId, category, status, dateFrom, dateTo, limit = '50', page = '1' } = req.query;

    const where: Record<string, any> = {};
    if (tenantId) where.tenantId = String(tenantId);
    if (category) where.category = String(category);
    if (status) where.status = String(status);

    if (dateFrom || dateTo) {
      if (dateFrom && !DATE_FORMAT.test(String(dateFrom))) {
        res.status(400).json({ success: false, error: 'Invalid dateFrom format. Expected YYYY-MM-DD.' });
        return;
      }
      if (dateTo && !DATE_FORMAT.test(String(dateTo))) {
        res.status(400).json({ success: false, error: 'Invalid dateTo format. Expected YYYY-MM-DD.' });
        return;
      }
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(`${dateFrom}T00:00:00.000Z`);
      if (dateTo) where.createdAt.lte = new Date(`${dateTo}T23:59:59.999Z`);
    }

    const take = Math.min(parseInt(limit as string, 10) || 50, 200);
    const skip = (parseInt(page as string, 10) - 1) * take;

    const [items, total] = await Promise.all([
      prisma.feedback.findMany({ where, take, skip, orderBy: { createdAt: 'desc' } }),
      prisma.feedback.count({ where }),
    ]);

    // Join tenant names in application code (no Prisma relation on tenantId)
    const tenantIds = [...new Set(items.map((f) => f.tenantId).filter(Boolean))];
    const tenants = tenantIds.length > 0
      ? await prisma.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, name: true, slug: true } })
      : [];
    const tenantById = new Map(tenants.map((t) => [t.id, t]));

    const itemsWithTenant = items.map((f) => ({
      ...f,
      tenant: tenantById.get(f.tenantId) ?? null,
    }));

    res.status(200).json({
      success: true,
      data: {
        items: itemsWithTenant,
        pagination: {
          total,
          page: parseInt(page as string, 10),
          limit: take,
          totalPages: Math.ceil(total / take),
        },
      },
    });
  } catch (error: any) {
    console.error('[AdminFeedback] Error fetching platform-wide feedback:', error);
    res.status(500).json({ success: false, error: 'Failed to retrieve feedback.' });
  }
});

export default router;
