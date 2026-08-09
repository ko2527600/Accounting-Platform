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
      include: { customer: true, taxRate: true },
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
  const accountsById = new Map(accounts.map((a: any) => [a.id, a]));

  const postingAmount = invoice.baseCurrencyAmount != null ? Number(invoice.baseCurrencyAmount) : Number(invoice.total);
  const invoiceTotal = Number(invoice.total);
  // Scales each native-currency tax amount into the tenant's base currency,
  // same as postingAmount itself already is - degrades to exactly 1 for
  // same-currency tenants (invoice.total === postingAmount).
  const fxScale = invoiceTotal !== 0 ? postingAmount / invoiceTotal : 1;

  // Determine each levy's destination GL account and its base-currency
  // amount, merging levies that share a destination. A destination account
  // that no longer exists (deleted after the invoice was created/taxRate
  // was edited) is silently dropped here - its amount folds into Revenue
  // below rather than hard-blocking payment of an otherwise-unrelated invoice.
  const taxDestinationTotals = new Map<string, number>();
  const breakdown: { name: string; rate: number; amount: number; accountId?: string }[] | null =
    Array.isArray(invoice.taxBreakdown) ? invoice.taxBreakdown : null;

  if (breakdown && breakdown.length > 0) {
    for (const line of breakdown) {
      if (!line.accountId || !accountsById.has(line.accountId)) continue;
      const scaledAmount = Math.round(Number(line.amount) * fxScale * 100) / 100;
      taxDestinationTotals.set(line.accountId, (taxDestinationTotals.get(line.accountId) || 0) + scaledAmount);
    }
  } else if (Number(invoice.tax) > 0 && invoice.taxRate?.accountId && accountsById.has(invoice.taxRate.accountId)) {
    const scaledAmount = Math.round(Number(invoice.tax) * fxScale * 100) / 100;
    taxDestinationTotals.set(invoice.taxRate.accountId, scaledAmount);
  }

  let taxDestinationSum = 0;
  const taxLines = Array.from(taxDestinationTotals.entries())
    .filter(([, amount]) => amount > 0.001)
    .map(([accountId, amount]) => {
      taxDestinationSum += amount;
      const account = accountsById.get(accountId) as any;
      return {
        accountId,
        debit: 0,
        credit: amount,
        description: `${account?.name || 'Tax'} - ${invoice.invoiceNumber}`,
      };
    });

  const revenueAmount = Math.round((postingAmount - taxDestinationSum) * 100) / 100;

  let journalId = null;
  if (cashAcc && revenueAcc) {
    const lines: { accountId: string; debit: number; credit: number; description: string }[] = [
      { accountId: cashAcc.id, debit: postingAmount, credit: 0, description: `Cash Received - ${invoice.invoiceNumber}` },
      ...taxLines,
    ];
    if (revenueAmount > 0.001) {
      lines.push({ accountId: revenueAcc.id, debit: 0, credit: revenueAmount, description: `Revenue - ${invoice.invoiceNumber}` });
    }

    const journal = await journalService.createJournalEntry(
      {
        description: paymentDescription || `Payment Received for Invoice ${invoice.invoiceNumber} (${invoice.customer.name})`,
        entryDate: new Date().toISOString().split('T')[0],
        status: 'POSTED',
        lines,
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
