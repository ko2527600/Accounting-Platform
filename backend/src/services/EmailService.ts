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

  /**
   * Sends "Verify Your Email" message with unique verification token link.
   */
  public static async sendVerificationEmail(to: string, name: string, token: string): Promise<boolean> {
    const verifyUrl = `${process.env.APP_URL || 'http://localhost:5173'}/verify-account?token=${token}&email=${encodeURIComponent(to)}`;
    const subject = '🔐 Verify Your Email Address - AccountGo ERP';
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h2 style="color: #0f172a; border-bottom: 2px solid #3b82f6; padding-bottom: 10px;">
          Welcome to AccountGo, ${name}!
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
   * Sends "Welcome to AccountGo" sequence with attached Quick Start Guide PDF payload.
   */
  public static async sendWelcomePackage(to: string, name: string): Promise<boolean> {
    const subject = '🎉 Welcome to AccountGo - Quick Start Guide Included';
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h2 style="color: #0f172a; border-bottom: 2px solid #10b981; padding-bottom: 10px;">
          Your Account is Fully Verified & Active!
        </h2>
        <p style="font-size: 14px; color: #334155;">
          Congratulations <strong>${name}</strong>! Both your email and mobile phone numbers have been successfully verified.
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
          We have attached the official <strong>AccountGo Quick Start Guide PDF</strong> to this email to help you get up to speed.
        </p>
      </div>
    `;

    // Attached PDF Guide Buffer
    const samplePdfBuffer = Buffer.from(
      `%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kinds [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >> endobj\n4 0 obj << /Length 55 >> stream\nBT /F1 12 Tf 100 700 TD (AccountGo ERP Quick Start Guide) Tj ET\nendstream\nendobj\nxref\n0 5\n0000000000 65535 f\n0000000009 00000 n\n0000000058 00000 n\n0000000115 00000 n\n0000000214 00000 n\ntrailer << /Size 5 /Root 1 0 R >>\nstartxref\n320\n%%EOF`
    );

    const attachments: EmailAttachment[] = [
      {
        filename: 'AccountGo_Quick_Start_Guide.pdf',
        content: samplePdfBuffer,
        contentType: 'application/pdf',
      },
    ];

    return this.sendMail(to, subject, html, attachments);
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
