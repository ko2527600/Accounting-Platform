import cron, { ScheduledTask } from 'node-cron';
import { prisma } from '../config/db';
import { withCurrentTenantDb } from '../database/tenantClient';
import { runWithTenantContext } from '../context/tenantContext';
import * as vendorBillPaymentService from './vendorBillPaymentService';

/**
 * Daily sweep across every tenant's unpaid vendor bills whose
 * scheduledPaymentDate has arrived, auto-executing the exact same
 * payment-posting logic the manual "Pay" button uses
 * (vendorBillPaymentService.payVendorBill - real Debit Expense / Credit
 * Cash journal entry). This app records that a payment happened, it
 * doesn't move real money through any bank/payment rail - same scope as
 * every other "mark paid" action here, just executed automatically on the
 * date a human already chose rather than requiring them to click Pay that
 * day. Matches DunningReminderCronService's shape (blanket, no per-tenant
 * opt-in - the opt-in is per-bill, via setting a scheduledPaymentDate at all).
 */
export class VendorPaymentSchedulingCronService {
  private static task: ScheduledTask | null = null;

  public static init(): void {
    if (this.task) return;

    // Once daily at 8am UTC - ahead of the 9am dunning-reminder sweep, so a
    // scheduled outgoing payment posts before that day's incoming-reminder
    // pass runs.
    this.task = cron.schedule('0 8 * * *', async () => {
      console.log('[VendorPaymentSchedulingCron] Executing daily scheduled-payments sweep...');
      await this.runScheduledPaymentsJob();
    });

    console.log('[VendorPaymentSchedulingCron] Daily Vendor Payment Scheduling Cron Job Initialized.');
  }

  public static async runScheduledPaymentsJob(): Promise<void> {
    try {
      const now = new Date();
      const tenants = await prisma.tenant.findMany();

      for (const tenant of tenants) {
        try {
          await runWithTenantContext(
            { tenantId: tenant.id, tenantSchema: tenant.schema, tenantName: tenant.name, tenantSlug: tenant.slug },
            async () => {
              const dueBills = await withCurrentTenantDb(prisma, async (client) => {
                return (client as any).vendorBill.findMany({
                  where: { tenantId: tenant.id, status: { not: 'PAID' }, scheduledPaymentDate: { lte: now } },
                });
              });

              for (const bill of dueBills) {
                try {
                  await vendorBillPaymentService.payVendorBill(tenant.id, bill.id);
                } catch (billErr: any) {
                  console.error(`[VendorPaymentSchedulingCron] Error paying bill ${bill.id}:`, billErr);
                }
              }
            }
          );
        } catch (tenantErr: any) {
          console.error(`[VendorPaymentSchedulingCron] Error running sweep for tenant ${tenant.id}:`, tenantErr);
        }
      }
    } catch (err: any) {
      console.error('[VendorPaymentSchedulingCron] Error running scheduled-payments job:', err);
    }
  }

  public static stop(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
    }
  }
}
