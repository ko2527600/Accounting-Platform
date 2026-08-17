import { prisma } from '../config/db';
import { withCurrentTenantDb } from '../database/tenantClient';
import * as accountRepository from '../repository/accountRepository';
import * as journalEntryService from './journalEntryService';
import { recordAuditLogTx, AuditActor } from './auditLogService';
import { requireTenantContext } from '../context/tenantContext';

export class CreditDebitNoteServiceError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number = 400) {
    super(message);
    this.name = 'CreditDebitNoteServiceError';
    this.statusCode = statusCode;
  }
}

export interface IssueNoteInput {
  amount: number;
  reason: string;
  // Credit notes only, and only meaningful against an itemized invoice
  // (Invoice.stockDeducted). Restoring stock requires knowing exactly which
  // units are coming back - this platform's credit notes are a lump amount,
  // not itemized, so the only case that can be restored *accurately* is a
  // credit that fully cancels the invoice (nothing left owed after it),
  // where every original line quantity can be put back exactly. A partial
  // credit note can't be tied to specific returned units, so requesting
  // returnToStock on one is rejected rather than guessed at proportionally.
  returnToStock?: boolean;
}

function validateInput(input: IssueNoteInput): { amount: number; reason: string; returnToStock: boolean } {
  const amount = Number(input?.amount);
  if (!amount || isNaN(amount) || amount <= 0) {
    throw new CreditDebitNoteServiceError('Amount must be a number greater than 0.', 400);
  }
  const reason = (input?.reason || '').trim();
  if (!reason) {
    throw new CreditDebitNoteServiceError('A reason is required.', 400);
  }
  return { amount: Math.round(amount * 100) / 100, reason, returnToStock: Boolean(input?.returnToStock) };
}

/**
 * Issues a Credit Note against an Invoice (returned goods, overcharge,
 * negotiated discount, etc.).
 *
 * This platform only recognizes revenue as cash is actually received (see
 * invoicePaymentService.recordInvoicePayment - no separate Accounts
 * Receivable posting happens at invoice creation), so the correct treatment
 * genuinely depends on how much of this invoice has already been paid:
 *  - The portion of the credit that falls within the invoice's still-unpaid
 *    balance simply reduces what's left to charge - no journal entry
 *    (`method: 'INVOICE_REDUCTION'`), exactly as for a fully-unpaid invoice.
 *  - Any portion beyond that overlaps money already recognized as revenue,
 *    so it posts a real reversing entry (Debit Revenue, Credit Cash) for
 *    just that overlapping amount and claws back the invoice's own
 *    `amountPaid` by the same amount (`method: 'JOURNAL_REVERSAL'`), since
 *    that revenue is no longer actually being kept.
 * A note against a fully unpaid invoice is 100% INVOICE_REDUCTION and a note
 * against a fully paid one is 100% JOURNAL_REVERSAL - the partially-paid
 * case is a proportional split between the two, not a third code path.
 */
