import { Router, Request, Response } from 'express';
import { authenticateJwt } from '../middleware/authMiddleware';
import { tenantContextMiddleware } from '../middleware/tenantContextMiddleware';
import { requireRole } from '../middleware/rbacMiddleware';
import * as reportingService from '../services/reportingService';
import { ReportingServiceError } from '../services/reportingService';
import { requireTenantContext } from '../context/tenantContext';
import { prisma } from '../config/db';
import { generateBalanceSheetPdf, generateProfitAndLossPdf, generateCashFlowPdf } from '../services/pdfGenerationService';
import { generateBalanceSheetDocx, generateProfitAndLossDocx, generateCashFlowDocx } from '../services/reportDocxService';

const router = Router();

async function resolveTenantDisplayInfo(tenantId: string, tenantName: string | undefined): Promise<{ name: string; currency: string }> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { baseCurrency: true } });
  return { name: tenantName || 'Business', currency: tenant?.baseCurrency || 'USD' };
}

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

/**
 * GET /api/v1/reports/balance-sheet/export?format=pdf|docx
 * Downloads the Balance Sheet as a real generated PDF or Word document.
 * Access: Viewer role or higher (matches GET /balance-sheet).
 */
router.get('/balance-sheet/export', requireRole('Viewer'), async (req: Request, res: Response): Promise<void> => {
  try {
    const format = req.query.format as string;
    if (format !== 'pdf' && format !== 'docx') {
      res.status(400).json({ success: false, error: 'Query param "format" must be "pdf" or "docx".' });
      return;
    }

    const { asOfDate, endDate } = req.query;
    const report = await reportingService.getBalanceSheet(
      asOfDate ? (asOfDate as string) : undefined,
      endDate ? (endDate as string) : undefined
    );

    const { tenantId, tenantName } = requireTenantContext();
    const { name, currency } = await resolveTenantDisplayInfo(tenantId, tenantName);
    const asOfLabel = report.asOfDate
      ? new Date(report.asOfDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
      : new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    const filenameBase = `Balance_Sheet_${new Date().toISOString().split('T')[0]}`;

    if (format === 'pdf') {
      const buffer = await generateBalanceSheetPdf(name, currency, asOfLabel, report);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=${filenameBase}.pdf`);
      res.status(200).send(buffer);
    } else {
      const buffer = await generateBalanceSheetDocx(name, currency, asOfLabel, report);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename=${filenameBase}.docx`);
      res.status(200).send(buffer);
    }
  } catch (error: any) {
    if (error instanceof ReportingServiceError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
      return;
    }
    console.error('[Reports] Balance Sheet export error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to generate Balance Sheet export.' });
  }
});

/**
 * GET /api/v1/reports/profit-loss/export?format=pdf|docx
 * Downloads the Profit & Loss statement as a real generated PDF or Word document.
 * Access: Viewer role or higher (matches GET /profit-loss).
 */
router.get('/profit-loss/export', requireRole('Viewer'), async (req: Request, res: Response): Promise<void> => {
  try {
    const format = req.query.format as string;
    if (format !== 'pdf' && format !== 'docx') {
      res.status(400).json({ success: false, error: 'Query param "format" must be "pdf" or "docx".' });
      return;
    }

    const { startDate, endDate, asOfDate } = req.query;
    const report = await reportingService.getProfitAndLoss(
      startDate ? (startDate as string) : undefined,
      endDate ? (endDate as string) : undefined,
      asOfDate ? (asOfDate as string) : undefined
    );

    const { tenantId, tenantName } = requireTenantContext();
    const { name, currency } = await resolveTenantDisplayInfo(tenantId, tenantName);
    const asOfLabel = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const filenameBase = `Profit_And_Loss_${new Date().toISOString().split('T')[0]}`;
    const exportData = {
      revenues: report.revenues.map(r => ({ code: r.code, name: r.name, balance: r.amount })),
      totalRevenue: report.totalRevenue,
      expenses: report.expenses.map(e => ({ code: e.code, name: e.name, balance: e.amount })),
      totalExpenses: report.totalExpenses,
      netProfit: report.netProfit,
      isProfit: report.isProfit,
    };

    if (format === 'pdf') {
      const buffer = await generateProfitAndLossPdf(name, currency, asOfLabel, exportData);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=${filenameBase}.pdf`);
      res.status(200).send(buffer);
    } else {
      const buffer = await generateProfitAndLossDocx(name, currency, asOfLabel, exportData);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename=${filenameBase}.docx`);
      res.status(200).send(buffer);
    }
  } catch (error: any) {
    if (error instanceof ReportingServiceError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
      return;
    }
    console.error('[Reports] Profit & Loss export error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to generate Profit & Loss export.' });
  }
});

