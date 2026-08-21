import { Router, Request, Response } from 'express';
import { authenticateJwt } from '../middleware/authMiddleware';
import { tenantContextMiddleware } from '../middleware/tenantContextMiddleware';
import { requireRole } from '../middleware/rbacMiddleware';
import { requireTier } from '../middleware/tierEnforcementMiddleware';
import * as reportingService from '../services/reportingService';
import { ReportingServiceError } from '../services/reportingService';
import { requireTenantContext } from '../context/tenantContext';
import { prisma } from '../config/db';
import { withCurrentTenantDb } from '../database/tenantClient';
import { generateBalanceSheetPdf, generateProfitAndLossPdf, generateCashFlowPdf } from '../services/pdfGenerationService';
import { generateBalanceSheetDocx, generateProfitAndLossDocx, generateCashFlowDocx } from '../services/reportDocxService';
import * as cashFlowForecastService from '../services/cashFlowForecastService';
import { CashFlowForecastServiceError } from '../services/cashFlowForecastService';
import * as agingReportService from '../services/agingReportService';
import { getCachedReport, setCachedReport } from '../cache/reportCache';

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
    const { tenantId } = requireTenantContext();
    const { startDate, endDate, asOfDate } = req.query;
    const params = { startDate: startDate as string, endDate: endDate as string, asOfDate: asOfDate as string };

    const cached = await getCachedReport(tenantId, 'trial-balance', params);
    if (cached) { res.status(200).json({ success: true, data: cached }); return; }

    const report = await reportingService.getTrialBalance(
      startDate ? (startDate as string) : undefined,
      endDate ? (endDate as string) : undefined,
      asOfDate ? (asOfDate as string) : undefined
    );
    void setCachedReport(tenantId, 'trial-balance', params, report);
    res.status(200).json({ success: true, data: report });
  } catch (error: any) {
    if (error instanceof ReportingServiceError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
      return;
    }
    res.status(500).json({ success: false, error: error.message || 'Internal Server Error while generating Trial Balance report.' });
  }
});

/**
 * GET /api/v1/reports/profit-loss
 * Description: Profit & Loss Statement calculating Revenue, Expenses, and Net Profit/Loss over a date range.
 * Access: Viewer role or higher
 */
router.get('/profit-loss', requireRole('Viewer'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const { startDate, endDate, asOfDate, fundId } = req.query;
    const params = { startDate: startDate as string, endDate: endDate as string, asOfDate: asOfDate as string, fundId: fundId as string };

    const cached = await getCachedReport(tenantId, 'profit-loss', params);
    if (cached) { res.status(200).json({ success: true, data: cached }); return; }

    const report = await reportingService.getProfitAndLoss(
      startDate ? (startDate as string) : undefined,
      endDate ? (endDate as string) : undefined,
      asOfDate ? (asOfDate as string) : undefined,
      fundId ? (fundId as string) : undefined
    );
    void setCachedReport(tenantId, 'profit-loss', params, report);
    res.status(200).json({ success: true, data: report });
  } catch (error: any) {
    if (error instanceof ReportingServiceError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
      return;
    }
    res.status(500).json({ success: false, error: error.message || 'Internal Server Error while generating Profit & Loss report.' });
  }
});

/**
 * GET /api/v1/reports/balance-sheet
 * Description: Balance Sheet report calculating Assets, Liabilities, Equity, Retained Earnings, verifying Assets == Liabilities + Equity.
 * Access: Viewer role or higher
 */
