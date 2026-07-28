import { Router, Request, Response } from 'express';
import { prisma } from '../config/db';
import { BroadcastService } from '../services/broadcastService';
import { buildCsv } from '../utils/csvExport';

const router = Router();

const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Builds the shared Prisma `where` clause for both the paginated list and
 * the CSV export, so filtering behaves identically between them. Returns
 * `{ error }` instead of throwing on a malformed date so both callers can
 * respond with their own consistent error shape.
 */
function buildAdminAuditLogWhere(
  query: Request['query']
): { where: Record<string, any> } | { error: string } {
  const { action, entity, userEmail, tenantId, dateFrom, dateTo } = query;
  const where: Record<string, any> = {};

  if (action) where.action = { contains: String(action), mode: 'insensitive' };
  if (entity) where.entity = { contains: String(entity), mode: 'insensitive' };
  if (userEmail) where.userEmail = { contains: String(userEmail), mode: 'insensitive' };
  if (tenantId) where.tenantId = String(tenantId);

  if (dateFrom || dateTo) {
    if (dateFrom && !DATE_FORMAT.test(String(dateFrom))) {
      return { error: 'Invalid dateFrom format. Expected YYYY-MM-DD.' };
    }
    if (dateTo && !DATE_FORMAT.test(String(dateTo))) {
      return { error: 'Invalid dateTo format. Expected YYYY-MM-DD.' };
    }
    where.createdAt = {};
    if (dateFrom) where.createdAt.gte = new Date(`${dateFrom}T00:00:00.000Z`);
    if (dateTo) where.createdAt.lte = new Date(`${dateTo}T23:59:59.999Z`);
  }

  return { where };
}

function verifyAdminPasscode(req: Request): boolean {
  const passcode = (req.query.passcode as string) || (req.headers['x-admin-passcode'] as string | undefined);
  return !!passcode && BroadcastService.verifyPasscode(passcode);
}

async function joinTenants(logs: { tenantId: string | null }[]) {
  const tenantIds = [...new Set(logs.map((log) => log.tenantId).filter((id): id is string => Boolean(id)))];
  const tenants = tenantIds.length > 0
    ? await prisma.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, name: true, slug: true } })
    : [];
  return new Map(tenants.map((t) => [t.id, t]));
}

/**
 * GET /api/v1/admin/audit-logs
 * Platform-wide audit log view across ALL tenants - a platform-operator
 * function (used by the Admin Core Engine console's "System Audit Logs" tab),
 * gated by the master broadcast passcode rather than a tenant JWT, matching
 * GET /api/v1/tenants's existing pattern. The tenant-scoped GET /api/v1/audit-logs
 * route stays intentionally restricted to the caller's own tenant - this is
 * a separate, deliberately platform-wide endpoint.
 *
 * Supports optional filters: action, entity, userEmail (all substring/
 * case-insensitive), tenantId (exact), and a dateFrom/dateTo (YYYY-MM-DD,
 * inclusive) createdAt range.
 *
 * AuditLog.tenantId has no Prisma relation to Tenant (a bare shared column,
 * like every other tenantId-column table in this schema), so the tenant
 * name/slug are joined in application code rather than via `include`.
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    if (!verifyAdminPasscode(req)) {
      res.status(401).json({ success: false, error: 'Unauthorized: valid master passcode required.' });
      return;
    }

    const filterResult = buildAdminAuditLogWhere(req.query);
    if ('error' in filterResult) {
      res.status(400).json({ success: false, error: filterResult.error });
      return;
    }
    const { where } = filterResult;

    const { limit = '50', page = '1' } = req.query;
    const take = parseInt(limit as string, 10);
    const skip = (parseInt(page as string, 10) - 1) * take;

    const [logs, totalCount] = await Promise.all([
      prisma.auditLog.findMany({ where, take, skip, orderBy: { createdAt: 'desc' } }),
      prisma.auditLog.count({ where }),
    ]);

    const tenantById = await joinTenants(logs);
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

const EXPORT_ROW_CAP = 5000;

/**
 * GET /api/v1/admin/audit-logs/export
 * Downloads the currently-filtered platform-wide audit log (same filters
 * and passcode gate as the list endpoint, no pagination) as a real CSV,
 * capped at EXPORT_ROW_CAP most recent matches.
 */
router.get('/export', async (req: Request, res: Response): Promise<void> => {
  try {
    if (!verifyAdminPasscode(req)) {
      res.status(401).json({ success: false, error: 'Unauthorized: valid master passcode required.' });
      return;
    }

    const filterResult = buildAdminAuditLogWhere(req.query);
    if ('error' in filterResult) {
      res.status(400).json({ success: false, error: filterResult.error });
      return;
    }
    const { where } = filterResult;

    const logs = await prisma.auditLog.findMany({ where, take: EXPORT_ROW_CAP, orderBy: { createdAt: 'desc' } });
    const tenantById = await joinTenants(logs);

    const csv = buildCsv(
      ['Timestamp', 'Tenant', 'Action', 'Entity', 'Entity ID', 'User Email', 'User ID', 'IP Address', 'Details', 'Changes'],
      logs.map((log) => [
        log.createdAt.toISOString(),
        log.tenantId ? tenantById.get(log.tenantId)?.name || log.tenantId : 'Platform',
        log.action,
        log.entity,
        log.entityId || '',
        log.userEmail || '',
        log.userId || '',
        log.ipAddress || '',
        log.details || '',
        log.changes ? JSON.stringify(log.changes) : '',
      ])
    );

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="platform-audit-log-export-${Date.now()}.csv"`);
    res.status(200).send(csv);
  } catch (error: any) {
    console.error('[AdminAuditLogs] Error exporting platform-wide logs:', error);
    res.status(500).json({ success: false, error: 'Failed to export audit logs.' });
  }
});

export default router;
