import cron, { ScheduledTask } from 'node-cron';
import { prisma } from '../config/db';
import { withCurrentTenantDb } from '../database/tenantClient';
import { runWithTenantContext } from '../context/tenantContext';
import { EmailService } from './EmailService';
import { recordAuditLogTx } from './auditLogService';
import { recordChange, notifyChange, invoiceToSyncPayload } from './syncChangeLogService';

function formatDateLabel(date: Date): string {
  return date.toISOString().split('T')[0];
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
}

/**
 * Daily sweep across every tenant's overdue, unpaid invoices, emailing the
 * customer a payment reminder. No per-tenant configurability (unlike
 * ScheduledEmailCronService's ReportSchedule) - this is a blanket
 * "always run for whatever's currently overdue" job, matching
 * RecurringTransactionCronService/FxRateCronService's shape, since there's no
 * requested UI to opt in/out per tenant yet.
 */
export class DunningReminderCronService {
  private static task: ScheduledTask | null = null;

  public static init(): void {
    if (this.task) return;

    // Once daily at 9am UTC - a reminder email landing in a business's inbox
    // first thing in the morning is more useful than one sent overnight.
    this.task = cron.schedule('0 9 * * *', async () => {
      console.log('[DunningReminderCron] Executing daily overdue-invoices sweep...');
      await this.runOverdueInvoicesJob();
    });

    console.log('[DunningReminderCron] Daily Dunning Reminder Cron Job Initialized.');
  }

  /**
   * Runs with no active HTTP/tenant request context, so tenant context must
   * be established manually per tenant via runWithTenantContext before
   * using withCurrentTenantDb (which requires it internally).
   */
  public static async runOverdueInvoicesJob(): Promise<void> {
    if (!EmailService.isConfigured()) {
      console.log('[DunningReminderCron] Email sending is not configured - skipping overdue-invoices sweep.');
      return;
    }

    try {
      const now = new Date();
      // Dedup guard: don't re-remind an invoice that already got one within
      // the last 24 hours, mirroring ScheduledEmailCronService's
      // lastSentAt+cutoff shape.
      const guardCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const tenants = await prisma.tenant.findMany();

      for (const tenant of tenants) {
        try {
          await runWithTenantContext(
            { tenantId: tenant.id, tenantSchema: tenant.schema, tenantName: tenant.name, tenantSlug: tenant.slug },
            async () => {
              const overdueInvoices = await withCurrentTenantDb(prisma, async (client) => {
                return (client as any).invoice.findMany({
                  where: {
                    tenantId: tenant.id,
                    status: { notIn: ['PAID', 'DRAFT'] },
                    dueDate: { lt: now },
                    OR: [{ lastReminderSentAt: null }, { lastReminderSentAt: { lt: guardCutoff } }],
                  },
                  include: { customer: true },
                });
              });

              for (const invoice of overdueInvoices) {
                try {
                  const daysOverdue = daysBetween(invoice.dueDate, now);

                  // The remaining balance, not the original total - a
                  // partially-paid invoice must not remind the customer for
                  // more than they actually still owe.
                  const balanceDue = Math.round((Number(invoice.total) - Number(invoice.amountPaid)) * 100) / 100;

                  const sent = await EmailService.sendPaymentReminderEmail(
                    invoice.customer.email,
                    invoice.customer.name,
                    tenant.name,
                    {
                      invoiceNumber: invoice.invoiceNumber,
                      dueDateLabel: formatDateLabel(invoice.dueDate),
                      currency: invoice.currency,
                      total: balanceDue,
                      daysOverdue,
                    }
                  );

                  if (!sent) {
                    console.error(`[DunningReminderCron] Failed to send reminder for invoice ${invoice.id}.`);
                    continue;
                  }

                  let syncSeq: bigint | null = null;
                  const updated = await withCurrentTenantDb(prisma, async (client) => {
                    const invoiceUpdated = await (client as any).invoice.update({
                      where: { id: invoice.id },
                      data: { lastReminderSentAt: now },
                      include: { customer: true },
                    });

                    syncSeq = await recordChange(client, {
                      tenantId: tenant.id,
                      entityType: 'Invoice',
                      entityId: invoiceUpdated.id,
                      operation: 'UPDATE',
                      payload: invoiceToSyncPayload(invoiceUpdated),
                    });

                    await recordAuditLogTx(client, {
                      action: 'INVOICE.PAYMENT_REMINDER_SENT',
                      entity: 'Invoice',
                      entityId: invoiceUpdated.id,
                      details: `Payment reminder emailed to ${invoice.customer.email} (${daysOverdue} day${daysOverdue === 1 ? '' : 's'} overdue).`,
                    });

                    return invoiceUpdated;
                  });

                  if (syncSeq !== null) {
                    notifyChange({
                      tenantId: tenant.id,
                      entityType: 'Invoice',
                      entityId: updated.id,
                      operation: 'UPDATE',
                      payload: invoiceToSyncPayload(updated),
                      sequence: syncSeq,
                    });
                  }
                } catch (invoiceErr: any) {
                  console.error(`[DunningReminderCron] Error sending reminder for invoice ${invoice.id}:`, invoiceErr);
                }
              }
            }
          );
        } catch (tenantErr: any) {
          console.error(`[DunningReminderCron] Error running sweep for tenant ${tenant.id}:`, tenantErr);
        }
      }
    } catch (err: any) {
      console.error('[DunningReminderCron] Error running overdue-invoices job:', err);
    }
  }

  public static stop(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
    }
  }
}