router.get('/balance-sheet', requireRole('Viewer'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const { asOfDate, endDate, fundId } = req.query;
    const params = { asOfDate: asOfDate as string, endDate: endDate as string, fundId: fundId as string };

    const cached = await getCachedReport(tenantId, 'balance-sheet', params);
    if (cached) { res.status(200).json({ success: true, data: cached }); return; }

    const report = await reportingService.getBalanceSheet(
      asOfDate ? (asOfDate as string) : undefined,
      endDate ? (endDate as string) : undefined,
      fundId ? (fundId as string) : undefined
    );
    void setCachedReport(tenantId, 'balance-sheet', params, report);
    res.status(200).json({ success: true, data: report });
  } catch (error: any) {
    if (error instanceof ReportingServiceError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
      return;
    }
    res.status(500).json({ success: false, error: error.message || 'Internal Server Error while generating Balance Sheet report.' });
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

    const { asOfDate, endDate, fundId } = req.query;
    const report = await reportingService.getBalanceSheet(
      asOfDate ? (asOfDate as string) : undefined,
      endDate ? (endDate as string) : undefined,
      fundId ? (fundId as string) : undefined
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

    const { startDate, endDate, asOfDate, fundId } = req.query;
    const report = await reportingService.getProfitAndLoss(
      startDate ? (startDate as string) : undefined,
      endDate ? (endDate as string) : undefined,
      asOfDate ? (asOfDate as string) : undefined,
      fundId ? (fundId as string) : undefined
    );

    const { tenantId, tenantName } = requireTenantContext();
    const { name, currency } = await resolveTenantDisplayInfo(tenantId, tenantName);
    const asOfLabel = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const filenameBase = `Profit_And_Loss_${new Date().toISOString().split('T')[0]}`;
    // The PDF/DOCX generators only know Revenue/Expenses/Net Profit - fold
    // Cost of Sales into the expenses list for export so Total Revenue -
    // Total Expenses still reconciles to Net Profit on the exported
    // document, same as it does everywhere else this report is read.
    const exportData = {
      revenues: report.revenues.map(r => ({ code: r.code, name: r.name, balance: r.amount })),
      totalRevenue: report.totalRevenue,
      expenses: [...report.costOfSales, ...report.expenses].map(e => ({ code: e.code, name: e.name, balance: e.amount })),
      totalExpenses: report.totalCostOfSales + report.totalExpenses,
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
 * Description: Indirect-method Cash Flow Statement (Operating/Investing/Financing
 * activities, Net Change in Cash) over a date range. Omit startDate/endDate for since-inception.
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
    const { tenantId } = requireTenantContext();
    const { startDate, endDate } = req.query;
    const params = { startDate: startDate as string, endDate: endDate as string };

    const cached = await getCachedReport(tenantId, 'kpis', params);
    if (cached) { res.status(200).json({ success: true, data: cached }); return; }

    const report = await reportingService.getKpiDashboard(
      startDate ? (startDate as string) : undefined,
      endDate ? (endDate as string) : undefined
    );
    void setCachedReport(tenantId, 'kpis', params, report);
    res.status(200).json({ success: true, data: report });
  } catch (error: any) {
    if (error instanceof ReportingServiceError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
      return;
    }
    res.status(500).json({ success: false, error: error.message || 'Internal Server Error while generating KPI dashboard.' });
  }
});

/**
 * GET /api/v1/reports/aging/ar
 * Accounts Receivable aging - every invoice with a real outstanding balance,
 * bucketed by days past its dueDate (Current / 1-30 / 31-60 / 61-90 / 90+).
 * Access: Viewer role or higher.
 */
router.get('/aging/ar', requireRole('Viewer'), async (_req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const result = await withCurrentTenantDb(prisma, (client) => agingReportService.getArAging(client as any, tenantId));
    res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    console.error('[Reports] Error generating AR aging:', error);
    res.status(500).json({ success: false, error: 'Failed to generate AR aging report.' });
  }
});

/**
 * GET /api/v1/reports/aging/ap
 * Accounts Payable aging - every UNPAID vendor bill, bucketed the same way
 * as AR (this schema has no partial-payment support for bills, so a bill's
 * balance due is always its full amount).
 * Access: Viewer role or higher.
 */
router.get('/aging/ap', requireRole('Viewer'), async (_req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const result = await withCurrentTenantDb(prisma, (client) => agingReportService.getApAging(client as any, tenantId));
    res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    console.error('[Reports] Error generating AP aging:', error);
    res.status(500).json({ success: false, error: 'Failed to generate AP aging report.' });
  }
});

