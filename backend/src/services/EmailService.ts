import axios from 'axios';
import { generateQuickStartGuidePdf } from './pdfGenerationService';
import { recordAuditLog } from './auditLogService';
import { escapeHtml } from '../utils/htmlEscape';

// Direct SMTP to Gmail (port 465 and 587 both) hit ETIMEDOUT connecting from
// this host - confirmed via live logs, consistent with the hosting platform
// blocking outbound SMTP entirely (a common anti-spam-abuse restriction on
// cloud/PaaS hosts). SendGrid's HTTP API sends over port 443, which isn't
// subject to that restriction.
//
// Using SendGrid's Single Sender Verification (not domain authentication):
// no domain is required, just one verified individual email address - the
// tradeoff is weaker deliverability than a verified domain (more likely to
// land in spam) and a lower sending reputation ceiling. Worth moving to a
// verified domain once one is available; see EMAIL_FROM in .env.example.
const SENDGRID_API_URL = 'https://api.sendgrid.com/v3/mail/send';

export interface EmailAttachment {
  filename: string;
  content: Buffer | string;
  contentType?: string;
}

interface SendGridEmailPayload {
  personalizations: { to: { email: string }[] }[];
  from: { email: string; name?: string };
  subject: string;
  content: { type: string; value: string }[];
  attachments?: { content: string; filename: string; type: string; disposition: 'attachment' }[];
}

export class EmailService {
  public static isConfigured(): boolean {
    // SendGrid's Single Sender Verification requires an exact, individually
    // verified from-address - unlike Resend's sandbox default, there's no
    // fallback address that works without explicit setup.
    return Boolean(process.env.SENDGRID_API_KEY?.trim() && process.env.EMAIL_FROM?.trim());
  }

  /**
   * Parses "Display Name <email@example.com>" into SendGrid's separate
   * name/email fields, falling back to treating the whole string as the
   * email if no display name is present.
   */
  private static parseFromAddress(raw: string): { email: string; name?: string } {
    const match = raw.match(/^(.*?)\s*<(.+)>$/);
    if (match) {
      return { name: match[1].trim() || undefined, email: match[2].trim() };
    }
    return { email: raw.trim() };
  }

  private static buildPayload(to: string, subject: string, html: string, attachments: EmailAttachment[]): SendGridEmailPayload {
    const from = this.parseFromAddress(process.env.EMAIL_FROM!.trim());
    return {
      personalizations: [{ to: [{ email: to }] }],
      from,
      subject,
      content: [{ type: 'text/html', value: html }],
      attachments: attachments.length > 0
        ? attachments.map((a) => ({
            filename: a.filename,
            content: (Buffer.isBuffer(a.content) ? a.content : Buffer.from(a.content)).toString('base64'),
            type: a.contentType || 'application/octet-stream',
            disposition: 'attachment' as const,
          }))
        : undefined,
    };
  }

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
    if (process.env.NODE_ENV === 'test' && !process.env.EMAIL_TEST_LIVE) {
      // Mock dispatch in test environment
      return true;
    }

    const apiKey = process.env.SENDGRID_API_KEY?.trim();
    const from = process.env.EMAIL_FROM?.trim();
    if (!apiKey || !from) {
      console.error('[EmailService] Email sending is not configured: SENDGRID_API_KEY and EMAIL_FROM environment variables are both required (EMAIL_FROM must match a Single Sender verified in SendGrid).');
      return false;
    }

