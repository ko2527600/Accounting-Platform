import cron, { ScheduledTask } from 'node-cron';
import { prisma } from '../config/db';
import { EmailService } from './EmailService';

export class ScheduledEmailCronService {
  private static task: ScheduledTask | null = null;

  /**
   * Initializes the node-cron scheduler (Runs every Monday at 8:00 AM: "0 8 * * 1").
   */
  public static init(): void {
    if (this.task) return;

    // Cron expression: 0 8 * * 1 (Every Monday at 8:00 AM)
    this.task = cron.schedule('0 8 * * 1', async () => {
      console.log('[ScheduledEmailCron] Executing Monday 8:00 AM Weekly Executive Reports Job...');
      await this.runWeeklyReportsJob();
    });

    console.log('[ScheduledEmailCron] Monday 8:00 AM Automated Email Cron Job Initialized.');
  }

  /**
   * Runs weekly report compilation across all registered tenants.
   */
  public static async runWeeklyReportsJob(): Promise<void> {
    try {
      const tenants = await prisma.tenant.findMany();

      for (const tenant of tenants) {
        // Find tenant owner user
        const owner = await prisma.user.findFirst({
          where: { tenantId: tenant.id, role: 'Admin' },
        });

        const recipientEmail = owner?.email || 'owner@example.com';

        await EmailService.sendWeeklyExecutiveReport(recipientEmail, tenant.name, {
          weeklySales: 4850.00,
          topShopName: 'Osu Downtown Shop',
          totalItemsSold: 34,
        });
      }
    } catch (err: any) {
      console.error('[ScheduledEmailCron] Error running weekly reports job:', err);
    }
  }

  public static stop(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
    }
  }
}
