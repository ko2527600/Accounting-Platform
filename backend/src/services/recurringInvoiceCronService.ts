import cron, { ScheduledTask } from 'node-cron';
import { prisma } from '../config/db';
import { withCurrentTenantDb } from '../database/tenantClient';
import { runWithTenantContext } from '../context/tenantContext';
import * as recurringInvoiceService from './recurringInvoiceService';

/**
 * Daily sweep generating a real Invoice from every active, due
 * RecurringInvoice (nextRun <= today, not past its optional endDate) -
 * mirrors RecurringTransactionCronService's shape exactly, generating an
 * Invoice instead of a generic JournalEntry.
 */
export class RecurringInvoiceCronService {
  private static task: ScheduledTask | null = null;

  public static init(): void {
    if (this.task) return;

    this.task = cron.schedule('0 6 * * *', async () => {
      console.log('[RecurringInvoiceCron] Executing daily recurring-invoice generation sweep...');
      await this.runDueRecurringInvoicesJob();
    });

    console.log('[RecurringInvoiceCron] Daily Recurring Invoice Cron Job Initialized.');
  }

  public static async runDueRecurringInvoicesJob(): Promise<void> {
    try {
      const now = new Date();
      const tenants = await prisma.tenant.findMany();

      for (const tenant of tenants) {
        try {
          await runWithTenantContext(
            { tenantId: tenant.id, tenantSchema: tenant.schema, tenantName: tenant.name, tenantSlug: tenant.slug },
            async () => {
              const due = await withCurrentTenantDb(prisma, async (client) => {
                return (client as any).recurringInvoice.findMany({
                  where: {
                    tenantId: tenant.id,
                    isActive: true,
                    nextRun: { lte: now },
                    OR: [{ endDate: null }, { endDate: { gte: now } }],
                  },
                });
              });

              for (const recurring of due) {
                try {
                  await recurringInvoiceService.generateInvoiceFromRecurring(tenant.id, recurring.id);
                } catch (err: any) {
                  console.error(`[RecurringInvoiceCron] Error generating invoice for recurring ${recurring.id}:`, err);
                }
              }
            }
          );
        } catch (tenantErr: any) {
          console.error(`[RecurringInvoiceCron] Error running sweep for tenant ${tenant.id}:`, tenantErr);
        }
      }
    } catch (err: any) {
      console.error('[RecurringInvoiceCron] Error running due-recurring-invoices job:', err);
    }
  }

  public static stop(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
    }
  }
}
