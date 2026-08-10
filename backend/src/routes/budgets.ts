import { Router, Request, Response } from 'express';
import { authenticateJwt } from '../middleware/authMiddleware';
import { tenantContextMiddleware } from '../middleware/tenantContextMiddleware';
import { requireRole } from '../middleware/rbacMiddleware';
import { requireTenantContext } from '../context/tenantContext';
import * as budgetService from '../services/budgetService';
import { BudgetServiceError } from '../services/budgetService';
import { actorFromRequest } from '../services/auditLogService';

const router = Router();

router.use(authenticateJwt);
router.use(tenantContextMiddleware);

function handleError(res: Response, error: any, fallbackMessage: string): void {
  if (error instanceof BudgetServiceError) {
    res.status(error.statusCode).json({ success: false, error: error.message });
    return;
  }
  console.error('[Budgets] Error:', error);
  res.status(500).json({ success: false, error: fallbackMessage });
}

/**
 * GET /api/v1/budgets?fiscalPeriodId=...
 * actualAmount/variance are recomputed against real ledger activity on every read.
 */
router.get('/', requireRole('Viewer'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const fiscalPeriodId = typeof req.query.fiscalPeriodId === 'string' ? req.query.fiscalPeriodId : undefined;
    const budgets = await budgetService.listBudgets(tenantId, fiscalPeriodId);
    res.status(200).json({ success: true, data: { budgets } });
  } catch (error: any) {
    handleError(res, error, 'Failed to retrieve budgets.');
  }
});

/**
 * GET /api/v1/budgets/:id
 */
router.get('/:id', requireRole('Viewer'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const budget = await budgetService.getBudgetById(tenantId, req.params.id);
    if (!budget) {
      res.status(404).json({ success: false, error: `Budget with ID "${req.params.id}" not found.` });
      return;
    }
    res.status(200).json({ success: true, data: { budget } });
  } catch (error: any) {
    handleError(res, error, 'Failed to retrieve budget.');
  }
});

/**
 * POST /api/v1/budgets
 * Access: Accountant role or higher.
 */
router.post('/', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const budget = await budgetService.createBudget(tenantId, req.body, actorFromRequest(req));
    res.status(201).json({ success: true, message: 'Budget created successfully', data: { budget } });
  } catch (error: any) {
    handleError(res, error, 'Failed to create budget.');
  }
});

/**
 * PUT /api/v1/budgets/:id
 * Access: Accountant role or higher.
 */
router.put('/:id', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const budget = await budgetService.updateBudget(tenantId, req.params.id, req.body, actorFromRequest(req));
    res.status(200).json({ success: true, message: 'Budget updated successfully', data: { budget } });
  } catch (error: any) {
    handleError(res, error, 'Failed to update budget.');
  }
});

/**
 * DELETE /api/v1/budgets/:id
 * Access: Accountant role or higher.
 */
router.delete('/:id', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    await budgetService.deleteBudget(tenantId, req.params.id, actorFromRequest(req));
    res.status(200).json({ success: true, message: 'Budget deleted successfully' });
  } catch (error: any) {
    handleError(res, error, 'Failed to delete budget.');
  }
});

export default router;
