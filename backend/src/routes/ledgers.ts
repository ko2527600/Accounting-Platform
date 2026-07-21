import { Router, Request, Response } from 'express';
import { authenticateJwt } from '../middleware/authMiddleware';
import { tenantContextMiddleware } from '../middleware/tenantContextMiddleware';
import { requireRole } from '../middleware/rbacMiddleware';
import * as ledgerService from '../services/ledgerService';
import { LedgerServiceError } from '../services/ledgerService';

const router = Router();

// Enforce authentication & tenant context on all ledger endpoints
router.use(authenticateJwt);
router.use(tenantContextMiddleware);

/**
 * GET /api/v1/ledgers
 * Description: List ledger transactions across tenant COA with filters & pagination.
 * Access: Viewer role or higher
 */
router.get('/', requireRole('Viewer'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { accountId, startDate, endDate, search, page, limit } = req.query;

    const filter = {
      ...(accountId ? { accountId: accountId as string } : {}),
      ...(startDate ? { startDate: startDate as string } : {}),
      ...(endDate ? { endDate: endDate as string } : {}),
      ...(search ? { search: search as string } : {}),
      ...(page ? { page: parseInt(page as string, 10) } : {}),
      ...(limit ? { limit: parseInt(limit as string, 10) } : {}),
    };

    const result = await ledgerService.listLedgers(filter);
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    if (error instanceof LedgerServiceError) {
      res.status(error.statusCode).json({
        success: false,
        error: error.message,
      });
      return;
    }
    res.status(500).json({
      success: false,
      error: error.message || 'Internal Server Error while fetching ledger transactions.',
    });
  }
});

/**
 * GET /api/v1/ledgers/summary
 * Description: General ledger summary across Chart of Accounts.
 * Access: Viewer role or higher
 */
router.get('/summary', requireRole('Viewer'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { startDate, endDate } = req.query;

    const summary = await ledgerService.getLedgerSummary(
      startDate ? (startDate as string) : undefined,
      endDate ? (endDate as string) : undefined
    );

    res.status(200).json({
      success: true,
      data: summary,
    });
  } catch (error: any) {
    if (error instanceof LedgerServiceError) {
      res.status(error.statusCode).json({
        success: false,
        error: error.message,
      });
      return;
    }
    res.status(500).json({
      success: false,
      error: error.message || 'Internal Server Error while generating general ledger summary.',
    });
  }
});

/**
 * GET /api/v1/ledgers/accounts/:accountId
 * Description: Get account ledger statement with opening balance, running totals, and closing balance.
 * Access: Viewer role or higher
 */
router.get('/accounts/:accountId', requireRole('Viewer'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { accountId } = req.params;
    const { startDate, endDate } = req.query;

    const statement = await ledgerService.getAccountStatement(
      accountId,
      startDate ? (startDate as string) : undefined,
      endDate ? (endDate as string) : undefined
    );

    res.status(200).json({
      success: true,
      data: statement,
    });
  } catch (error: any) {
    if (error instanceof LedgerServiceError) {
      res.status(error.statusCode).json({
        success: false,
        error: error.message,
      });
      return;
    }
    res.status(500).json({
      success: false,
      error: error.message || 'Internal Server Error while fetching account ledger statement.',
    });
  }
});

/**
 * GET /api/v1/ledgers/:accountId (Alias support for /accounts/:accountId)
 * Access: Viewer role or higher
 */
router.get('/:accountId', requireRole('Viewer'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { accountId } = req.params;
    if (accountId === 'summary') {
      const { startDate, endDate } = req.query;
      const summary = await ledgerService.getLedgerSummary(
        startDate ? (startDate as string) : undefined,
        endDate ? (endDate as string) : undefined
      );
      res.status(200).json({
        success: true,
        data: summary,
      });
      return;
    }

    const { startDate, endDate } = req.query;
    const statement = await ledgerService.getAccountStatement(
      accountId,
      startDate ? (startDate as string) : undefined,
      endDate ? (endDate as string) : undefined
    );

    res.status(200).json({
      success: true,
      data: statement,
    });
  } catch (error: any) {
    if (error instanceof LedgerServiceError) {
      res.status(error.statusCode).json({
        success: false,
        error: error.message,
      });
      return;
    }
    res.status(500).json({
      success: false,
      error: error.message || 'Internal Server Error while fetching account ledger statement.',
    });
  }
});

export default router;