/**
 * GET /api/v1/reports/cash-flow
 * Description: Indirect-method Cash Flow Statement (Operating/Financing activities,
 * Net Change in Cash) over a date range. Omit startDate/endDate for since-inception.
 * Access: Viewer role or higher
 */
router.get('/cash-flow', requireRole('Viewer'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { startDate, endDate } = req.query;
    const report = await reportingService.getCashFlowStatement(
      startDate ? (startDate as string) : undefined,
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
      error: error.message || 'Internal Server Error while generating Cash Flow Statement.',
    });
  }
});

/**
 * GET /api/v1/reports/cash-flow/export?format=pdf|docx
 * Downloads the Cash Flow Statement as a real generated PDF or Word document.
 * Access: Viewer role or higher (matches GET /cash-flow).
 */
router.get('/cash-flow/export', requireRole('Viewer'), async (req: Request, res: Response): Promise<void> => {
  try {
    const format = req.query.format as string;
    if (format !== 'pdf' && format !== 'docx') {
      res.status(400).json({ success: false, error: 'Query param "format" must be "pdf" or "docx".' });
      return;
    }

    const { startDate, endDate } = req.query;
    const report = await reportingService.getCashFlowStatement(
      startDate ? (startDate as string) : undefined,
      endDate ? (endDate as string) : undefined
    );

    const { tenantId, tenantName } = requireTenantContext();
    const { name, currency } = await resolveTenantDisplayInfo(tenantId, tenantName);
    const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const periodLabel = report.startDate
      ? `${fmtDate(report.startDate)} to ${report.endDate ? fmtDate(report.endDate) : 'present'}`
      : `Since inception to ${report.endDate ? fmtDate(report.endDate) : 'present'}`;

    const filenameBase = `Cash_Flow_Statement_${new Date().toISOString().split('T')[0]}`;

    if (format === 'pdf') {
      const buffer = await generateCashFlowPdf(name, currency, periodLabel, report);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=${filenameBase}.pdf`);
      res.status(200).send(buffer);
    } else {
      const buffer = await generateCashFlowDocx(name, currency, periodLabel, report);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename=${filenameBase}.docx`);
      res.status(200).send(buffer);
    }
  } catch (error: any) {
    if (error instanceof ReportingServiceError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
      return;
    }
    console.error('[Reports] Cash Flow Statement export error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to generate Cash Flow Statement export.' });
  }
});

/**
 * GET /api/v1/reports/kpis
 * Description: A lightweight financial ratio dashboard (Net Profit Margin, Return on
 * Assets, Debt-to-Equity, Cash Ratio, Equity Ratio) computed from Balance Sheet + P&L
 * totals. Omit startDate/endDate for since-inception. No Gross Margin/Current Ratio -
 * this schema has no COGS or current-vs-non-current classification to compute those honestly.
 * Access: Viewer role or higher
 */
router.get('/kpis', requireRole('Viewer'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { startDate, endDate } = req.query;
    const report = await reportingService.getKpiDashboard(
      startDate ? (startDate as string) : undefined,
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
      error: error.message || 'Internal Server Error while generating KPI dashboard.',
    });
  }
});

export default router;
