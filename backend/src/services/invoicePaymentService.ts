import { prisma } from '../config/db';
import { withCurrentTenantDb } from '../database/tenantClient';
import { requireTenantContext } from '../context/tenantContext';
import * as journalService from './journalEntryService';
import * as accountRepository from '../repository/accountRepository';
import * as approvalWorkflowService from './approvalWorkflowService';
import { recordAuditLogTx, diffFields, AuditActor } from './auditLogService';
import { recordChange, notifyChange, invoiceToSyncPayload } from './syncChangeLogService';

export class InvoicePaymentServiceError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number = 400) {
    super(message);
    this.name = 'InvoicePaymentServiceError';
    this.statusCode = statusCode;
  }
}

export interface RecordInvoicePaymentOptions {
  // Native-currency amount being paid now. Omitted/undefined means "pay off
  // whatever's still outstanding" - the old markInvoicePaid behavior,
  // preserved as the default so every existing caller (the manual /pay
  // route with no body, MoMo/TheTeller collecting their full requested
  // amount) keeps working unchanged.
  amount?: number;
  method?: 'MANUAL' | 'MOMO' | 'TELLER' | 'PAYSTACK';
  description?: string;
}

/**
 * Records a payment (full or partial) against an invoice and posts the real
 * Cash/Revenue journal entry for just that payment - shared by the manual
 * "/pay" route and the MTN MoMo / TheTeller payment-confirmation paths, so
 * all three post through the exact same accounting logic instead of
 * duplicating it. Requires tenant context to already be established: either
 * by tenantContextMiddleware on an authenticated request, or manually via
 * runWithTenantContext for a background caller.
 *
 * Revenue is still only ever recognized as cash is actually received (see
 * creditDebitNoteService.ts's module comment) - a partial payment simply
 * means that recognition now happens in more than one installment per
 * invoice instead of exactly once. Each call posts its own journal entry
 * scaled to just the amount being paid *now*, not the invoice's full total.
 */
