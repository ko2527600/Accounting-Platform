import crypto from 'node:crypto';
import { prisma } from '../config/db';
import { EmailService } from './EmailService';
import { SmsService } from './smsService';
import { recordAuditLog } from './auditLogService';
import { escapeHtml } from '../utils/htmlEscape';

export interface BroadcastRequestDTO {
  subject: string;
  message: string;
  channel: 'EMAIL' | 'SMS' | 'BOTH';
  targetTier?: number;
  passcode: string;
}

export interface BroadcastResult {
  success: boolean;
  totalTargeted: number;
  emailSentCount: number;
  smsSentCount: number;
  failedCount: number;
}

export class BroadcastService {
  private static get masterPasscode(): string {
    const secret = process.env.BROADCAST_MASTER_SECRET;
    if (!secret) {
      throw new Error(
        'BROADCAST_MASTER_SECRET environment variable is not set. Refusing to fall back to a default passcode.'
      );
    }
    return secret;
  }

  public static verifyPasscode(passcode: string): boolean {
    const provided = Buffer.from(passcode || '', 'utf8');
    const expected = Buffer.from(this.masterPasscode, 'utf8');
    if (provided.length !== expected.length) {
      return false;
    }
    return crypto.timingSafeEqual(provided, expected);
  }

  public static async executeBroadcast(dto: BroadcastRequestDTO): Promise<BroadcastResult> {
    if (!this.verifyPasscode(dto.passcode)) {
      throw new Error('Unauthorized: Invalid master broadcast passcode.');
    }

    // 1. Fetch targeted business users
    const users = await prisma.user.findMany({
      where: {
        role: 'Admin',
      },
      include: {
        tenant: true,
      },
    });

    // Filter by tier if specified
    const filteredUsers = dto.targetTier
      ? users.filter((u) => u.tenant && u.tenant.tier === dto.targetTier)
      : users;

    const totalTargeted = filteredUsers.length;
    let emailSentCount = 0;
    let smsSentCount = 0;
    let failedCount = 0;

    // 2. Chunk recipients in batches of 15 for safety
    const chunkSize = 15;
    for (let i = 0; i < filteredUsers.length; i += chunkSize) {
      const chunk = filteredUsers.slice(i, i + chunkSize);

      for (const user of chunk) {
        // Send Email
        if (dto.channel === 'EMAIL' || dto.channel === 'BOTH') {
          // Deliberately plain, low-hype copy - an emoji-laden "Notice"
          // subject and "official administrative broadcast... System
          // Administrators" footer both read as promotional/phishing-style
          // patterns to Gmail's spam filters (confirmed live: an earlier
          // version of this template landed in spam sent from a personal
          // Gmail SMTP account, see STATUS.md). Kept close to how a normal
          // one-to-one business email reads instead.
          const emailSubject = `Ledgio: ${dto.subject}`;
          const emailHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
              <p style="font-size: 14px; color: #334155; line-height: 1.6;">
                Hi ${escapeHtml(user.name)},
              </p>
              <p style="font-size: 14px; color: #334155; line-height: 1.6; white-space: pre-line;">
                ${escapeHtml(dto.message)}
              </p>
              <p style="font-size: 13px; color: #475569; line-height: 1.6;">
                - The Ledgio Team
              </p>
              <p style="font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 15px; margin-top: 20px;">
                You're receiving this because you're an admin on the ${escapeHtml(user.tenant?.name || 'Ledgio')} workspace.
              </p>
            </div>
          `;

          const emailOk = await EmailService.sendMail(user.email, emailSubject, emailHtml);
          if (emailOk) emailSentCount++;
          else failedCount++;
        }

        // Send SMS
        if (dto.channel === 'SMS' || dto.channel === 'BOTH') {
          const recipientPhone = user.phone || process.env.OWNER_PHONE_NUMBER || '+233200000000';
          const smsText = `Ledgio Alert: ${dto.subject} - ${dto.message}`;

          const smsOk = await SmsService.send(recipientPhone, smsText);
          if (smsOk) smsSentCount++;
          else failedCount++;
        }
      }

      // 500ms delay between chunks to avoid rate limiting
      if (i + chunkSize < filteredUsers.length) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    // 3. Log System Broadcast in AuditLog.
    await recordAuditLog({
      action: 'SYSTEM_BROADCAST',
      entity: 'ADMIN_CONSOLE',
      details: `Admin broadcast dispatched (${dto.channel}). Subject: "${dto.subject}". Targeted: ${totalTargeted}, Emails Sent: ${emailSentCount}, SMS Sent: ${smsSentCount}, Failures: ${failedCount}`,
    });

    return {
      success: true,
      totalTargeted,
      emailSentCount,
      smsSentCount,
      failedCount,
    };
  }
}
