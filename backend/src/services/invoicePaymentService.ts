import { prisma } from '../config/db';
import { withCurrentTenantDb } from '../database/tenantClient';
import { requireTenantContext } from '../context/tenantContext';
import * as journalService from './journalEntryService';
import * as accountRepository from '../repository/accountRepository';
import * as approvalWorkflowService from './approvalWorkflowService';
import { recordAuditLog, diffFields, AuditActor } from './auditLogService';

export class InvoicePaymentServiceError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number = 400) {
    super(message);
    this.name = 'InvoicePaymentServiceError';
    this.statusCode = statusCode;
  }
}

/**
 * Marks an invoice PAID and posts the real Cash/Revenue journal entry -
 * shared by the manual "/pay" route and the MTN MoMo payment-confirmation
 * path (once a requesttopay comes back SUCCESSFUL), so both post through
 * the exact same accounting logic instead of duplicating it. Requires
 * tenant context to already be established: either by tenantContextMiddleware
 * on an authenticated request, or manually via runWithTenantContext for a
 * background caller (mirrors recurringTransactionService's cron job).
 */
export async function markInvoicePaid(
  invoiceId: string,
  actor: AuditActor,
  paymentDescription?: string
) {
  const { tenantId } = requireTenantContext();

  const invoice = await withCurrentTenantDb(prisma, async (client) => {
    return (client as any).invoice.findFirst({
      where: { id: invoiceId, tenantId },
      include: { customer: true },
    });
  });

  if (!invoice) {
    throw new InvoicePaymentServiceError('Invoice not found.', 404);
  }
  if (invoice.status === 'PAID') {
    throw new InvoicePaymentServiceError('Invoice is already paid.', 400);
  }

  await approvalWorkflowService.assertApprovedOrNoWorkflow(tenantId, 'Invoice', invoiceId);

  const accounts = await withCurrentTenantDb(prisma, (client) => accountRepository.listAccounts(client));
  const cashAcc = accounts.find((a: any) => a.code === '1010') || accounts[0];
  const revenueAcc = accounts.find((a: any) => a.code === '4010') || accounts[1] || accounts[0];

  const postingAmount = invoice.baseCurrencyAmount != null ? Number(invoice.baseCurrencyAmount) : Number(invoice.total);

  let journalId = null;
  if (cashAcc && revenueAcc) {
    const journal = await journalService.createJournalEntry(
      {
        description: paymentDescription || `Payment Received for Invoice ${invoice.invoiceNumber} (${invoice.customer.name})`,
        entryDate: new Date().toISOString().split('T')[0],
        status: 'POSTED',
        lines: [
          { accountId: cashAcc.id, debit: postingAmount, credit: 0, description: `Cash Received - ${invoice.invoiceNumber}` },
          { accountId: revenueAcc.id, debit: 0, credit: postingAmount, description: `Revenue - ${invoice.invoiceNumber}` },
        ],
      },
      actor
    );
    journalId = journal.id;
  }

  const updated = await withCurrentTenantDb(prisma, async (client) => {
    return (client as any).invoice.update({
      where: { id: invoiceId },
      data: { status: 'PAID', journalId },
    });
  });

  await recordAuditLog({
    action: 'INVOICE.PAID',
    entity: 'Invoice',
    entityId: invoiceId,
    actor,
    changes: diffFields(invoice, updated, ['status', 'journalId']),
    details: `Invoice ${invoice.invoiceNumber} marked PAID (${postingAmount}).`,
  });

  return updated;
}
