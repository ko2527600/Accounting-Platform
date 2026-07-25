import cron, { ScheduledTask } from 'node-cron';
import { prisma } from '../config/db';
import { EmailService } from './EmailService';

export interface WeeklyReportData {
  weeklySales: number;
  topShopName: string;
  totalItemsSold: number;
}

/**
 * Computes real weekly executive report figures from the tenant's own
 * DailyCloseoutReport rows over the last 7 days. Called directly with
 * `prisma` (no withCurrentTenantDb) since DailyCloseoutReport is a
 * tenantId-column shared table, not a per-tenant-schema one - it needs
 * only a `where: { tenantId }` filter, not a search_path switch. This
 * matters here because the cron dispatcher (runDueSchedulesJob) has no
 * active tenant context to switch to in the first place.
 */
export async function computeWeeklyReportData(tenantId: string): Promise<WeeklyReportData> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const closeouts = await (prisma as any).dailyCloseoutReport.findMany({
    where: { tenantId, closedAt: { gte: sevenDaysAgo } },
    include: { warehouse: true },
  });

  const weeklySales = closeouts.reduce((sum: number, c: any) => sum + Number(c.cashSales), 0);
  const totalItemsSold = closeouts.reduce((sum: number, c: any) => sum + (c.itemsSold || 0), 0);

  const salesByShop = new Map<string, number>();
  for (const c of closeouts) {
    const name = c.warehouse?.name || 'Unknown Shop';
    salesByShop.set(name, (salesByShop.get(name) || 0) + Number(c.cashSales));
  }
  const topShopName = [...salesByShop.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'No sales recorded this week';

  return { weeklySales, topShopName, totalItemsSold };
}

export class ScheduledEmailCronService {
  private static task: ScheduledTask | null = null;

  /**
   * Initializes the node-cron scheduler: an hourly sweep ("0 * * * *") that
   * checks every tenant's persisted ReportSchedule for whether it's due
   * this hour, rather than a single fixed Monday-8am job for every tenant.
   */
  public static init(): void {
    if (this.task) return;

    this.task = cron.schedule('0 * * * *', async () => {
      console.log('[ScheduledEmailCron] Executing hourly due-schedules sweep...');
      await this.runDueSchedulesJob();
    });

    console.log('[ScheduledEmailCron] Hourly Scheduled Reports Cron Job Initialized.');
  }

  /**
   * Checks every enabled ReportSchedule and sends the weekly executive
   * report to any tenant whose dayOfWeek/hourUtc matches the current UTC
   * time and hasn't already been sent in the last 6 days (guards against
   * double-sends if the process restarts mid-hour).
   *
   * Runs with no active HTTP request/tenant context, so every Prisma call
   * here must filter explicitly by tenantId rather than going through
   * withCurrentTenantDb/requireTenantContext, which throw without one.
   */
  public static async runDueSchedulesJob(): Promise<void> {
    try {
      const now = new Date();
      const dueSchedules = await (prisma as any).reportSchedule.findMany({ where: { enabled: true } });

      for (const schedule of dueSchedules) {
        const isDueNow = schedule.dayOfWeek === now.getUTCDay() && schedule.hourUtc === now.getUTCHours();
        if (!isDueNow) continue;

        const sixDaysAgo = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
        if (schedule.lastSentAt && schedule.lastSentAt > sixDaysAgo) continue;

        try {
          const tenant = await prisma.tenant.findUnique({ where: { id: schedule.tenantId } });
          if (!tenant) continue;

          const reportData = await computeWeeklyReportData(schedule.tenantId);

          for (const recipient of schedule.recipients as string[]) {
            await EmailService.sendWeeklyExecutiveReport(recipient, tenant.name, reportData);
          }

          await (prisma as any).reportSchedule.update({
            where: { id: schedule.id },
            data: { lastSentAt: now },
          });
        } catch (tenantErr: any) {
          console.error(`[ScheduledEmailCron] Error dispatching for tenant ${schedule.tenantId}:`, tenantErr);
        }
      }
    } catch (err: any) {
      console.error('[ScheduledEmailCron] Error running due-schedules job:', err);
    }
  }

  public static stop(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
    }
  }
}
