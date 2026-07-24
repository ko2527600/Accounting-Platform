import nodemailer from 'nodemailer';
import { prisma } from '../config/db';
import { withCurrentTenantDb } from '../database/tenantClient';

export interface EmailAttachment {
  filename: string;
  content: Buffer | string;
  contentType?: string;
}

export class EmailService {
  private static transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: Number(process.env.EMAIL_PORT) || 465,
    secure: process.env.EMAIL_SECURE !== 'false',
    auth: {
      user: process.env.EMAIL_USER || 'ko2527600@gmail.com',
      pass: process.env.EMAIL_PASS || 'hvrb jnbh pmdi bowm',
    },
  });

  /**
   * Sends an email with retry logic and audit logging.
   * If initial send fails, retries ONCE after 5 minutes.
   * If retry fails, logs "Critical Failure" in audit_logs.
   */
  public static async sendMail(
    to: string,
    subject: string,
    html: string,
    attachments: EmailAttachment[] = []
  ): Promise<boolean> {
    const from = process.env.EMAIL_USER || 'ko2527600@gmail.com';

    const mailOptions = {
      from: `"AccountGo ERP" <${from}>`,
      to,
      subject,
      html,
      attachments,
    };

    if (process.env.NODE_ENV === 'test' && !process.env.EMAIL_TEST_LIVE) {
      // Mock dispatch in test environment
      return true;
    }

    try {
      await this.transporter.sendMail(mailOptions);

      // Log successful email dispatch in AuditLog
      await this.logAudit('EMAIL_SENT', `Weekly executive report email sent to ${to} (${subject}).`);
      return true;
    } catch (firstErr: any) {
      console.warn(`[EmailService] Primary email dispatch to ${to} failed. Retrying in 5 minutes... Error:`, firstErr.message);

      // Retry once after 5 minutes (300,000ms)
      setTimeout(async () => {
        try {
          await this.transporter.sendMail(mailOptions);
          await this.logAudit('EMAIL_SENT', `Retry succeeded: Weekly executive report sent to ${to}.`);
        } catch (retryErr: any) {
          console.error(`[EmailService] Critical Failure: Retry dispatch to ${to} failed:`, retryErr.message);
          await this.logAudit(
            'CRITICAL_FAILURE',
            `Critical Failure: Automated email report to ${to} failed twice. Error: ${retryErr.message}`
          );
        }
      }, 300000);

      return false;
    }
  }

  /**
   * Sends weekly executive Profit & Loss performance summary with HTML formatting.
   */
  public static async sendWeeklyExecutiveReport(
    to: string,
    tenantName: string,
    reportData: { weeklySales: number; topShopName: string; totalItemsSold: number }
  ): Promise<boolean> {
    const subject = `📊 AccountGo Weekly Executive Performance - ${tenantName}`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; rounded-lg: 8px;">
        <h2 style="color: #0f172a; border-bottom: 2px solid #3b82f6; padding-bottom: 10px;">
          Weekly Executive Performance Summary
        </h2>
        <p style="font-size: 14px; color: #475569;">
          Here is your automated weekly business breakdown for <strong>${tenantName}</strong>.
        </p>

        <div style="background-color: #f8fafc; padding: 15px; border-radius: 6px; margin: 20px 0;">
          <h3 style="margin-top: 0; color: #1e293b; font-size: 16px;">Week at a Glance</h3>
          <ul style="font-size: 14px; color: #334155; line-height: 1.6;">
            <li><strong>Total Weekly Cash Sales:</strong> GH₵ ${reportData.weeklySales.toFixed(2)}</li>
            <li><strong>Top Performing Branch:</strong> ${reportData.topShopName}</li>
            <li><strong>Total Items Sold:</strong> ${reportData.totalItemsSold} pcs</li>
          </ul>
        </div>

        <p style="font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 15px;">
          Generated automatically by <strong>AccountGo Multi-Tenant ERP</strong>. All shop closeouts and ledger records are reconciled.
        </p>
      </div>
    `;

    return this.sendMail(to, subject, html);
  }

  private static async logAudit(action: string, details: string): Promise<void> {
    try {
      await withCurrentTenantDb(prisma, async (client) => {
        return (client as any).auditLog.create({
          data: {
            action,
            entity: 'EMAIL_SERVICE',
            details,
          },
        });
      });
    } catch (err) {
      console.error('[EmailService] Failed to record audit log:', err);
    }
  }
}
