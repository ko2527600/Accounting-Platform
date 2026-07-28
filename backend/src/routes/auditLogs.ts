import { Router, Request, Response } from 'express';
import { prisma } from '../config/db';
import { withCurrentTenantDb } from '../database/tenantClient';
import { authenticateJwt } from '../middleware/authMiddleware';
import { tenantContextMiddleware } from '../middleware/tenantContextMiddleware';
import { requireRole } from '../middleware/rbacMiddleware';
import { requireTenantContext } from '../context/tenantContext';
import { buildCsv } from '../utils/csvExport';

const router = Router();

router.use(authenticateJwt);
router.use(tenantContextMiddleware);

const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Builds the shared Prisma `where` clause for both the paginated list and
 * the CSV export, so filtering behaves identically between them. Returns
 * `{ error }` instead of throwing on a malformed date so both callers can
 * respond with their own consistent error shape.
 */
function buildAuditLogWhere(
  tenantId: string,
  query: Request['query']
): { where: Record<string, any> } | { error: string } {
  const { action, entity, userEmail, dateFrom, dateTo } = query;
  const where: Record<string, any> = { tenantId };

  if (action) where.action = { contains: String(action), mode: 'insensitive' };
  if (entity) where.entity = { contains: String(entity), mode: 'insensitive' };
  if (userEmail) where.userEmail = { contains: String(userEmail), mode: 'insensitive' };

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

/**
 * GET /api/v1/audit-logs
 * Retrieves activity logs for the active tenant. Supports optional filters:
 * action, entity, userEmail (all substring/case-insensitive), and a
 * dateFrom/dateTo (YYYY-MM-DD, inclusive) createdAt range.
 * Access: Admin or Auditor role.
 */
router.get('/', requireRole('Auditor'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const { limit = '50', page = '1' } = req.query;
    const take = parseInt(limit as string, 10);
    const skip = (parseInt(page as string, 10) - 1) * take;

    const filterResult = buildAuditLogWhere(tenantId, req.query);
    if ('error' in filterResult) {
      res.status(400).json({ success: false, error: filterResult.error });
      return;
    }
    const { where } = filterResult;

    const logs = await withCurrentTenantDb(prisma, async (client) => {
      return (client as any).auditLog.findMany({
        where,
        take,
        skip,
        orderBy: { createdAt: 'desc' },
      });
    });

    const totalCount = await withCurrentTenantDb(prisma, async (client) => {
      return (client as any).auditLog.count({ where });
    });

    res.status(200).json({
      success: true,
      data: {
        logs,
        pagination: {
          total: totalCount,
          page: parseInt(page as string, 10),
          limit: take,
          totalPages: Math.ceil(totalCount / take),
        },
      },
    });
  } catch (error: any) {
    console.error('[AuditLogs] Error fetching logs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve audit logs.',
    });
  }
});

const EXPORT_ROW_CAP = 5000;

/**
 * GET /api/v1/audit-logs/export
 * Downloads the currently-filtered audit log (same filters as the list
 * endpoint, no pagination) as a real CSV of the matching rows - capped at
 * EXPORT_ROW_CAP most recent matches to keep the request bounded.
 * Access: Admin or Auditor role.
 */
router.get('/export', requireRole('Auditor'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();

    const filterResult = buildAuditLogWhere(tenantId, req.query);
    if ('error' in filterResult) {
      res.status(400).json({ success: false, error: filterResult.error });
      return;
    }
    const { where } = filterResult;

    const logs = await withCurrentTenantDb(prisma, async (client) => {
      return (client as any).auditLog.findMany({
        where,
        take: EXPORT_ROW_CAP,
        orderBy: { createdAt: 'desc' },
      });
    });

    const csv = buildCsv(
      ['Timestamp', 'Action', 'Entity', 'Entity ID', 'User Email', 'User ID', 'IP Address', 'Details', 'Changes'],
      logs.map((log: any) => [
        log.createdAt.toISOString(),
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
    res.setHeader('Content-Disposition', `attachment; filename="audit-log-export-${Date.now()}.csv"`);
    res.status(200).send(csv);
  } catch (error: any) {
    console.error('[AuditLogs] Error exporting logs:', error);
    res.status(500).json({ success: false, error: 'Failed to export audit logs.' });
  }
});

export default router;
