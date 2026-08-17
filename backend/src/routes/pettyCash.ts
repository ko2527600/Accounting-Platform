import { Router, Request, Response } from 'express';
import { authenticateJwt } from '../middleware/authMiddleware';
import { tenantContextMiddleware } from '../middleware/tenantContextMiddleware';
import { requireRole } from '../middleware/rbacMiddleware';
import { requireTenantContext } from '../context/tenantContext';
import { actorFromRequest } from '../services/auditLogService';
import * as pettyCashService from '../services/pettyCashService';
import { PettyCashServiceError } from '../services/pettyCashService';

const router = Router();

router.use(authenticateJwt);
router.use(tenantContextMiddleware);

/**
 * GET /api/v1/petty-cash?accountId=X
 * Every entry against one petty cash account, oldest-first, with a running
 * balance - the account must be given explicitly since a tenant could
 * plausibly run more than one petty cash tin (e.g. per shop location).
 */
router.get('/', requireRole('Viewer'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const { accountId } = req.query;
    if (!accountId || typeof accountId !== 'string') {
      res.status(400).json({ success: false, error: 'accountId query parameter is required.' });
      return;
    }
    const result = await pettyCashService.listPettyCashEntries(tenantId, accountId);
    res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    console.error('[PettyCash] Error listing entries:', error);
    res.status(500).json({ success: false, error: 'Failed to retrieve petty cash entries.' });
  }
});

/**
 * POST /api/v1/petty-cash
 * Records one disbursement or replenishment, posting a real journal entry
 * immediately (see pettyCashService.recordPettyCashEntry).
 */
router.post('/', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const { direction, description, amount, entryDate, pettyCashAccountId, counterAccountId } = req.body;

    const result = await pettyCashService.recordPettyCashEntry(
      { tenantId, direction, description, amount, entryDate, pettyCashAccountId, counterAccountId },
      actorFromRequest(req)
    );

    res.status(201).json({
      success: true,
      message: 'Petty cash entry recorded and journal entry posted.',
      data: result,
    });
  } catch (error: any) {
    if (error instanceof PettyCashServiceError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
      return;
    }
    console.error('[PettyCash] Error recording entry:', error);
    res.status(500).json({ success: false, error: 'Failed to record petty cash entry.' });
  }
});

export default router;
