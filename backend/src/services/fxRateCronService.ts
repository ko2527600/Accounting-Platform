import cron, { ScheduledTask } from 'node-cron';
import { prisma } from '../config/db';
import * as fxRateService from './fxRateService';

/**
 * Periodically refreshes the FX rate cache for every base currency actually
 * in use by a tenant, so live requests (invoice/bill creation and payment)
 * almost never block on a real HTTP call to the rate provider.
 */
export class FxRateCronService {
  private static task: ScheduledTask | null = null;

  public static init(): void {
    if (this.task) return;
    if (!fxRateService.isFxConfigured()) {
      console.log('[FxRateCron] FX_RATE_API_KEY not configured - skipping FX rate refresh cron.');
      return;
    }

    // Every 6 hours, aligned with the cache TTL.
    this.task = cron.schedule('0 */6 * * *', async () => {
      console.log('[FxRateCron] Refreshing cached FX rates...');
      await this.refreshRatesJob();
    });

    console.log('[FxRateCron] FX Rate Refresh Cron Job Initialized.');
  }

  public static async refreshRatesJob(): Promise<void> {
    try {
      const baseCurrencies = await prisma.tenant.findMany({
        select: { baseCurrency: true },
        distinct: ['baseCurrency'],
      });

      for (const { baseCurrency } of baseCurrencies) {
        try {
          await fxRateService.getLatestRates(baseCurrency);
        } catch (err: any) {
          console.error(`[FxRateCron] Failed to refresh rates for ${baseCurrency}:`, err.message);
        }
      }
    } catch (err: any) {
      console.error('[FxRateCron] Error running FX rate refresh job:', err);
    }
  }

  public static stop(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
    }
  }
}
