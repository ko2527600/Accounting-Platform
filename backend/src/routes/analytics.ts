import { Router, Request, Response } from 'express';
import { prisma } from '../config/db';
import { authenticateJwt } from '../middleware/authMiddleware';
import { tenantContextMiddleware } from '../middleware/tenantContextMiddleware';
import { requireTenantContext } from '../context/tenantContext';
import * as analyticsService from '../services/analyticsService';
import { buildCsv } from '../utils/csvExport';
import { generateExecutiveReportPdf, generateStockIntelligencePdf } from '../services/pdfGenerationService';
import { generateExecutiveReportDocx, generateStockIntelligenceDocx } from '../services/reportDocxService';

const router = Router();

router.use(authenticateJwt);
router.use(tenantContextMiddleware);

type ExecutiveReportType = 'daily' | 'monthly' | 'yearly' | 'closeouts';

function toExecutiveReportType(value: unknown): ExecutiveReportType {
  return value === 'monthly' || value === 'yearly' || value === 'closeouts' ? value : 'daily';
}

async function resolveTenantName(tenantId: string, tenantName: string | undefined): Promise<string> {
  if (tenantName) return tenantName;
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
  return tenant?.name || 'Business';
}

/**
 * GET /api/v1/analytics/stock-intelligence
 * Analyzes inventory sales velocity to identify Fast-Selling items, Slow-Moving (Dead) stock,
 * and generates Smart Stock Balancing Suggestions.
 */
router.get('/stock-intelligence', async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const intelligence = await analyticsService.getStockIntelligence(tenantId);
    res.status(200).json({ success: true, data: intelligence });
  } catch (error: any) {
    console.error('[Analytics] Error calculating stock intelligence:', error);
    res.status(500).json({ success: false, error: 'Failed to calculate stock intelligence.' });
  }
});

/**
 * GET /api/v1/analytics/executive-summary
 * Returns Daily, Monthly, and Yearly revenue breakdowns & shop leaderboards.
 */
router.get('/executive-summary', async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const summary = await analyticsService.getExecutiveSummary(tenantId);
    res.status(200).json({ success: true, data: summary });
  } catch (error: any) {
    console.error('[Analytics] Error fetching executive summary:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch executive summary.' });
  }
});

/**
 * GET /api/v1/analytics/export/csv?reportType=daily|monthly|yearly|closeouts|stock-intelligence
 * Downloads real report data as CSV - previously returned two hardcoded
 * sample-data strings regardless of reportType/tenant; now built from the
 * tenant's actual data via analyticsService + buildCsv().
 */
