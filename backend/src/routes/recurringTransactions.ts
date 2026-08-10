import { Router, Request, Response } from 'express';
import { authenticateJwt } from '../middleware/authMiddleware';
import { tenantContextMiddleware } from '../middleware/tenantContextMiddleware';
import { requireRole } from '../middleware/rbacMiddleware';
import { requireTenantContext } from '../context/tenantContext';
import * as recurringTransactionService from '../services/recurringTransactionService';
import { RecurringTransactionServiceError } from '../services/recurringTransactionService';
import { actorFromRequest } from '../services/auditLogService';

const router = Router();

router.use(authenticateJwt);
router.use(tenantContextMiddleware);

function handleError(res: Response, error: any, fallbackMessage: string): void {
  if (error instanceof RecurringTransactionServiceError) {
    res.status(error.statusCode).json({ success: false, error: error.message });
    return;
  }
  console.error('[RecurringTransactions] Error:', error);
  res.status(500).json({ success: false, error: fallbackMessage });
}

/**
 * GET /api/v1/recurring-transactions
 */
router.get('/', requireRole('Viewer'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const recurringTransactions = await recurringTransactionService.listRecurringTransactions(tenantId);
    res.status(200).json({ success: true, data: { recurringTransactions } });
  } catch (error: any) {
    handleError(res, error, 'Failed to retrieve recurring transactions.');
  }
});

/**
 * GET /api/v1/recurring-transactions/:id
 */
router.get('/:id', requireRole('Viewer'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const recurringTransaction = await recurringTransactionService.getRecurringTransactionById(tenantId, req.params.id);
    if (!recurringTransaction) {
      res.status(404).json({ success: false, error: `Recurring transaction with ID "${req.params.id}" not found.` });
      return;
    }
    res.status(200).json({ success: true, data: { recurringTransaction } });
  } catch (error: any) {
    handleError(res, error, 'Failed to retrieve recurring transaction.');
  }
});

/**
 * POST /api/v1/recurring-transactions
 * Access: Accountant role or higher.
 */
router.post('/', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const recurringTransaction = await recurringTransactionService.createRecurringTransaction(tenantId, req.body, actorFromRequest(req));
    res.status(201).json({ success: true, message: 'Recurring transaction created successfully', data: { recurringTransaction } });
  } catch (error: any) {
    handleError(res, error, 'Failed to create recurring transaction.');
  }
});

/**
 * PUT /api/v1/recurring-transactions/:id
 * Access: Accountant role or higher.
 */
router.put('/:id', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const recurringTransaction = await recurringTransactionService.updateRecurringTransaction(tenantId, req.params.id, req.body, actorFromRequest(req));
    res.status(200).json({ success: true, message: 'Recurring transaction updated successfully', data: { recurringTransaction } });
  } catch (error: any) {
    handleError(res, error, 'Failed to update recurring transaction.');
  }
});

/**
 * DELETE /api/v1/recurring-transactions/:id
 * Access: Accountant role or higher.
 */
router.delete('/:id', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    await recurringTransactionService.deleteRecurringTransaction(tenantId, req.params.id, actorFromRequest(req));
    res.status(200).json({ success: true, message: 'Recurring transaction deleted successfully' });
  } catch (error: any) {
    handleError(res, error, 'Failed to delete recurring transaction.');
  }
});

export default router;