/**
 * GET /api/v1/reports/cash-flow-forecast?days=180
 * A recurring-transaction-aware, event-grounded forward cash projection -
 * NOT a trend-based extrapolation. Every dollar traces back to a real
 * scheduled RecurringTransaction occurrence or a real outstanding
 * Invoice/VendorBill due date, weekly-bucketed. No PDF/Word export (same
 * scope call as /kpis - a forward projection is read in-app, not typically
 * submitted as a formal document).
 * Access: Viewer role or higher.
 */
router.get('/cash-flow-forecast', requireRole('Viewer'), async (req: Request, res: Response): Promise<void> => {
  try {
    const days = req.query.days ? Number(req.query.days) : 180;
    const forecast = await cashFlowForecastService.getCashFlowForecast(days);
    res.status(200).json({
      success: true,
      data: forecast,
    });
  } catch (error: any) {
    if (error instanceof CashFlowForecastServiceError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
      return;
    }
    console.error('[Reports] Cash Flow Forecast error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal Server Error while generating Cash Flow Forecast.',
    });
  }
});

/**
 * GET /api/v1/reports/sales-channel
 * Revenue breakdown by sales channel (RETAIL vs WHOLESALE) for a date range,
 * based on POS cash sales. Includes per-channel totals and item-level detail.
 * Access: Viewer role or higher.
 */
router.get('/sales-channel', requireRole('Viewer'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const { startDate, endDate } = req.query;

    const where: any = { tenantId, status: 'COMPLETED' };
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate as string);
      if (endDate) {
        const end = new Date(endDate as string);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }

    const sales = (await withCurrentTenantDb(prisma, (client) =>
      (client as any).cashSale.findMany({
        where,
        select: {
          id: true,
          saleType: true,
          amount: true,
          createdAt: true,
          lines: {
            select: {
              itemName: true,
              itemSku: true,
              quantity: true,
              unitPrice: true,
              lineTotal: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      })
    )) as any[];

    const summary = { RETAIL: 0, WHOLESALE: 0, TOTAL: 0 };
    for (const sale of sales) {
      const type = sale.saleType === 'WHOLESALE' ? 'WHOLESALE' : 'RETAIL';
      summary[type] += Number(sale.amount);
      summary.TOTAL += Number(sale.amount);
    }

    res.status(200).json({
      success: true,
      data: {
        summary,
        sales: sales.map((s: any) => ({
          id: s.id,
          saleType: s.saleType,
          amount: Number(s.amount),
          createdAt: s.createdAt,
          lines: s.lines.map((l: any) => ({
            itemName: l.itemName,
            itemSku: l.itemSku,
            quantity: l.quantity,
            unitPrice: Number(l.unitPrice),
            lineTotal: Number(l.lineTotal),
          })),
        })),
      },
    });
  } catch (error: any) {
    console.error('[Reports] Sales Channel error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to generate sales channel report.' });
  }
});

/**
 * GET /api/v1/reports/branch-comparison
 * Per-warehouse summary: cash revenue, stock value, transfers in/out.
 * Gated at Business tier (tier 2). Access: Viewer role or higher.
 */