router.get('/export/csv', async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const { reportType } = req.query;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=Ledgio_${reportType || 'report'}_${Date.now()}.csv`);

    if (reportType === 'stock-intelligence') {
      const intelligence = await analyticsService.getStockIntelligence(tenantId);
      const rows = [
        ...intelligence.fastSellers.map(i => [i.sku, i.name, 'FAST_SELLING', i.totalStock]),
        ...intelligence.slowMoving.map(i => [i.sku, i.name, 'SLOW_MOVING', i.totalStock]),
      ];
      res.status(200).send(buildCsv(['SKU', 'Item Name', 'Status', 'Total Stock'], rows));
      return;
    }

    const closeouts = await analyticsService.getCloseoutsForExport(tenantId, req.user!.id, req.user!.role);
    const rows = closeouts.map((c: any) => [
      new Date(c.closedAt).toISOString().split('T')[0],
      c.warehouse?.name || '',
      c.closedBy,
      Number(c.openingCash).toFixed(2),
      Number(c.cashSales).toFixed(2),
      Number(c.expectedCash).toFixed(2),
      Number(c.actualCash).toFixed(2),
      Number(c.discrepancy).toFixed(2),
    ]);
    res.status(200).send(
      buildCsv(['Date', 'Shop Name', 'Closed By', 'Opening Cash', 'Cash Sales', 'Expected Cash', 'Actual Cash', 'Discrepancy (Over/Short)'], rows)
    );
  } catch (error: any) {
    console.error('[Analytics] CSV export error:', error);
    res.status(500).json({ success: false, error: 'Failed to generate CSV export.' });
  }
});

/**
 * GET /api/v1/analytics/export/pdf?reportType=daily|monthly|yearly|closeouts|stock-intelligence
 * Downloads real report data as a generated PDF - replaces the previous
 * window.print()-based fake "Export PDF" button on ExecutiveReports.tsx and
 * InventoryIntelligence.tsx.
 */
router.get('/export/pdf', async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId, tenantName } = requireTenantContext();
    const name = await resolveTenantName(tenantId, tenantName);
    const { reportType } = req.query;
    const filenameBase = `Ledgio_${reportType || 'report'}_${Date.now()}`;

    let buffer: Buffer;
    if (reportType === 'stock-intelligence') {
      const intelligence = await analyticsService.getStockIntelligence(tenantId);
      buffer = await generateStockIntelligencePdf(name, intelligence);
    } else {
      const type = toExecutiveReportType(reportType);
      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { baseCurrency: true } });
      const currency = tenant?.baseCurrency || 'USD';

      if (type === 'closeouts') {
        const closeouts = await analyticsService.getCloseoutsForExport(tenantId, req.user!.id, req.user!.role);
        buffer = await generateExecutiveReportPdf(name, currency, 'closeouts', {
          closeouts: closeouts.map((c: any) => ({
            closedAt: c.closedAt,
            warehouseName: c.warehouse?.name || '',
            closedBy: c.closedBy,
            openingCash: Number(c.openingCash),
            cashSales: Number(c.cashSales),
            expectedCash: Number(c.expectedCash),
            actualCash: Number(c.actualCash),
            discrepancy: Number(c.discrepancy),
          })),
        });
      } else {
        const summary = await analyticsService.getExecutiveSummary(tenantId);
        const periodTotal = type === 'daily' ? summary.dailyTotal : type === 'monthly' ? summary.monthlyTotal : summary.yearlyTotal;
        buffer = await generateExecutiveReportPdf(name, currency, type, { periodTotal, shopLeaderboard: summary.shopLeaderboard });
      }
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${filenameBase}.pdf`);
    res.status(200).send(buffer);
  } catch (error: any) {
    console.error('[Analytics] PDF export error:', error);
    res.status(500).json({ success: false, error: 'Failed to generate PDF export.' });
  }
});

/**
 * GET /api/v1/analytics/export/docx?reportType=daily|monthly|yearly|closeouts|stock-intelligence
 * Downloads real report data as a generated Word document.
 */
router.get('/export/docx', async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId, tenantName } = requireTenantContext();
    const name = await resolveTenantName(tenantId, tenantName);
    const { reportType } = req.query;
    const filenameBase = `Ledgio_${reportType || 'report'}_${Date.now()}`;

    let buffer: Buffer;
    if (reportType === 'stock-intelligence') {
      const intelligence = await analyticsService.getStockIntelligence(tenantId);
      buffer = await generateStockIntelligenceDocx(name, intelligence);
    } else {
      const type = toExecutiveReportType(reportType);
      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { baseCurrency: true } });
      const currency = tenant?.baseCurrency || 'USD';

      if (type === 'closeouts') {
        const closeouts = await analyticsService.getCloseoutsForExport(tenantId, req.user!.id, req.user!.role);
        buffer = await generateExecutiveReportDocx(name, currency, 'closeouts', {
          closeouts: closeouts.map((c: any) => ({
            closedAt: c.closedAt,
            warehouseName: c.warehouse?.name || '',
            closedBy: c.closedBy,
            expectedCash: Number(c.expectedCash),
            actualCash: Number(c.actualCash),
            discrepancy: Number(c.discrepancy),
          })),
        });
      } else {
        const summary = await analyticsService.getExecutiveSummary(tenantId);
        const periodTotal = type === 'daily' ? summary.dailyTotal : type === 'monthly' ? summary.monthlyTotal : summary.yearlyTotal;
        buffer = await generateExecutiveReportDocx(name, currency, type, { periodTotal, shopLeaderboard: summary.shopLeaderboard });
      }
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename=${filenameBase}.docx`);
    res.status(200).send(buffer);
  } catch (error: any) {
    console.error('[Analytics] DOCX export error:', error);
    res.status(500).json({ success: false, error: 'Failed to generate Word document export.' });
  }
});

export default router;
