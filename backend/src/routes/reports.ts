import { Router, Request, Response } from 'express';
import { authenticateJwt } from '../middleware/authMiddleware';
import { tenantContextMiddleware } from '../middleware/tenantContextMiddleware';
import { requireRole } from '../middleware/rbacMiddleware';
import * as reportingService from '../services/reportingService';
import { ReportingServiceError } from '../services/reportingService';

const router = Router();

// Enforce authentication & tenant context on all reports endpoints
router.use(authenticateJwt);
router.use(tenantContextMiddleware);

/**
 * GET /api/v1/reports/trial-balance
 * Description: Trial Balance report listing accounts with Debit/Credit balances verifying total debits == total credits.
 * Access: Viewer role or higher
 */
router.get('/trial-balance', requireRole('Viewer'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { startDate, endDate, asOfDate } = req.query;
    const report = await reportingService.getTrialBalance(
      startDate ? (startDate as string) : undefined,
      endDate ? (endDate as string) : undefined,
      asOfDate ? (asOfDate as string) : undefined
    );
    res.status(200).json({
      success: true,
      data: report,
    });
  } catch (error: any) {
    if (error instanceof ReportingServiceError) {
      res.status(error.statusCode).json({
        success: false,
        error: error.message,
      });
      return;
    }
    res.status(500).json({
      success: false,
      error: error.message || 'Internal Server Error while generating Trial Balance report.',
    });
  }
});

/**
 * GET /api/v1/reports/profit-loss
 * Description: Profit & Loss Statement calculating Revenue, Expenses, and Net Profit/Loss over a date range.
 * Access: Viewer role or higher
 */
router.get('/profit-loss', requireRole('Viewer'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { startDate, endDate, asOfDate } = req.query;
    const report = await reportingService.getProfitAndLoss(
      startDate ? (startDate as string) : undefined,
      endDate ? (endDate as string) : undefined,
      asOfDate ? (asOfDate as string) : undefined
    );
    res.status(200).json({
      success: true,
      data: report,
    });
  } catch (error: any) {
    if (error instanceof ReportingServiceError) {
      res.status(error.statusCode).json({
        success: false,
        error: error.message,
      });
      return;
    }
    res.status(500).json({
      success: false,
      error: error.message || 'Internal Server Error while generating Profit & Loss report.',
    });
  }
});

/**
 * GET /api/v1/reports/balance-sheet
 * Description: Balance Sheet report calculating Assets, Liabilities, Equity, Retained Earnings, verifying Assets == Liabilities + Equity.
 * Access: Viewer role or higher
 */
router.get('/balance-sheet', requireRole('Viewer'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { asOfDate, endDate } = req.query;
    const report = await reportingService.getBalanceSheet(
      asOfDate ? (asOfDate as string) : undefined,
      endDate ? (endDate as string) : undefined
    );
    res.status(200).json({
      success: true,
      data: report,
    });
  } catch (error: any) {
    if (error instanceof ReportingServiceError) {
      res.status(error.statusCode).json({
        success: false,
        error: error.message,
      });
      return;
    }
    res.status(500).json({
      success: false,
      error: error.message || 'Internal Server Error while generating Balance Sheet report.',
    });
  }
});

export default router;
