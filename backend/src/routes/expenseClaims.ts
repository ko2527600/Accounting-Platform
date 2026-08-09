import { Router, Request, Response } from 'express';
import { authenticateJwt } from '../middleware/authMiddleware';
import { tenantContextMiddleware } from '../middleware/tenantContextMiddleware';
import { requireRole } from '../middleware/rbacMiddleware';
import { requireTenantContext } from '../context/tenantContext';
import * as expenseClaimService from '../services/expenseClaimService';
import { ExpenseClaimServiceError } from '../services/expenseClaimService';
import { ApprovalWorkflowServiceError } from '../services/approvalWorkflowService';
import { JournalEntryServiceError } from '../services/journalEntryService';
import { actorFromRequest } from '../services/auditLogService';

const router = Router();

router.use(authenticateJwt);
router.use(tenantContextMiddleware);

function handleError(res: Response, error: any, fallbackMessage: string): void {
  if (
    error instanceof ExpenseClaimServiceError ||
    error instanceof ApprovalWorkflowServiceError ||
    error instanceof JournalEntryServiceError
  ) {
    res.status(error.statusCode).json({ success: false, error: error.message });
    return;
  }
  console.error('[ExpenseClaims] Error:', error);
  res.status(500).json({ success: false, error: fallbackMessage });
}

/**
 * GET /api/v1/expense-claims?status=PENDING_APPROVAL&mine=true
 * `mine=true` restricts to the caller's own claims.
 */
router.get('/', requireRole('Viewer'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const mine = req.query.mine === 'true' ? (req as any).user?.id : undefined;
    const expenseClaims = await expenseClaimService.listExpenseClaims(tenantId, { status, mine });
    res.status(200).json({ success: true, data: { expenseClaims } });
  } catch (error: any) {
    handleError(res, error, 'Failed to retrieve expense claims.');
  }
});

/**
 * GET /api/v1/expense-claims/:id
 */
router.get('/:id', requireRole('Viewer'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const claim = await expenseClaimService.getExpenseClaimById(tenantId, req.params.id);
    if (!claim) {
      res.status(404).json({ success: false, error: `Expense claim with ID "${req.params.id}" not found.` });
      return;
    }
    res.status(200).json({ success: true, data: { expenseClaim: claim } });
  } catch (error: any) {
    handleError(res, error, 'Failed to retrieve expense claim.');
  }
});

/**
 * POST /api/v1/expense-claims
 * Any tenant member may file a claim for their own out-of-pocket spend -
 * intentionally the loosest role gate (mirrors GET /approval-workflows),
 * since deciding and reimbursing are the privileged steps, not filing.
 */
router.post('/', requireRole('Viewer'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const actor = actorFromRequest(req);
    const submittedByName = (req as any).user?.name || (req as any).user?.email || 'Unknown';
    const claim = await expenseClaimService.submitExpenseClaim(tenantId, actor, submittedByName, req.body);
    res.status(201).json({ success: true, message: 'Expense claim submitted for approval.', data: { expenseClaim: claim } });
  } catch (error: any) {
    handleError(res, error, 'Failed to submit expense claim.');
  }
});

/**
 * POST /api/v1/expense-claims/:id/decide
 * body: { decision: 'APPROVE' | 'REJECT', comments? }
 * Access: Accountant role or higher.
 */
router.post('/:id/decide', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const { decision, comments } = req.body;
    if (decision !== 'APPROVE' && decision !== 'REJECT') {
      res.status(400).json({ success: false, error: 'decision must be "APPROVE" or "REJECT".' });
      return;
    }
    const actor = actorFromRequest(req);
    const claim = await expenseClaimService.decideExpenseClaim(tenantId, req.params.id, decision, comments, actor);
    res.status(200).json({ success: true, message: `Expense claim ${decision.toLowerCase()}d.`, data: { expenseClaim: claim } });
  } catch (error: any) {
    handleError(res, error, 'Failed to record decision on expense claim.');
  }
});

/**
 * POST /api/v1/expense-claims/:id/reimburse
 * Posts the real Expense/Cash journal entry. Access: Accountant role or higher.
 */
router.post('/:id/reimburse', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const actor = actorFromRequest(req);
    const claim = await expenseClaimService.reimburseExpenseClaim(tenantId, req.params.id, actor);
    res.status(200).json({ success: true, message: 'Expense claim reimbursed and journal entry posted.', data: { expenseClaim: claim } });
  } catch (error: any) {
    handleError(res, error, 'Failed to reimburse expense claim.');
  }
});

export default router;
