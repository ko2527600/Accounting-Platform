import { Router, Request, Response } from 'express';
import { authenticateJwt } from '../middleware/authMiddleware';
import { tenantContextMiddleware } from '../middleware/tenantContextMiddleware';
import { requireRole } from '../middleware/rbacMiddleware';
import { requireTenantContext } from '../context/tenantContext';
import * as fiscalPeriodService from '../services/fiscalPeriodService';
import { FiscalPeriodServiceError } from '../services/fiscalPeriodService';
import { actorFromRequest } from '../services/auditLogService';

const router = Router();

router.use(authenticateJwt);
router.use(tenantContextMiddleware);

function handleError(res: Response, error: any, fallbackMessage: string): void {
  if (error instanceof FiscalPeriodServiceError) {
    res.status(error.statusCode).json({ success: false, error: error.message });
    return;
  }
  console.error('[FiscalPeriods] Error:', error);
  res.status(500).json({ success: false, error: fallbackMessage });
}

/**
 * GET /api/v1/fiscal-periods
 */
router.get('/', requireRole('Viewer'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const fiscalPeriods = await fiscalPeriodService.listFiscalPeriods(tenantId);
    res.status(200).json({ success: true, data: { fiscalPeriods } });
  } catch (error: any) {
    handleError(res, error, 'Failed to retrieve fiscal periods.');
  }
});

/**
 * GET /api/v1/fiscal-periods/:id
 */
router.get('/:id', requireRole('Viewer'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const fiscalPeriod = await fiscalPeriodService.getFiscalPeriodById(tenantId, req.params.id);
    if (!fiscalPeriod) {
      res.status(404).json({ success: false, error: `Fiscal period with ID "${req.params.id}" not found.` });
      return;
    }
    res.status(200).json({ success: true, data: { fiscalPeriod } });
  } catch (error: any) {
    handleError(res, error, 'Failed to retrieve fiscal period.');
  }
});

/**
 * POST /api/v1/fiscal-periods
 * Access: Accountant role or higher.
 */
router.post('/', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const fiscalPeriod = await fiscalPeriodService.createFiscalPeriod(tenantId, req.body, actorFromRequest(req));
    res.status(201).json({ success: true, message: 'Fiscal period created successfully', data: { fiscalPeriod } });
  } catch (error: any) {
    handleError(res, error, 'Failed to create fiscal period.');
  }
});

/**
 * PATCH /api/v1/fiscal-periods/:id/close
 * Access: Accountant role or higher.
 */
router.patch('/:id/close', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const closedBy = (req as any).user?.email || (req as any).user?.id;
    const fiscalPeriod = await fiscalPeriodService.closeFiscalPeriod(tenantId, req.params.id, closedBy, actorFromRequest(req));
    res.status(200).json({ success: true, message: 'Fiscal period closed.', data: { fiscalPeriod } });
  } catch (error: any) {
    handleError(res, error, 'Failed to close fiscal period.');
  }
});

/**
 * PATCH /api/v1/fiscal-periods/:id/lock
 * Access: Admin role only - locking is a stronger, harder-to-reverse action than closing.
 */
router.patch('/:id/lock', requireRole('Admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const fiscalPeriod = await fiscalPeriodService.lockFiscalPeriod(tenantId, req.params.id, actorFromRequest(req));
    res.status(200).json({ success: true, message: 'Fiscal period locked.', data: { fiscalPeriod } });
  } catch (error: any) {
    handleError(res, error, 'Failed to lock fiscal period.');
  }
});

export default router;
