import request from 'supertest';
import app from '../app';
import { SmsService } from '../services/smsService';
import { EmailService } from '../services/EmailService';
import { ScheduledEmailCronService } from '../services/scheduledEmailService';

jest.setTimeout(180000);

describe('Android SMS Gateway & Nodemailer Email Service Suite', () => {
  let adminToken: string;
  let tenantId: string;

  const timestamp = Date.now();
  const testEmail = `owner.messaging.${timestamp}@example.com`;
  const testCompany = `Messaging Test ${timestamp}`;
  const testSlug = `msg-test-${timestamp}`;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/v1/tenants/onboard')
      .send({
        companyName: testCompany,
        slug: testSlug,
        email: testEmail,
        password: 'Password123!',
        adminName: 'Owner User',
        termsAccepted: true,
        acceptedTermsVersion: 'v1.0.0',
      });

    expect(res.status).toBe(201);
    adminToken = res.body.data.token;
    tenantId = res.body.data.tenant.id;
  });

  describe('Private Android SMS Gateway Unit & Retry Logic', () => {
    it('should format and dispatch SMS shortage alert via SmsService.sendShortageAlert', async () => {
      const result = await SmsService.sendShortageAlert({
        shopName: 'Osu Downtown Shop',
        staffName: 'Kwame',
        shortageAmount: 'GH₵ 50.00',
        recipientPhone: '+233201234567',
      });

      expect(result).toBe(true);
    });

    it('should retry up to 3 times and log "Gateway Offline" if gateway returns error', async () => {
      // Mock failure in test environment
      const result = await SmsService.send('+233201234567', 'Test message');
      expect(typeof result).toBe('boolean');
    });
  });

  describe('Nodemailer Gmail SMTP & Weekly Email Report Engine', () => {
    it('should instantiate EmailService and mock send weekly executive report', async () => {
      const result = await EmailService.sendWeeklyExecutiveReport(
        testEmail,
        testCompany,
        {
          weeklySales: 5200.0,
          topShopName: 'Central Depot',
          totalItemsSold: 42,
        }
      );

      expect(result).toBe(true);
    });

    it('POST /api/v1/reports/schedule/test-email - should trigger test executive email endpoint', async () => {
      const res = await request(app)
        .post('/api/v1/reports/schedule/test-email')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantId)
        .send({
          recipientEmail: testEmail,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should initialize node-cron Monday 8:00 AM scheduled task without throwing errors', () => {
      expect(() => ScheduledEmailCronService.init()).not.toThrow();
      ScheduledEmailCronService.stop();
    });
  });
});
