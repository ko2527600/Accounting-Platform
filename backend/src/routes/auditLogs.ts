import { Router, Request, Response } from 'express';
import { prisma } from '../config/db';
import { withCurrentTenantDb } from '../database/tenantClient';
import { authenticateJwt } from '../middleware/authMiddleware';
import { tenantContextMiddleware } from '../middleware/tenantContextMiddleware';
import { requireRole } from '../middleware/rbacMiddleware';

const router = Router();

router.use(authenticateJwt);
router.use(tenantContextMiddleware);

/**
 * GET /api/v1/audit-logs
 * Retrieves activity logs for the active tenant.
 * Access: Admin or Auditor role.
 */
router.get('/', requireRole('Auditor'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { limit = '50', page = '1' } = req.query;
    const take = parseInt(limit as string, 10);
    const skip = (parseInt(page as string, 10) - 1) * take;

    const logs = await withCurrentTenantDb(prisma, async (client) => {
      return (client as any).auditLog.findMany({
        take,
        skip,
        orderBy: { createdAt: 'desc' },
      });
    });

    const totalCount = await withCurrentTenantDb(prisma, async (client) => {
      return (client as any).auditLog.count();
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

export default router;
