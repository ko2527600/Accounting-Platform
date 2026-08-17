import cron, { ScheduledTask } from 'node-cron';
import { prisma } from '../config/db';
import { runWithTenantContext } from '../context/tenantContext';
import * as fixedAssetService from './fixedAssetService';

/**
 * Daily sweep posting one period's depreciation for every ACTIVE fixed
 * asset that's due for it - mirrors RecurringInvoiceCronService's shape,
 * with its own per-asset try/catch (like RecurringInvoiceCronService's
 * per-recurring-invoice loop) so one misconfigured asset never blocks the
 * rest of a tenant's sweep. depreciateOneAsset is idempotent per asset per
 * calendar month (guarded by lastDepreciatedThrough and
 * DepreciationEntry's unique [fixedAssetId, period] index), so running
 * daily rather than monthly is safe and catches a tenant whose schema
 * wasn't touched on the 1st.
 */
export class FixedAssetDepreciationCronService {
  private static task: ScheduledTask | null = null;

  public static init(): void {
    if (this.task) return;

    this.task = cron.schedule('0 8 * * *', async () => {
      console.log('[FixedAssetDepreciationCron] Executing daily depreciation sweep...');
      await this.runDepreciationJob();
    });

    console.log('[FixedAssetDepreciationCron] Daily Fixed Asset Depreciation Cron Job Initialized.');
  }

  public static async runDepreciationJob(): Promise<void> {
    try {
      const tenants = await prisma.tenant.findMany();

      for (const tenant of tenants) {
        try {
          await runWithTenantContext(
            { tenantId: tenant.id, tenantSchema: tenant.schema, tenantName: tenant.name, tenantSlug: tenant.slug },
            async () => {
              const due = await fixedAssetService.listAssetsDueForDepreciation(tenant.id);
              for (const asset of due) {
                try {
                  await fixedAssetService.depreciateOneAsset(tenant.id, asset.id);
                } catch (err: any) {
                  console.error(`[FixedAssetDepreciationCron] Error depreciating asset ${asset.id}:`, err);
                }
              }
            }
          );
        } catch (tenantErr: any) {
          console.error(`[FixedAssetDepreciationCron] Error running sweep for tenant ${tenant.id}:`, tenantErr);
        }
      }
    } catch (err: any) {
      console.error('[FixedAssetDepreciationCron] Error running depreciation job:', err);
    }
  }

  public static stop(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
    }
  }
}