export async function createCreditNote(invoiceId: string, input: IssueNoteInput, actor?: AuditActor) {
  const { tenantId } = requireTenantContext();
  const { amount, reason, returnToStock } = validateInput(input);

  const invoice = await withCurrentTenantDb(prisma, async (client) => {
    return (client as any).invoice.findFirst({ where: { id: invoiceId, tenantId }, include: { customer: true, items: true } });
  });
  if (!invoice) {
    throw new CreditDebitNoteServiceError('Invoice not found.', 404);
  }
  if (invoice.status === 'DRAFT') {
    throw new CreditDebitNoteServiceError('Cannot issue a credit note against a draft invoice - send it first.', 400);
  }

  // Cap against the remaining creditable balance: INVOICE_REDUCTION notes
  // are already baked into invoice.total (checked directly below), so only
  // JOURNAL_REVERSAL notes (which never touch invoice.total) need to be
  // subtracted separately here to avoid double-counting.
  const priorReversals = await withCurrentTenantDb(prisma, async (client) => {
    return (client as any).creditNote.aggregate({
      where: { invoiceId, tenantId, method: 'JOURNAL_REVERSAL' },
      _sum: { amount: true },
    });
  });
  const remainingCreditable = Number(invoice.total) - Number(priorReversals._sum.amount || 0);
  if (amount > remainingCreditable + 0.01) {
    throw new CreditDebitNoteServiceError(
      `Credit amount (${amount.toFixed(2)}) exceeds the remaining creditable balance (${remainingCreditable.toFixed(2)}) for invoice ${invoice.invoiceNumber}.`,
      400
    );
  }

  if (returnToStock) {
    if (!invoice.stockDeducted || !invoice.warehouseId) {
      throw new CreditDebitNoteServiceError('This invoice has no linked stock to return - it was not an itemized invoice.', 400);
    }
    // Restoring stock requires knowing exactly which units are coming back.
    // A credit note is a lump amount, not itemized, so the only case that
    // can be restored accurately (rather than guessed at proportionally) is
    // one that fully cancels what's left owed on the invoice - then every
    // original line quantity can be put back exactly.
    if (amount < remainingCreditable - 0.01) {
      throw new CreditDebitNoteServiceError(
        `Returning stock is only supported when the credit note covers the full remaining balance (${remainingCreditable.toFixed(2)}) - a partial credit can't be tied to specific returned units. Use a manual Stock Adjustment for a partial return.`,
        400
      );
    }
  }

  const creditNoteNumber = `CN-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

  // Split the credit amount across the two treatments based on how much of
  // the invoice is currently unpaid. unpaidRemaining=total for a fully
  // unpaid invoice (100% INVOICE_REDUCTION, matching the old behavior
  // exactly) and 0 for a fully paid one (100% JOURNAL_REVERSAL, also
  // matching the old behavior exactly).
  const unpaidRemaining = Math.max(0, Math.round((Number(invoice.total) - Number(invoice.amountPaid)) * 100) / 100);
  const reductionAmount = Math.min(amount, unpaidRemaining);
  const reversalAmount = Math.round((amount - reductionAmount) * 100) / 100;
  const method: 'INVOICE_REDUCTION' | 'JOURNAL_REVERSAL' | 'MIXED' =
    reductionAmount > 0 && reversalAmount > 0 ? 'MIXED' : reversalAmount > 0 ? 'JOURNAL_REVERSAL' : 'INVOICE_REDUCTION';
  let journalId: string | null = null;

  if (reversalAmount > 0.001) {
    const accounts = await withCurrentTenantDb(prisma, (client) => accountRepository.listAccounts(client));
    const cashAcc = accountRepository.resolveDefaultAccount(accounts, 'CASH') || accounts[0];
    const revenueAcc = accountRepository.resolveDefaultAccount(accounts, 'REVENUE') || accounts[0];
    if (!cashAcc || !revenueAcc) {
      throw new CreditDebitNoteServiceError('No accounts available to post the credit note reversal - set up your Chart of Accounts first.', 400);
    }
    const journal = await journalEntryService.createJournalEntry(
      {
        description: `Credit Note ${creditNoteNumber} for Invoice ${invoice.invoiceNumber} (${invoice.customer.name}) - ${reason}`,
        entryDate: new Date().toISOString().split('T')[0],
        status: 'POSTED',
        lines: [
          { accountId: revenueAcc.id, debit: reversalAmount, credit: 0, description: `Revenue reversal - ${creditNoteNumber}`, fundId: invoice.fundId || undefined },
          { accountId: cashAcc.id, debit: 0, credit: reversalAmount, description: `Cash refund - ${creditNoteNumber}`, fundId: invoice.fundId || undefined },
        ],
      },
      actor
    );
    journalId = journal.id;
  }

  const created = await withCurrentTenantDb(prisma, async (client) => {
    const note = await (client as any).creditNote.create({
      data: { tenantId, creditNoteNumber, invoiceId, amount, reason, method, journalId },
    });

    const invoiceUpdate: Record<string, unknown> = {};

    if (reductionAmount > 0.001) {
      const originalTotal = Number(invoice.total);
      const newTotal = Math.round((originalTotal - reductionAmount) * 100) / 100;
      invoiceUpdate.total = newTotal;
      invoiceUpdate.baseCurrencyAmount =
        invoice.baseCurrencyAmount != null && originalTotal > 0
          ? Math.round(((Number(invoice.baseCurrencyAmount) * newTotal) / originalTotal) * 100) / 100
          : invoice.baseCurrencyAmount;
    }
    if (reversalAmount > 0.001) {
      // Claw back amountPaid by the reversed portion - that revenue is no
      // longer being kept, so it must stop counting as "paid" too, or the
      // invoice would show a balance due that no longer matches
      // total - amountPaid once total also shrinks above.
      invoiceUpdate.amountPaid = Math.max(0, Math.round((Number(invoice.amountPaid) - reversalAmount) * 100) / 100);
    }
    if (Object.keys(invoiceUpdate).length > 0) {
      await (client as any).invoice.update({ where: { id: invoiceId }, data: invoiceUpdate });
    }

    let restoredLines = 0;
    if (returnToStock) {
      for (const line of invoice.items as any[]) {
        if (!line.inventoryItemId) continue;
        await (client as any).warehouseStock.upsert({
          where: { warehouseId_itemId: { warehouseId: invoice.warehouseId, itemId: line.inventoryItemId } },
          update: { quantityOnHand: { increment: Number(line.quantity) } },
          create: { tenantId, warehouseId: invoice.warehouseId, itemId: line.inventoryItemId, quantityOnHand: Number(line.quantity) },
        });
        restoredLines += 1;
      }
    }

    await recordAuditLogTx(client, {
      action: 'CREDIT_NOTE.ISSUED',
      entity: 'CreditNote',
      entityId: note.id,
      actor,
      details: `Credit note ${creditNoteNumber} for ${amount.toFixed(2)} against invoice ${invoice.invoiceNumber} (${method}).${restoredLines > 0 ? ` Stock restored for ${restoredLines} line(s).` : ''} Reason: ${reason}`,
    });

    return note;
  });

  return created;
}

export async function listCreditNotesForInvoice(invoiceId: string) {
  const { tenantId } = requireTenantContext();
  return withCurrentTenantDb(prisma, async (client) => {
    return (client as any).creditNote.findMany({ where: { invoiceId, tenantId }, orderBy: { createdAt: 'desc' } });
  });
}

/**
 * Issues a Debit Note against a VendorBill - the AP mirror of createCreditNote.
 * Same reasoning applies since bills.ts's `/pay` handler recognizes the
 * expense only at payment time:
 *  - Unpaid bill: reduces what the bill will charge on payment, no journal
 *    entry (`method: 'BILL_REDUCTION'`).
 *  - Paid bill: posts a real reversing entry (Debit Cash, Credit Expense -
 *    money refunded by the vendor) and leaves the bill's own amount/status
 *    untouched (`method: 'JOURNAL_REVERSAL'`).
 *
 * Scope note: this is a financial correction only - it does not adjust
 * inventory stock for itemized bills, even though a debit note commonly
 * represents goods physically returned to a vendor. Tying stock reversal to
 * a financial correction is a distinct concern; documented in STATUS.md
 * rather than silently built in.
 */
export async function createDebitNote(billId: string, input: IssueNoteInput, actor?: AuditActor) {
  const { tenantId } = requireTenantContext();
  const { amount, reason } = validateInput(input);

  const bill = await withCurrentTenantDb(prisma, async (client) => {
    return (client as any).vendorBill.findFirst({ where: { id: billId, tenantId }, include: { vendor: true } });
  });
  if (!bill) {
    throw new CreditDebitNoteServiceError('Vendor bill not found.', 404);
  }

  const priorReversals = await withCurrentTenantDb(prisma, async (client) => {
    return (client as any).debitNote.aggregate({
      where: { billId, tenantId, method: 'JOURNAL_REVERSAL' },
      _sum: { amount: true },
    });
  });
  const remainingDebitable = Number(bill.amount) - Number(priorReversals._sum.amount || 0);
  if (amount > remainingDebitable + 0.01) {
    throw new CreditDebitNoteServiceError(
      `Debit amount (${amount.toFixed(2)}) exceeds the remaining debitable balance (${remainingDebitable.toFixed(2)}) for bill ${bill.billNumber}.`,
      400
    );
  }

  const debitNoteNumber = `DN-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
  const method: 'BILL_REDUCTION' | 'JOURNAL_REVERSAL' = bill.status === 'PAID' ? 'JOURNAL_REVERSAL' : 'BILL_REDUCTION';
  let journalId: string | null = null;

  if (method === 'JOURNAL_REVERSAL') {
    const accounts = await withCurrentTenantDb(prisma, (client) => accountRepository.listAccounts(client));
    const expenseAcc = accountRepository.resolveDefaultAccount(accounts, 'EXPENSE') || accounts[0];
    const cashAcc = accountRepository.resolveDefaultAccount(accounts, 'CASH') || accounts[0];
    if (!expenseAcc || !cashAcc) {
      throw new CreditDebitNoteServiceError('No accounts available to post the debit note reversal - set up your Chart of Accounts first.', 400);
    }
    const journal = await journalEntryService.createJournalEntry(
      {
        description: `Debit Note ${debitNoteNumber} for Bill ${bill.billNumber} (${bill.vendor.name}) - ${reason}`,
        entryDate: new Date().toISOString().split('T')[0],
        status: 'POSTED',
        lines: [
          { accountId: cashAcc.id, debit: amount, credit: 0, description: `Cash refund received - ${debitNoteNumber}`, fundId: bill.fundId || undefined },
          { accountId: expenseAcc.id, debit: 0, credit: amount, description: `Expense reversal - ${debitNoteNumber}`, fundId: bill.fundId || undefined },
        ],
      },
      actor
    );
    journalId = journal.id;
  }

  const created = await withCurrentTenantDb(prisma, async (client) => {
    const note = await (client as any).debitNote.create({
      data: { tenantId, debitNoteNumber, billId, amount, reason, method, journalId },
    });

    if (method === 'BILL_REDUCTION') {
      const originalAmount = Number(bill.amount);
      const newAmount = Math.round((originalAmount - amount) * 100) / 100;
      const newBaseCurrencyAmount =
        bill.baseCurrencyAmount != null && originalAmount > 0
          ? Math.round(((Number(bill.baseCurrencyAmount) * newAmount) / originalAmount) * 100) / 100
          : bill.baseCurrencyAmount;
      await (client as any).vendorBill.update({
        where: { id: billId },
        data: { amount: newAmount, baseCurrencyAmount: newBaseCurrencyAmount },
      });
    }

    await recordAuditLogTx(client, {
      action: 'DEBIT_NOTE.ISSUED',
      entity: 'DebitNote',
      entityId: note.id,
      actor,
      details: `Debit note ${debitNoteNumber} for ${amount.toFixed(2)} against bill ${bill.billNumber} (${method}). Reason: ${reason}`,
    });

    return note;
  });

  return created;
}

export async function listDebitNotesForBill(billId: string) {
  const { tenantId } = requireTenantContext();
  return withCurrentTenantDb(prisma, async (client) => {
    return (client as any).debitNote.findMany({ where: { billId, tenantId }, orderBy: { createdAt: 'desc' } });
  });
}
