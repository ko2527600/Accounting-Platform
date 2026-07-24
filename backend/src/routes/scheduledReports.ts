import { Router, Request, Response } from 'express';
import { authenticateJwt } from '../middleware/authMiddleware';
import { tenantContextMiddleware } from '../middleware/tenantContextMiddleware';
import { requireRole } from '../middleware/rbacMiddleware';
import * as reportingService from '../services/reportingService';

const router = Router();

router.use(authenticateJwt);
router.use(tenantContextMiddleware);

// In-memory tenant schedule settings cache
const tenantSchedules: Record<string, { frequency: string; recipients: string[]; reportType: string; enabled: boolean }> = {};

/**
 * POST /api/v1/reports/schedule
 * Saves recurring report delivery settings.
 */
router.post('/schedule', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = (req as any).tenantId;
    const { frequency, recipients, reportType, enabled } = req.body;

    if (!Array.isArray(recipients) || recipients.length === 0) {
      res.status(400).json({
        success: false,
        error: 'At least one recipient email address is required.',
      });
      return;
    }

    const schedule = {
      frequency: frequency || 'Weekly',
      recipients,
      reportType: reportType || 'ProfitAndLoss',
      enabled: enabled !== undefined ? Boolean(enabled) : true,
    };

    tenantSchedules[tenantId] = schedule;

    res.status(200).json({
      success: true,
      message: 'Scheduled report preferences saved successfully.',
      data: { schedule },
    });
  } catch (error: any) {
    console.error('[ScheduledReports] Error saving schedule:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to save scheduled report settings.',
    });
  }
});

/**
 * GET /api/v1/reports/schedule
 * Retrieves current recurring report settings.
 */
router.get('/schedule', async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = (req as any).tenantId;
    const schedule = tenantSchedules[tenantId] || {
      frequency: 'Weekly',
      recipients: [],
      reportType: 'ProfitAndLoss',
      enabled: false,
    };

    res.status(200).json({
      success: true,
      data: { schedule },
    });
  } catch (error: any) {
    console.error('[ScheduledReports] Error fetching schedule:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch schedule settings.',
    });
  }
});

/**
 * GET /api/v1/reports/export/pdf
 * Generates print-ready HTML/PDF report data.
 */
router.get('/export/pdf', async (req: Request, res: Response): Promise<void> => {
  try {
    const { reportType = 'profit-loss' } = req.query;

    let pnlData = null;
    if (reportType === 'profit-loss') {
      pnlData = await reportingService.getProfitAndLoss();
    }

    res.status(200).json({
      success: true,
      data: {
        reportType,
        generatedAt: new Date().toISOString(),
        content: pnlData,
      },
    });
  } catch (error: any) {
    console.error('[ExportPDF] Error generating PDF export:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate PDF report export.',
    });
  }
});

/**
 * POST /api/v1/reports/schedule/test-email
 * Triggers an instant test executive email report via Nodemailer/Gmail SMTP.
 */
router.post('/schedule/test-email', async (req: Request, res: Response): Promise<void> => {
  try {
    const { recipientEmail } = req.body;
    const { EmailService } = require('../services/EmailService');

    const email = recipientEmail || (req as any).user?.email || 'owner@example.com';
    const tenantName = (req as any).tenantName || 'AccountGo Workspace';

    const success = await EmailService.sendWeeklyExecutiveReport(email, tenantName, {
      weeklySales: 3450.00,
      topShopName: 'Osu Downtown Shop',
      totalItemsSold: 28,
    });

    if (success) {
      res.status(200).json({ success: true, message: `Test executive email dispatched to ${email}.` });
    } else {
      res.status(500).json({ success: false, error: 'Failed to send test email report.' });
    }
  } catch (error: any) {
    console.error('[ScheduledReports] Error dispatching test email:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to dispatch test email.' });
  }
});

export default router;
