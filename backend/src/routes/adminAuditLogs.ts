import { Router, Request, Response } from 'express';
import { prisma } from '../config/db';
import { BroadcastService } from '../services/broadcastService';

const router = Router();

/**
 * GET /api/v1/admin/audit-logs
 * Platform-wide audit log view across ALL tenants - a platform-operator
 * function (used by the Admin Core Engine console's "System Audit Logs" tab),
 * gated by the master broadcast passcode rather than a tenant JWT, matching
 * GET /api/v1/tenants's existing pattern. The tenant-scoped GET /api/v1/audit-logs
 * route stays intentionally restricted to the caller's own tenant - this is
 * a separate, deliberately platform-wide endpoint.
 *
 * AuditLog.tenantId has no Prisma relation to Tenant (a bare shared column,
 * like every other tenantId-column table in this schema), so the tenant
 * name/slug are joined in application code rather than via `include`.
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const passcode = (req.query.passcode as string) || (req.headers['x-admin-passcode'] as string | undefined);
    if (!passcode || !BroadcastService.verifyPasscode(passcode)) {
      res.status(401).json({ success: false, error: 'Unauthorized: valid master passcode required.' });
      return;
    }

    const { limit = '50', page = '1' } = req.query;
    const take = parseInt(limit as string, 10);
    const skip = (parseInt(page as string, 10) - 1) * take;

    const [logs, totalCount] = await Promise.all([
      prisma.auditLog.findMany({ take, skip, orderBy: { createdAt: 'desc' } }),
      prisma.auditLog.count(),
    ]);

    const tenantIds = [...new Set(logs.map((log) => log.tenantId).filter((id): id is string => Boolean(id)))];
    const tenants = tenantIds.length > 0
      ? await prisma.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, name: true, slug: true } })
      : [];
    const tenantById = new Map(tenants.map((t) => [t.id, t]));

    const logsWithTenant = logs.map((log) => ({
      ...log,
      tenant: log.tenantId ? tenantById.get(log.tenantId) || null : null,
    }));

    res.status(200).json({
      success: true,
      data: {
        logs: logsWithTenant,
        pagination: {
          total: totalCount,
          page: parseInt(page as string, 10),
          limit: take,
          totalPages: Math.ceil(totalCount / take),
        },
      },
    });
  } catch (error: any) {
    console.error('[AdminAuditLogs] Error fetching platform-wide logs:', error);
    res.status(500).json({ success: false, error: 'Failed to retrieve audit logs.' });
  }
});

export default router;
