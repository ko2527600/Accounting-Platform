import { Router, Request, Response } from 'express';
import { authenticateJwt } from '../middleware/authMiddleware';
import { tenantContextMiddleware } from '../middleware/tenantContextMiddleware';
import { requireRole } from '../middleware/rbacMiddleware';
import { requireTenantContext } from '../context/tenantContext';
import * as approvalWorkflowService from '../services/approvalWorkflowService';
import { ApprovalWorkflowServiceError } from '../services/approvalWorkflowService';

const router = Router();

router.use(authenticateJwt);
router.use(tenantContextMiddleware);

function handleError(res: Response, error: any, fallbackMessage: string): void {
  if (error instanceof ApprovalWorkflowServiceError) {
    res.status(error.statusCode).json({ success: false, error: error.message });
    return;
  }
  console.error('[ApprovalWorkflows] Error:', error);
  res.status(500).json({ success: false, error: fallbackMessage });
}

/**
 * GET /api/v1/approval-workflows?status=PENDING&mine=true
 * `mine=true` restricts to workflows with a step pending decision by the caller.
 */
router.get('/', requireRole('Viewer'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const approverId = req.query.mine === 'true' ? (req as any).user?.id : undefined;
    const approvalWorkflows = await approvalWorkflowService.listApprovalWorkflows(tenantId, { status, approverId });
    res.status(200).json({ success: true, data: { approvalWorkflows } });
  } catch (error: any) {
    handleError(res, error, 'Failed to retrieve approval workflows.');
  }
});

/**
 * GET /api/v1/approval-workflows/:id
 */
router.get('/:id', requireRole('Viewer'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const approvalWorkflow = await approvalWorkflowService.getApprovalWorkflowById(tenantId, req.params.id);
    if (!approvalWorkflow) {
      res.status(404).json({ success: false, error: `Approval workflow with ID "${req.params.id}" not found.` });
      return;
    }
    res.status(200).json({ success: true, data: { approvalWorkflow } });
  } catch (error: any) {
    handleError(res, error, 'Failed to retrieve approval workflow.');
  }
});

/**
 * POST /api/v1/approval-workflows
 * Access: Accountant role or higher - requesting approval for an entity.
 */
router.post('/', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const requestedBy = (req as any).user?.id || (req as any).user?.email;
    const approvalWorkflow = await approvalWorkflowService.createApprovalWorkflow(tenantId, requestedBy, req.body);
    res.status(201).json({ success: true, message: 'Approval workflow created successfully', data: { approvalWorkflow } });
  } catch (error: any) {
    handleError(res, error, 'Failed to create approval workflow.');
  }
});

/**
 * POST /api/v1/approval-workflows/:id/steps/:level/decide
 * body: { decision: 'APPROVE' | 'REJECT', comments? }
 * Access: Accountant role or higher.
 */
router.post('/:id/steps/:level/decide', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const { decision, comments } = req.body;
    if (decision !== 'APPROVE' && decision !== 'REJECT') {
      res.status(400).json({ success: false, error: 'decision must be "APPROVE" or "REJECT".' });
      return;
    }
    const level = Number(req.params.level);
    const approvalWorkflow = await approvalWorkflowService.decideApprovalStep(tenantId, req.params.id, level, decision, comments);
    res.status(200).json({ success: true, message: `Step ${level} ${decision.toLowerCase()}d.`, data: { approvalWorkflow } });
  } catch (error: any) {
    handleError(res, error, 'Failed to record approval decision.');
  }
});

export default router;