router.get(
  '/branch-comparison',
  requireRole('Viewer'),
  requireTier(2, 'Branch Comparison Report'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { tenantId } = requireTenantContext();
      const { startDate, endDate } = req.query;

      const dateFilter: any = {};
      if (startDate) dateFilter.gte = new Date(startDate as string);
      if (endDate) {
        const end = new Date(endDate as string);
        end.setHours(23, 59, 59, 999);
        dateFilter.lte = end;
      }

      const [warehouses, sales, transfersRaw, stocksRaw] = (await withCurrentTenantDb(prisma, (client) =>
        Promise.all([
          (client as any).warehouse.findMany({
            where: { tenantId },
            select: { id: true, name: true, location: true },
            orderBy: { name: 'asc' },
          }),
          (client as any).cashSale.groupBy({
            by: ['warehouseId'],
            where: {
              tenantId,
              status: 'COMPLETED',
              ...(Object.keys(dateFilter).length ? { createdAt: dateFilter } : {}),
            },
            _sum: { amount: true },
            _count: { id: true },
          }),
          (client as any).stockTransfer.findMany({
            where: {
              tenantId,
              ...(Object.keys(dateFilter).length ? { transferDate: dateFilter } : {}),
            },
            select: { fromWarehouseId: true, toWarehouseId: true },
          }),
          (client as any).warehouseStock.findMany({
            where: { tenantId },
            select: {
              warehouseId: true,
              quantity: true,
              item: { select: { costPrice: true } },
            },
          }),
        ])
      )) as any[];

      // Index sales by warehouseId
      const salesByWarehouse: Record<string, { revenue: number; saleCount: number }> = {};
      for (const row of sales) {
        salesByWarehouse[row.warehouseId ?? ''] = {
          revenue: Number(row._sum.amount ?? 0),
          saleCount: row._count.id,
        };
      }

      // Count transfers in/out per warehouse
      const transfersIn: Record<string, number> = {};
      const transfersOut: Record<string, number> = {};
      for (const t of transfersRaw) {
        transfersIn[t.toWarehouseId] = (transfersIn[t.toWarehouseId] ?? 0) + 1;
        transfersOut[t.fromWarehouseId] = (transfersOut[t.fromWarehouseId] ?? 0) + 1;
      }

      // Sum stock value per warehouse
      const stockValue: Record<string, number> = {};
      for (const s of stocksRaw) {
        stockValue[s.warehouseId] = (stockValue[s.warehouseId] ?? 0) + s.quantity * Number(s.item.costPrice ?? 0);
      }

      const branches = warehouses.map((w: any) => ({
        id: w.id,
        name: w.name,
        location: w.location ?? null,
        revenue: salesByWarehouse[w.id]?.revenue ?? 0,
        saleCount: salesByWarehouse[w.id]?.saleCount ?? 0,
        stockValue: stockValue[w.id] ?? 0,
        transfersIn: transfersIn[w.id] ?? 0,
        transfersOut: transfersOut[w.id] ?? 0,
      }));

      res.status(200).json({ success: true, data: { branches } });
    } catch (error: any) {
      console.error('[Reports] Branch Comparison error:', error);
      res.status(500).json({ success: false, error: error.message || 'Failed to generate branch comparison report.' });
    }
  }
);

/**
 * GET /reports/landed-costs
 * Per-shipment landed cost summary: primary purchase bills with all linked
 * freight/customs/duty bills and their per-item allocation.
 * Gated at Business tier - importers/distributors feature.
 */
