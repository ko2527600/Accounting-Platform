import { Router, Request, Response } from 'express';
import { authenticateJwt } from '../middleware/authMiddleware';
import { tenantContextMiddleware } from '../middleware/tenantContextMiddleware';
import { requireRole } from '../middleware/rbacMiddleware';
import { requireTenantContext } from '../context/tenantContext';
import * as fundService from '../services/fundService';
import { FundServiceError } from '../services/fundService';

const router = Router();

router.use(authenticateJwt);
router.use(tenantContextMiddleware);

function handleError(res: Response, error: any, fallbackMessage: string): void {
  if (error instanceof FundServiceError) {
    res.status(error.statusCode).json({ success: false, error: error.message });
    return;
  }
  console.error('[Funds] Error:', error);
  res.status(500).json({ success: false, error: fallbackMessage });
}

/**
 * GET /api/v1/funds
 * Lists all funds for the active tenant.
 */
router.get('/', requireRole('Viewer'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const funds = await fundService.listFunds(tenantId);
    res.status(200).json({ success: true, data: { funds } });
  } catch (error: any) {
    handleError(res, error, 'Failed to retrieve funds.');
  }
});

/**
 * GET /api/v1/funds/:id
 */
router.get('/:id', requireRole('Viewer'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const fund = await fundService.getFundById(tenantId, req.params.id);
    if (!fund) {
      res.status(404).json({ success: false, error: `Fund with ID "${req.params.id}" not found.` });
      return;
    }
    res.status(200).json({ success: true, data: { fund } });
  } catch (error: any) {
    handleError(res, error, 'Failed to retrieve fund.');
  }
});

/**
 * POST /api/v1/funds
 * Creates a new fund. Access: Accountant role or higher.
 */
router.post('/', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const fund = await fundService.createFund(tenantId, req.body);
    res.status(201).json({ success: true, message: 'Fund created successfully', data: { fund } });
  } catch (error: any) {
    handleError(res, error, 'Failed to create fund.');
  }
});

/**
 * PUT /api/v1/funds/:id
 * Access: Accountant role or higher.
 */
router.put('/:id', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const fund = await fundService.updateFund(tenantId, req.params.id, req.body);
    res.status(200).json({ success: true, message: 'Fund updated successfully', data: { fund } });
  } catch (error: any) {
    handleError(res, error, 'Failed to update fund.');
  }
});

/**
 * DELETE /api/v1/funds/:id
 * Access: Accountant role or higher. Blocked if any invoice/bill/journal
 * line references it - deactivate instead.
 */
router.delete('/:id', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    await fundService.deleteFund(tenantId, req.params.id);
    res.status(200).json({ success: true, message: 'Fund deleted successfully' });
  } catch (error: any) {
    handleError(res, error, 'Failed to delete fund.');
  }
});

export default router;
