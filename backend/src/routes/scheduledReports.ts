import { Router, Request, Response } from 'express';
import { prisma } from '../config/db';
import { authenticateJwt } from '../middleware/authMiddleware';
import { tenantContextMiddleware } from '../middleware/tenantContextMiddleware';
import { requireRole } from '../middleware/rbacMiddleware';
import { requireTenantContext } from '../context/tenantContext';
import * as reportingService from '../services/reportingService';
import { computeWeeklyReportData } from '../services/scheduledEmailService';

const router = Router();

router.use(authenticateJwt);
router.use(tenantContextMiddleware);

/**
 * POST /api/v1/reports/schedule
 * Saves recurring report delivery settings. ReportSchedule is a
 * tenantId-column shared table (not per-tenant-schema), so this calls
 * `prisma` directly rather than through withCurrentTenantDb.
 */
router.post('/schedule', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const { frequency, recipients, reportType, enabled } = req.body;

    if (!Array.isArray(recipients) || recipients.length === 0) {
      res.status(400).json({
        success: false,
        error: 'At least one recipient email address is required.',
      });
      return;
    }

    const data = {
      frequency: frequency || 'Weekly',
      recipients,
      reportType: reportType || 'ProfitAndLoss',
      enabled: enabled !== undefined ? Boolean(enabled) : true,
    };

    const schedule = await (prisma as any).reportSchedule.upsert({
      where: { tenantId },
      create: { tenantId, ...data },
      update: data,
    });

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
    const { tenantId } = requireTenantContext();
    const existing = await (prisma as any).reportSchedule.findUnique({ where: { tenantId } });
    const schedule = existing || {
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
    const { tenantId, tenantName } = requireTenantContext();
    const { recipientEmail } = req.body;
    const { EmailService } = require('../services/EmailService');

    const email = recipientEmail || (req as any).user?.email || 'owner@example.com';

    // Pull the tenant's real closeout data from the last 7 days instead of
    // sending hardcoded figures in every test email.
    const reportData = await computeWeeklyReportData(tenantId);

    const success = await EmailService.sendWeeklyExecutiveReport(email, tenantName || 'Ledgio Workspace', reportData);

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