router.get(
  '/landed-costs',
  requireTier(2, 'Landed Cost Report'),
  requireRole('Viewer'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { tenantId } = requireTenantContext();
      const { from, to } = req.query as { from?: string; to?: string };

      const dateFilter: any = {};
      if (from) dateFilter.gte = new Date(from);
      if (to) {
        const toDate = new Date(to);
        toDate.setHours(23, 59, 59, 999);
        dateFilter.lte = toDate;
      }

      // Primary bills that have at least one landed cost bill linked to them
      const primaryBills = await withCurrentTenantDb(prisma, async (client) => {
        return (client as any).vendorBill.findMany({
          where: {
            tenantId,
            billType: 'STANDARD',
            landedCostBills: { some: {} },
            ...(Object.keys(dateFilter).length ? { billDate: dateFilter } : {}),
          },
          include: {
            vendor: true,
            lines: { include: { item: true } },
            landedCostBills: {
              include: { vendor: true },
            },
          },
          orderBy: { billDate: 'desc' },
        });
      }) as any[];

      const result = primaryBills.map((bill: any) => {
        const totalGoodsCost = Number(bill.baseCurrencyAmount ?? bill.amount);
        const totalLandedCost = bill.landedCostBills.reduce(
          (sum: number, lc: any) => sum + Number(lc.baseCurrencyAmount ?? lc.amount),
          0
        );
        const grandTotal = Math.round((totalGoodsCost + totalLandedCost) * 100) / 100;

        // Allocate landed cost proportionally across line items by line total
        const linesTotal = bill.lines.reduce((s: number, l: any) => s + Number(l.lineTotal), 0);
        const itemBreakdown = bill.lines.map((line: any) => {
          const lineShare = linesTotal > 0 ? Number(line.lineTotal) / linesTotal : 0;
          const allocatedLanded = Math.round(totalLandedCost * lineShare * 100) / 100;
          const totalLineCost = Math.round((Number(line.lineTotal) + allocatedLanded) * 100) / 100;
          const effectiveUnitCost = line.quantity > 0
            ? Math.round((totalLineCost / line.quantity) * 100) / 100
            : 0;
          return {
            itemId: line.itemId,
            itemName: line.item?.name ?? 'Unknown',
            itemSku: line.item?.sku ?? '',
            quantity: line.quantity,
            originalUnitCost: Number(line.unitCost),
            landedCostAllocation: allocatedLanded,
            totalLineCost,
            effectiveUnitCost,
          };
        });

        return {
          billId: bill.id,
          billNumber: bill.billNumber,
          billDate: bill.billDate,
          vendorName: bill.vendor.name,
          currency: bill.currency,
          goodsCost: totalGoodsCost,
          landedCosts: bill.landedCostBills.map((lc: any) => ({
            billId: lc.id,
            billNumber: lc.billNumber,
            vendorName: lc.vendor.name,
            description: lc.billNumber,
            amount: Number(lc.baseCurrencyAmount ?? lc.amount),
            currency: lc.currency,
          })),
          totalLandedCost: Math.round(totalLandedCost * 100) / 100,
          grandTotal,
          itemBreakdown,
        };
      });

      res.status(200).json({ success: true, data: result });
    } catch (error: any) {
      console.error('[Reports] Landed Cost Report error:', error);
      res.status(500).json({ success: false, error: error.message || 'Failed to generate landed cost report.' });
    }
  }
);

/**
 * GET /reports/analytics/trends?months=12
 * Monthly revenue / expenses / net-profit trend for the last N months.
 * Reuses getProfitAndLoss per month so the numbers are identical to the P&L
 * the accountant already trusts. months: 3 | 6 | 12 (default 12, max 24).
 * Access: Viewer role or higher.
 */
router.get('/analytics/trends', requireRole('Viewer'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const months = Math.min(24, Math.max(1, parseInt((req.query.months as string) || '12', 10) || 12));
    const params = { months: String(months) };

    const cached = await getCachedReport(tenantId, 'analytics-trends', params);
    if (cached) { res.json({ success: true, data: cached }); return; }

    const now = new Date();
    const series: Array<{
      month: string;
      label: string;
      revenue: number;
      cogs: number;
      expenses: number;
      netProfit: number;
    }> = [];

    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const startDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      const endDate = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;

      const pnl = await reportingService.getProfitAndLoss(startDate, endDate, undefined, undefined);
      series.push({
        month: startDate.slice(0, 7),
        label: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
        revenue: pnl.totalRevenue,
        cogs: pnl.totalCostOfSales,
        expenses: pnl.totalExpenses,
        netProfit: pnl.netProfit,
      });
    }

    void setCachedReport(tenantId, 'analytics-trends', params, { series });
    res.json({ success: true, data: { series } });
  } catch (error: any) {
    console.error('[Reports] Analytics trends error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to generate analytics trends.' });
  }
});

/**
 * GET /reports/analytics/top-customers?startDate=&endDate=&limit=10
 * Top customers ranked by total invoiced-and-paid revenue in the date range.
 * Access: Viewer role or higher.
 */
