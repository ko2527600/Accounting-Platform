import axios from 'axios';
import { prisma } from '../config/db';
import { withCurrentTenantDb } from '../database/tenantClient';

interface ShortageAlertDTO {
  shopName: string;
  staffName: string;
  shortageAmount: string;
  recipientPhone: string;
}

export class SmsService {
  private static get gatewayUrl() {
    return process.env.SMS_GATEWAY_URL || 'https://api.sms-gate.app/3rdparty/v1/message';
  }

  private static get username() {
    return process.env.SMS_GATEWAY_USER || 'U8LXKB';
  }

  private static get password() {
    return process.env.SMS_GATEWAY_PASS || 'db8lp7qnvc3qkv';
  }

  private static get deviceId() {
    return process.env.SMS_GATEWAY_DEVICE_ID || 'ke6CPUcczoxCIGS7fA6la';
  }

  private static get senderId() {
    return process.env.SMS_SENDER_ID || 'AccountGo';
  }

  /**
   * Sends an SMS via configured Bulk SMS Gateway (Arkesel / mNotify / Hubtel / Android Gateway).
   * Supports Alphanumeric Sender ID ("AccountGo") so receivers see "AccountGo" instead of a phone number.
   */
  public static async send(recipientPhone: string, message: string): Promise<boolean> {
    const formattedMessage = message.startsWith('AccountGo') ? message : `AccountGo ERP: ${message}`;
    const cleanPhone = recipientPhone.replace(/[\s\-\(\)]/g, '');

    // 1. Arkesel Bulk SMS Gateway (Supports Alphanumeric Sender ID "AccountGo")
    if (process.env.ARKESEL_API_KEY) {
      try {
        const response = await axios.post(
          'https://sms.arkesel.com/api/v2/sms/send',
          {
            sender: this.senderId,
            recipients: [cleanPhone],
            message: formattedMessage,
          },
          {
            headers: {
              'api-key': process.env.ARKESEL_API_KEY,
            },
          }
        );
        if (response.status >= 200 && response.status < 300) {
          console.log(`[SmsService] ✅ SMS sent with Sender ID "${this.senderId}" to ${cleanPhone} via Arkesel.`);
          return true;
        }
      } catch (err: any) {
        console.error('[SmsService] Arkesel SMS dispatch error:', err.response?.data || err.message);
      }
    }

    // 2. mNotify Bulk SMS Gateway (Supports Alphanumeric Sender ID "AccountGo")
    if (process.env.MNOTIFY_API_KEY) {
      try {
        const response = await axios.post(
          `https://api.mnotify.com/api/sms/quick?key=${process.env.MNOTIFY_API_KEY}`,
          {
            recipient: [cleanPhone],
            sender: this.senderId,
            message: formattedMessage,
            is_schedule: false,
          }
        );
        if (response.status >= 200 && response.status < 300) {
          console.log(`[SmsService] ✅ SMS sent with Sender ID "${this.senderId}" to ${cleanPhone} via mNotify.`);
          return true;
        }
      } catch (err: any) {
        console.error('[SmsService] mNotify SMS dispatch error:', err.response?.data || err.message);
      }
    }

    // 3. Android SMS Gateway (Default)
    const payload = {
      phoneNumbers: [cleanPhone],
      message: formattedMessage,
    };

    const maxRetries = 3;
    let attempt = 0;

    while (attempt < maxRetries) {
      attempt++;
      try {
        if (process.env.NODE_ENV === 'test' && !process.env.SMS_GATEWAY_TEST_LIVE) {
          // Mock mode in tests unless explicitly testing live gateway
          return true;
        }

        const endpoint = this.gatewayUrl;

        const response = await axios.post(endpoint, payload, {
          timeout: 10000,
          auth: {
            username: this.username,
            password: this.password,
          },
          headers: {
            'Content-Type': 'application/json',
          },
        });

        if (response.status >= 200 && response.status < 300) {
          console.log(`[SmsService] ✅ SMS dispatched successfully to ${recipientPhone} via sms-gate.app (ID: ${response.data?.id})`);
          return true;
        }
      } catch (err: any) {
        console.warn(`[SmsService] Gateway send attempt ${attempt}/${maxRetries} failed:`, err.response?.data || err.message);
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
        }
      }
    }

    // 3 Retries Failed -> Log "Gateway Offline" in AuditLog if context active
    console.error(`[SmsService] Android Gateway Offline after ${maxRetries} failed attempts.`);
    try {
      await withCurrentTenantDb(prisma, async (client) => {
        return (client as any).auditLog.create({
          data: {
            action: 'GATEWAY_OFFLINE',
            entity: 'SMS_GATEWAY',
            details: `Failed to dispatch SMS to ${recipientPhone} via Android Gateway after ${maxRetries} retries. Message: "${message}"`,
          },
        });
      });
    } catch (_auditErr) {
      // Ignore if outside tenant context
    }

    return false;
  }

  /**
   * Helper to format and dispatch instant Cash Shortage alerts to business owners.
   */
  public static async sendShortageAlert(dto: ShortageAlertDTO): Promise<boolean> {
    const message = `AccountGo Alert: ${dto.shopName} till closed by ${dto.staffName}. Shortage: ${dto.shortageAmount}. Please check the system.`;
    return this.send(dto.recipientPhone, message);
  }
}
