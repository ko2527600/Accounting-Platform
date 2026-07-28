import nodemailer from 'nodemailer';
import dns from 'dns';
import { generateQuickStartGuidePdf } from './pdfGenerationService';
import { recordAuditLog } from './auditLogService';
import { escapeHtml } from '../utils/htmlEscape';

// Force Node.js DNS to prefer IPv4 over IPv6 on cloud hosting environments (e.g. Render)
try {
  dns.setDefaultResultOrder('ipv4first');
} catch (e) {
  // Fallback for older Node versions if any
}

export interface EmailAttachment {
  filename: string;
  content: Buffer | string;
  contentType?: string;
}

export class EmailService {
  private static getTransporter() {
    const user = process.env.EMAIL_USER?.trim();
    const pass = process.env.EMAIL_PASS?.replace(/["'\s]/g, '');
    if (!user || !pass) {
      throw new Error('Email sending is not configured: EMAIL_USER and EMAIL_PASS environment variables are required.');
    }

    return nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: {
        user,
        pass,
      },
      family: 4, // Force IPv4 socket family to prevent ENETUNREACH IPv6 connection failure
    } as any);
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
    const from = (process.env.EMAIL_USER || '').trim();

    const mailOptions = {
      from: `"Ledgio ERP" <${from}>`,
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
      const transporter = this.getTransporter();
      const info = await transporter.sendMail(mailOptions);
      console.log(`[EmailService] ✅ Email dispatched successfully to ${to}. MessageId: ${info.messageId}`);

      // Log successful email dispatch in AuditLog
      await recordAuditLog({ action: 'EMAIL_SENT', entity: 'EMAIL_SERVICE', details: `Email sent to ${to} (${subject}).` });
      return true;
    } catch (firstErr: any) {
      console.error(`[EmailService] ❌ Email dispatch error to ${to}:`, firstErr);

      // Retry once after 5 minutes (300,000ms)
      setTimeout(async () => {
        try {
          await this.getTransporter().sendMail(mailOptions);
          await recordAuditLog({ action: 'EMAIL_SENT', entity: 'EMAIL_SERVICE', details: `Retry succeeded: Email sent to ${to}.` });
        } catch (retryErr: any) {
          console.error(`[EmailService] Critical Failure: Retry dispatch to ${to} failed:`, retryErr.message);
          await recordAuditLog({
            action: 'CRITICAL_FAILURE',
            entity: 'EMAIL_SERVICE',
            details: `Critical Failure: Automated email report to ${to} failed twice. Error: ${retryErr.message}`,
          });
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
    const subject = `📊 Ledgio Weekly Executive Performance - ${tenantName}`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; rounded-lg: 8px;">
        <h2 style="color: #0f172a; border-bottom: 2px solid #3b82f6; padding-bottom: 10px;">
          Weekly Executive Performance Summary
        </h2>
        <p style="font-size: 14px; color: #475569;">
          Here is your automated weekly business breakdown for <strong>${escapeHtml(tenantName)}</strong>.
        </p>

        <div style="background-color: #f8fafc; padding: 15px; border-radius: 6px; margin: 20px 0;">
          <h3 style="margin-top: 0; color: #1e293b; font-size: 16px;">Week at a Glance</h3>
          <ul style="font-size: 14px; color: #334155; line-height: 1.6;">
            <li><strong>Total Weekly Cash Sales:</strong> GH₵ ${reportData.weeklySales.toFixed(2)}</li>
            <li><strong>Top Performing Branch:</strong> ${escapeHtml(reportData.topShopName)}</li>
            <li><strong>Total Items Sold:</strong> ${reportData.totalItemsSold} pcs</li>
          </ul>
        </div>

        <p style="font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 15px;">
          Generated automatically by <strong>Ledgio Multi-Tenant ERP</strong>. All shop closeouts and ledger records are reconciled.
        </p>
      </div>
    `;

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