    const payload = this.buildPayload(to, subject, html, attachments);
    const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };

    try {
      const res = await axios.post(SENDGRID_API_URL, payload, { headers, timeout: 10000 });
      console.log(`[EmailService] ✅ Email dispatched successfully to ${to}. Status: ${res.status}, MessageId: ${res.headers?.['x-message-id']}`);

      // Log successful email dispatch in AuditLog
      await recordAuditLog({ action: 'EMAIL_SENT', entity: 'EMAIL_SERVICE', details: `Email sent to ${to} (${subject}).` });
      return true;
    } catch (firstErr: any) {
      console.error(`[EmailService] ❌ Email dispatch error to ${to}:`, firstErr.response?.data || firstErr.message);

      // Retry once after 5 minutes (300,000ms)
      setTimeout(async () => {
        try {
          const retryRes = await axios.post(SENDGRID_API_URL, payload, { headers, timeout: 10000 });
          console.log(`[EmailService] ✅ Retry succeeded: Email dispatched to ${to}. Status: ${retryRes.status}`);
          await recordAuditLog({ action: 'EMAIL_SENT', entity: 'EMAIL_SERVICE', details: `Retry succeeded: Email sent to ${to}.` });
        } catch (retryErr: any) {
          const message = retryErr.response?.data?.errors?.[0]?.message || retryErr.message;
          console.error(`[EmailService] Critical Failure: Retry dispatch to ${to} failed:`, message);
          await recordAuditLog({
            action: 'CRITICAL_FAILURE',
            entity: 'EMAIL_SERVICE',
            details: `Critical Failure: Automated email report to ${to} failed twice. Error: ${message}`,
          });
        }
      }, 300000);

      return false;
    }
  }

  /**
   * Renders a single "vs previous period" delta as a colored span, matching
   * the red/green up-down indicators used by third-party monitoring digest
   * emails (e.g. "-5.54%"). Null means there's no prior-period data to
   * compare against (e.g. a brand-new tenant), so it renders as a neutral
   * "New" badge instead of a misleading 0%/infinite change.
   */
  private static renderDelta(changePercent: number | null): string {
    if (changePercent === null) {
      return '<span style="color: #94a3b8;">New</span>';
    }
    const isPositive = changePercent >= 0;
    const color = isPositive ? '#059669' : '#dc2626';
    const arrow = isPositive ? '▲' : '▼';
    return `<span style="color: ${color}; font-weight: 600;">${arrow} ${Math.abs(changePercent).toFixed(2)}%</span>`;
  }

  /**
   * Builds the shared stat-grid body for period executive reports (weekly
   * and monthly): a 2-column tile grid with each figure's delta vs the
   * immediately preceding period of the same length.
   */
  private static buildPeriodReportHtml(
    periodLabel: 'Week' | 'Month',
    tenantName: string,
    reportData: {
      periodSales: number;
      topShopName: string;
      totalItemsSold: number;
      salesChangePercent: number | null;
      itemsChangePercent: number | null;
    }
  ): string {
    const accent = periodLabel === 'Week' ? '#3b82f6' : '#7c3aed';
    const tile = (label: string, value: string, delta?: string) => `
      <td style="width: 50%; padding: 14px; background-color: #f8fafc; border-radius: 6px;">
        <div style="font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.03em;">${label}</div>
        <div style="font-size: 20px; font-weight: 700; color: #0f172a; margin-top: 4px;">${value}</div>
        ${delta ? `<div style="font-size: 12px; margin-top: 4px;">${delta} vs prior ${periodLabel.toLowerCase()}</div>` : ''}
      </td>
    `;

    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h2 style="color: #0f172a; border-bottom: 2px solid ${accent}; padding-bottom: 10px;">
          ${periodLabel}ly Executive Performance Summary
        </h2>
        <p style="font-size: 14px; color: #475569;">
          Here is your automated ${periodLabel.toLowerCase()}ly business breakdown for <strong>${escapeHtml(tenantName)}</strong>.
        </p>

        <table role="presentation" style="width: 100%; border-collapse: separate; border-spacing: 10px 10px; margin: 10px -10px;">
          <tr>
            ${tile('Total Cash Sales', `GH₵ ${reportData.periodSales.toFixed(2)}`, this.renderDelta(reportData.salesChangePercent))}
            ${tile('Total Items Sold', `${reportData.totalItemsSold} pcs`, this.renderDelta(reportData.itemsChangePercent))}
          </tr>
          <tr>
            ${tile('Top Performing Branch', escapeHtml(reportData.topShopName))}
          </tr>
        </table>

        <p style="font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 15px; margin-top: 15px;">
          Generated automatically by <strong>Ledgio Multi-Tenant ERP</strong>. All shop closeouts and ledger records are reconciled.
        </p>
      </div>
    `;
  }

  /**
   * Sends weekly executive Profit & Loss performance summary with HTML formatting.
   */
  public static async sendWeeklyExecutiveReport(
    to: string,
    tenantName: string,
    reportData: {
      periodSales: number;
      topShopName: string;
      totalItemsSold: number;
      salesChangePercent: number | null;
      itemsChangePercent: number | null;
    }
  ): Promise<boolean> {
    const subject = `📊 Ledgio Weekly Executive Performance - ${tenantName}`;
    const html = this.buildPeriodReportHtml('Week', tenantName, reportData);
    return this.sendMail(to, subject, html);
  }

  /**
   * Sends monthly executive Profit & Loss performance summary, comparing
   * the trailing 30 days against the preceding 30-day window.
   */
  public static async sendMonthlyExecutiveReport(
    to: string,
    tenantName: string,
    reportData: {
      periodSales: number;
      topShopName: string;
      totalItemsSold: number;
      salesChangePercent: number | null;
      itemsChangePercent: number | null;
    }
  ): Promise<boolean> {
    const subject = `📈 Ledgio Monthly Executive Performance - ${tenantName}`;
    const html = this.buildPeriodReportHtml('Month', tenantName, reportData);
    return this.sendMail(to, subject, html);
  }

  /**
   * Sends "Verify Your Email" message with unique verification token link.
   */
  public static async sendVerificationEmail(to: string, name: string, token: string): Promise<boolean> {
    const verifyUrl = `${process.env.APP_URL || 'http://localhost:5173'}/verify-account?token=${token}&email=${encodeURIComponent(to)}`;
    const subject = '🔐 Verify Your Email Address - Ledgio ERP';
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h2 style="color: #0f172a; border-bottom: 2px solid #3b82f6; padding-bottom: 10px;">
          Welcome to Ledgio, ${escapeHtml(name)}!
        </h2>
        <p style="font-size: 14px; color: #475569;">
          Please verify your email address to activate your account.
        </p>
        <div style="margin: 25px 0; text-align: center;">
          <a href="${verifyUrl}" style="background-color: #2563eb; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 14px; display: inline-block;">
            Verify Email Address
          </a>
        </div>
        <p style="font-size: 12px; color: #64748b;">
          Or copy and paste this link in your browser: <br/>
          <a href="${verifyUrl}" style="color: #2563eb;">${verifyUrl}</a>
        </p>
      </div>
    `;

    return this.sendMail(to, subject, html);
  }

  /**
   * Sends "Welcome to Ledgio" sequence with attached Quick Start Guide PDF payload.
   */
  public static async sendWelcomePackage(to: string, name: string, businessName?: string): Promise<boolean> {
    const subject = '🎉 Welcome to Ledgio - Quick Start Guide Included';
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h2 style="color: #0f172a; border-bottom: 2px solid #10b981; padding-bottom: 10px;">
          Your Account is Fully Verified & Active!
        </h2>
        <p style="font-size: 14px; color: #334155;">
          Congratulations <strong>${escapeHtml(name)}</strong>! Both your email and mobile phone numbers have been successfully verified.
        </p>
        <div style="background-color: #ecfdf5; padding: 15px; border-radius: 6px; border: 1px solid #a7f3d0; margin: 20px 0;">
          <h3 style="margin-top: 0; color: #065f46; font-size: 15px;">Next Steps:</h3>
          <ul style="font-size: 13px; color: #047857; line-height: 1.6;">
            <li>Setup your Chart of Accounts or use our default standard template.</li>
            <li>Add shop branches & cash tills for daily point-of-sale tracking.</li>
            <li>Invite your team members with custom role permissions.</li>
          </ul>
        </div>
        <p style="font-size: 13px; color: #475569;">
          We have attached the official <strong>Ledgio Quick Start Guide PDF</strong> to this email to help you get up to speed.
        </p>
      </div>
    `;

    const guidePdfBuffer = await generateQuickStartGuidePdf(businessName || name, name);

    const attachments: EmailAttachment[] = [
      {
        filename: 'Ledgio_Quick_Start_Guide.pdf',
        content: guidePdfBuffer,
        contentType: 'application/pdf',
      },
    ];

    return this.sendMail(to, subject, html, attachments);
  }
}
