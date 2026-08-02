import cron, { ScheduledTask } from 'node-cron';
import { prisma } from '../config/db';
import { EmailService } from './EmailService';

export interface PeriodReportData {
  periodSales: number;
  topShopName: string;
  totalItemsSold: number;
  salesChangePercent: number | null;
  itemsChangePercent: number | null;
}

// Kept as an alias so existing imports (routes, tests) referencing the old
// weekly-only shape keep working - the fields are identical.
export type WeeklyReportData = PeriodReportData;

interface CloseoutAggregate {
  totalSales: number;
  totalItems: number;
  salesByShop: Map<string, number>;
}

async function aggregateCloseouts(tenantId: string, from: Date, to: Date): Promise<CloseoutAggregate> {
  const closeouts = await (prisma as any).dailyCloseoutReport.findMany({
    where: { tenantId, closedAt: { gte: from, lt: to } },
    include: { warehouse: true },
  });

  const totalSales = closeouts.reduce((sum: number, c: any) => sum + Number(c.cashSales), 0);
  const totalItems = closeouts.reduce((sum: number, c: any) => sum + (c.itemsSold || 0), 0);

  const salesByShop = new Map<string, number>();
  for (const c of closeouts) {
    const name = c.warehouse?.name || 'Unknown Shop';
    salesByShop.set(name, (salesByShop.get(name) || 0) + Number(c.cashSales));
  }

  return { totalSales, totalItems, salesByShop };
}

function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

/**
 * Computes report figures for an arbitrary [periodStart, now) window plus
 * the vs-previous-period deltas (previous window of the same length,
 * immediately preceding periodStart) - mirrors the "vs prev month" style
 * comparison used in third-party uptime/monitoring report emails.
 */
async function computePeriodReportData(tenantId: string, periodStart: Date, now: Date): Promise<PeriodReportData> {
  const periodLengthMs = now.getTime() - periodStart.getTime();
  const previousPeriodStart = new Date(periodStart.getTime() - periodLengthMs);

  const [current, previous] = await Promise.all([
    aggregateCloseouts(tenantId, periodStart, now),
    aggregateCloseouts(tenantId, previousPeriodStart, periodStart),
  ]);

  const topShopName = [...current.salesByShop.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
    || 'No sales recorded this period';

  return {
    periodSales: current.totalSales,
    topShopName,
    totalItemsSold: current.totalItems,
    salesChangePercent: percentChange(current.totalSales, previous.totalSales),
    itemsChangePercent: percentChange(current.totalItems, previous.totalItems),
  };
}

/**
 * Computes real weekly executive report figures from the tenant's own
 * DailyCloseoutReport rows over the last 7 days, plus the delta vs the
 * preceding 7-day window. Called directly with `prisma` (no
 * withCurrentTenantDb) since DailyCloseoutReport is a tenantId-column
 * shared table, not a per-tenant-schema one - it needs only a
 * `where: { tenantId }` filter, not a search_path switch. This matters
 * here because the cron dispatcher (runDueSchedulesJob) has no active
 * tenant context to switch to in the first place.
 */
export async function computeWeeklyReportData(tenantId: string): Promise<PeriodReportData> {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  return computePeriodReportData(tenantId, sevenDaysAgo, now);
}

/**
 * Same as computeWeeklyReportData but over the trailing 30 days, compared
 * against the preceding 30-day window. Uses a fixed 30-day window rather
 * than calendar-month boundaries so the comparison window is always equal
 * length regardless of which day of the month the report fires on.
 */
export async function computeMonthlyReportData(tenantId: string): Promise<PeriodReportData> {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  return computePeriodReportData(tenantId, thirtyDaysAgo, now);
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
   * Checks every enabled ReportSchedule and sends the appropriate report
   * (weekly or monthly) to any tenant whose schedule is due this hour.
   *
   * Weekly schedules match on dayOfWeek/hourUtc with a 6-day dedup guard.
   * Monthly schedules match on dayOfMonth/hourUtc with a 27-day dedup
   * guard (shortest possible gap between two calendar-month firings on
   * the same dayOfMonth, e.g. Jan 31 -> Feb 28 is longer but the guard
   * only needs to rule out re-firing within the same month).
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
        const isMonthly = schedule.frequency === 'Monthly';

        const isDueNow = isMonthly
          ? schedule.dayOfMonth === now.getUTCDate() && schedule.hourUtc === now.getUTCHours()
          : schedule.dayOfWeek === now.getUTCDay() && schedule.hourUtc === now.getUTCHours();
        if (!isDueNow) continue;

        const guardDays = isMonthly ? 27 : 6;
        const guardCutoff = new Date(now.getTime() - guardDays * 24 * 60 * 60 * 1000);
        if (schedule.lastSentAt && schedule.lastSentAt > guardCutoff) continue;

        try {
          const tenant = await prisma.tenant.findUnique({ where: { id: schedule.tenantId } });
          if (!tenant) continue;

          const reportData = isMonthly
            ? await computeMonthlyReportData(schedule.tenantId)
            : await computeWeeklyReportData(schedule.tenantId);

          for (const recipient of schedule.recipients as string[]) {
            if (isMonthly) {
              await EmailService.sendMonthlyExecutiveReport(recipient, tenant.name, reportData);
            } else {
              await EmailService.sendWeeklyExecutiveReport(recipient, tenant.name, reportData);
            }
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