export async function recordInvoicePayment(
  invoiceId: string,
  actor: AuditActor,
  options: RecordInvoicePaymentOptions = {}
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
  if (invoice.status === 'DRAFT') {
    throw new InvoicePaymentServiceError('Cannot record a payment against a draft invoice - send it first.', 400);
  }
  if (invoice.status === 'PAID') {
    throw new InvoicePaymentServiceError('Invoice is already paid.', 400);
  }

  await approvalWorkflowService.assertApprovedOrNoWorkflow(tenantId, 'Invoice', invoiceId);

  const invoiceTotal = Number(invoice.total);
  const alreadyPaid = Number(invoice.amountPaid);
  const remainingBalance = Math.round((invoiceTotal - alreadyPaid) * 100) / 100;

  const amount = options.amount !== undefined && options.amount !== null
    ? Math.round(Number(options.amount) * 100) / 100
    : remainingBalance;

  if (!amount || isNaN(amount) || amount <= 0) {
    throw new InvoicePaymentServiceError('Payment amount must be greater than 0.', 400);
  }
  if (amount > remainingBalance + 0.01) {
    throw new InvoicePaymentServiceError(
      `Payment amount (${amount.toFixed(2)}) exceeds the remaining balance (${remainingBalance.toFixed(2)}) for invoice ${invoice.invoiceNumber}.`,
      400
    );
  }

  const accounts = await withCurrentTenantDb(prisma, (client) => accountRepository.listAccounts(client));
  const cashAcc = accountRepository.resolveDefaultAccount(accounts, 'CASH') || accounts[0];
  const revenueAcc = accountRepository.resolveDefaultAccount(accounts, 'REVENUE') || accounts[0];
  const accountsById = new Map(accounts.map((a: any) => [a.id, a]));

  // Same base-currency conversion ratio for the whole invoice, applied to
  // just this payment's native-currency amount below - degrades to exactly
  // 1 for same-currency tenants (baseCurrencyAmount === total).
  const fxScale = invoiceTotal !== 0 && invoice.baseCurrencyAmount != null
    ? Number(invoice.baseCurrencyAmount) / invoiceTotal
    : 1;
  // What fraction of the whole invoice this one payment represents - 1 for
  // a full payment (reduces every formula below to the old single-payment
  // math exactly), less than 1 for a partial one.
  const paymentShare = invoiceTotal !== 0 ? amount / invoiceTotal : 1;

  const postingAmount = Math.round(amount * fxScale * 100) / 100;

  // Determine each levy's destination GL account and its share of this
  // payment's base-currency amount, merging levies that share a
  // destination. A destination account that no longer exists (deleted
  // after the invoice was created/taxRate was edited) is silently dropped
  // here - its amount folds into Revenue below rather than hard-blocking
  // payment of an otherwise-unrelated invoice.
  const taxDestinationTotals = new Map<string, number>();
  const breakdown: { name: string; rate: number; amount: number; accountId?: string }[] | null =
    Array.isArray(invoice.taxBreakdown) ? invoice.taxBreakdown : null;

  if (breakdown && breakdown.length > 0) {
    for (const line of breakdown) {
      if (!line.accountId || !accountsById.has(line.accountId)) continue;
      const scaledAmount = Math.round(Number(line.amount) * paymentShare * fxScale * 100) / 100;
      taxDestinationTotals.set(line.accountId, (taxDestinationTotals.get(line.accountId) || 0) + scaledAmount);
    }
  } else if (Number(invoice.tax) > 0 && invoice.taxRate?.accountId && accountsById.has(invoice.taxRate.accountId)) {
    const scaledAmount = Math.round(Number(invoice.tax) * paymentShare * fxScale * 100) / 100;
    taxDestinationTotals.set(invoice.taxRate.accountId, scaledAmount);
  }

  let taxDestinationSum = 0;
  const taxLines = Array.from(taxDestinationTotals.entries())
    .filter(([, taxAmount]) => taxAmount > 0.001)
    .map(([accountId, taxAmount]) => {
      taxDestinationSum += taxAmount;
      const account = accountsById.get(accountId) as any;
      return {
        accountId,
        debit: 0,
        credit: taxAmount,
        description: `${account?.name || 'Tax'} - ${invoice.invoiceNumber}`,
        fundId: invoice.fundId || undefined,
      };
    });

  const revenueAmount = Math.round((postingAmount - taxDestinationSum) * 100) / 100;

  let journalId = null;
  if (cashAcc && revenueAcc) {
    // Every line carries the invoice's fundId (if any) uniformly - keeps the
    // whole payment transaction inside one fund by construction, so no
    // separate "guard against cross-fund posting" logic is needed anywhere.
    const lines: { accountId: string; debit: number; credit: number; description: string; fundId?: string }[] = [
      { accountId: cashAcc.id, debit: postingAmount, credit: 0, description: `Cash Received - ${invoice.invoiceNumber}`, fundId: invoice.fundId || undefined },
      ...taxLines,
    ];
    if (revenueAmount > 0.001) {
      lines.push({ accountId: revenueAcc.id, debit: 0, credit: revenueAmount, description: `Revenue - ${invoice.invoiceNumber}`, fundId: invoice.fundId || undefined });
    }

    const journal = await journalService.createJournalEntry(
      {
        description: options.description || `Payment Received for Invoice ${invoice.invoiceNumber} (${invoice.customer.name})`,
        entryDate: new Date().toISOString().split('T')[0],
        status: 'POSTED',
        lines,
      },
      actor
    );
    journalId = journal.id;
  }

  const newAmountPaid = Math.round((alreadyPaid + amount) * 100) / 100;
  const newStatus = newAmountPaid >= invoiceTotal - 0.01 ? 'PAID' : 'PARTIALLY_PAID';

  let syncSeq: bigint | null = null;
  const updated = await withCurrentTenantDb(prisma, async (client) => {
    const invoiceUpdated = await (client as any).invoice.update({
      where: { id: invoiceId },
      data: { status: newStatus, amountPaid: newAmountPaid, journalId },
      include: { customer: true },
    });

    await (client as any).invoicePayment.create({
      data: {
        tenantId,
        invoiceId,
        amount,
        baseCurrencyAmount: postingAmount,
        method: options.method || 'MANUAL',
        journalId,
        recordedByUserId: actor.userId || null,
        recordedByEmail: actor.userEmail || null,
      },
    });

    // The transactional outbox entry - must stay inside this same
    // transaction (see syncChangeLogService.recordChange) so a client can
    // never observe a committed payment that never got logged.
    syncSeq = await recordChange(client, {
      tenantId,
      entityType: 'Invoice',
      entityId: invoiceUpdated.id,
      operation: 'UPDATE',
      payload: invoiceToSyncPayload(invoiceUpdated),
    });

    // Same transaction as the invoice's status/amountPaid write, for the
    // same reason as recordChange above.
    await recordAuditLogTx(client, {
      action: newStatus === 'PAID' ? 'INVOICE.PAID' : 'INVOICE.PARTIALLY_PAID',
      entity: 'Invoice',
      entityId: invoiceUpdated.id,
      actor,
      changes: diffFields(invoice, invoiceUpdated, ['status', 'amountPaid', 'journalId']),
      details: `Invoice ${invoice.invoiceNumber}: payment of ${amount.toFixed(2)} recorded (${newStatus === 'PAID' ? 'now fully paid' : `${(invoiceTotal - newAmountPaid).toFixed(2)} still owed`}).`,
    });

    return invoiceUpdated;
  });

  if (syncSeq !== null) {
    notifyChange({
      tenantId,
      entityType: 'Invoice',
      entityId: updated.id,
      operation: 'UPDATE',
      payload: invoiceToSyncPayload(updated),
      sequence: syncSeq,
    });
  }

  return updated;
}

/** Full payment history for an invoice, newest first - backs the "Payment History" view on Invoices.tsx. */
export async function listPaymentsForInvoice(invoiceId: string) {
  const { tenantId } = requireTenantContext();
  return withCurrentTenantDb(prisma, async (client) => {
    return (client as any).invoicePayment.findMany({
      where: { invoiceId, tenantId },
      orderBy: { createdAt: 'desc' },
    });
  });
}