router.get('/analytics/top-customers', requireRole('Viewer'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const { startDate, endDate } = req.query;
    const limit = Math.min(25, Math.max(1, parseInt((req.query.limit as string) || '10', 10) || 10));
    const params = { startDate: startDate as string, endDate: endDate as string, limit: String(limit) };
    const cached = await getCachedReport(tenantId, 'analytics-top-customers', params);
    if (cached) { res.json({ success: true, data: cached }); return; }

    const dateFilter: any = {};
    if (startDate) dateFilter.gte = new Date(startDate as string);
    if (endDate) {
      const end = new Date(endDate as string);
      end.setHours(23, 59, 59, 999);
      dateFilter.lte = end;
    }

    // Sum amountPaid on invoices per customer within the date range.
    const invoices = await withCurrentTenantDb(prisma, (client) =>
      (client as any).invoice.findMany({
        where: {
          tenantId,
          customerId: { not: null },
          amountPaid: { gt: 0 },
          ...(Object.keys(dateFilter).length ? { createdAt: dateFilter } : {}),
        },
        select: {
          customerId: true,
          amountPaid: true,
          customer: { select: { id: true, name: true, email: true, customerType: true } },
        },
      })
    ) as any[];

    const byCustomer: Record<string, { id: string; name: string; email: string; customerType: string; revenue: number; invoiceCount: number }> = {};
    for (const inv of invoices) {
      if (!inv.customerId || !inv.customer) continue;
      const key = inv.customerId;
      if (!byCustomer[key]) {
        byCustomer[key] = {
          id: inv.customer.id,
          name: inv.customer.name,
          email: inv.customer.email ?? '',
          customerType: inv.customer.customerType ?? 'RETAIL',
          revenue: 0,
          invoiceCount: 0,
        };
      }
      byCustomer[key].revenue += Number(inv.amountPaid ?? 0);
      byCustomer[key].invoiceCount += 1;
    }

    const customers = Object.values(byCustomer)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, limit);

    void setCachedReport(tenantId, 'analytics-top-customers', params, { customers });
    res.json({ success: true, data: { customers } });
  } catch (error: any) {
    console.error('[Reports] Top customers error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to generate top customers report.' });
  }
});

/**
 * GET /reports/analytics/top-items?startDate=&endDate=&limit=10
 * Top-selling items ranked by total POS line revenue in the date range.
 * Access: Viewer role or higher.
 */
router.get('/analytics/top-items', requireRole('Viewer'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const { startDate, endDate } = req.query;
    const limit = Math.min(25, Math.max(1, parseInt((req.query.limit as string) || '10', 10) || 10));
    const params = { startDate: startDate as string, endDate: endDate as string, limit: String(limit) };
    const cached = await getCachedReport(tenantId, 'analytics-top-items', params);
    if (cached) { res.json({ success: true, data: cached }); return; }

    const dateFilter: any = {};
    if (startDate) dateFilter.gte = new Date(startDate as string);
    if (endDate) {
      const end = new Date(endDate as string);
      end.setHours(23, 59, 59, 999);
      dateFilter.lte = end;
    }

    const lines = await withCurrentTenantDb(prisma, (client) =>
      (client as any).cashSaleLine.findMany({
        where: {
          tenantId,
          sale: {
            status: 'COMPLETED',
            ...(Object.keys(dateFilter).length ? { createdAt: dateFilter } : {}),
          },
        },
        select: { itemId: true, itemName: true, itemSku: true, quantity: true, lineTotal: true },
      })
    ) as any[];

    const byItem: Record<string, { itemId: string; itemName: string; itemSku: string; revenue: number; quantity: number; txnCount: number }> = {};
    for (const l of lines) {
      const key = l.itemId;
      if (!byItem[key]) {
        byItem[key] = { itemId: l.itemId, itemName: l.itemName, itemSku: l.itemSku, revenue: 0, quantity: 0, txnCount: 0 };
      }
      byItem[key].revenue += Number(l.lineTotal ?? 0);
      byItem[key].quantity += Number(l.quantity ?? 0);
      byItem[key].txnCount += 1;
    }

    const items = Object.values(byItem)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, limit);

    void setCachedReport(tenantId, 'analytics-top-items', params, { items });
    res.json({ success: true, data: { items } });
  } catch (error: any) {
    console.error('[Reports] Top items error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to generate top items report.' });
  }
});

export default router;
