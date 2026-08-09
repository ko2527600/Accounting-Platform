import { prisma } from '../config/db';
import { withCurrentTenantDb } from '../database/tenantClient';
import * as accountRepository from '../repository/accountRepository';
import * as journalEntryService from './journalEntryService';
import { recordAuditLog, AuditActor } from './auditLogService';
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
}

function validateInput(input: IssueNoteInput): { amount: number; reason: string } {
  const amount = Number(input?.amount);
  if (!amount || isNaN(amount) || amount <= 0) {
    throw new CreditDebitNoteServiceError('Amount must be a number greater than 0.', 400);
  }
  const reason = (input?.reason || '').trim();
  if (!reason) {
    throw new CreditDebitNoteServiceError('A reason is required.', 400);
  }
  return { amount: Math.round(amount * 100) / 100, reason };
}

/**
 * Issues a Credit Note against an Invoice (returned goods, overcharge,
 * negotiated discount, etc.).
 *
 * This platform only recognizes revenue at payment time (see invoices.ts's
 * `/pay` handler - no separate Accounts Receivable posting happens at
 * invoice creation), so the correct treatment genuinely differs by whether
 * the invoice has already been paid:
 *  - Unpaid invoice: nothing has been posted to the ledger yet, so the note
 *    simply reduces what the invoice will charge on payment - no journal
 *    entry (`method: 'INVOICE_REDUCTION'`).
 *  - Paid invoice: revenue and cash were already recognized at the original
 *    total, so the note posts a real reversing entry (Debit Revenue, Credit
 *    Cash) and leaves the invoice's own total/status untouched as the
 *    historical record of what was actually paid (`method: 'JOURNAL_REVERSAL'`).
 */
export async function createCreditNote(invoiceId: string, input: IssueNoteInput, actor?: AuditActor) {
  const { tenantId } = requireTenantContext();
  const { amount, reason } = validateInput(input);

  const invoice = await withCurrentTenantDb(prisma, async (client) => {
    return (client as any).invoice.findFirst({ where: { id: invoiceId, tenantId }, include: { customer: true } });
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

  const creditNoteNumber = `CN-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
  const method: 'INVOICE_REDUCTION' | 'JOURNAL_REVERSAL' = invoice.status === 'PAID' ? 'JOURNAL_REVERSAL' : 'INVOICE_REDUCTION';
  let journalId: string | null = null;

  if (method === 'JOURNAL_REVERSAL') {
    const accounts = await withCurrentTenantDb(prisma, (client) => accountRepository.listAccounts(client));
    const cashAcc = accounts.find((a: any) => a.code === '1010') || accounts[0];
    const revenueAcc = accounts.find((a: any) => a.code === '4010') || accounts[1] || accounts[0];
    if (!cashAcc || !revenueAcc) {
      throw new CreditDebitNoteServiceError('No accounts available to post the credit note reversal - set up your Chart of Accounts first.', 400);
    }
    const journal = await journalEntryService.createJournalEntry(
      {
        description: `Credit Note ${creditNoteNumber} for Invoice ${invoice.invoiceNumber} (${invoice.customer.name}) - ${reason}`,
        entryDate: new Date().toISOString().split('T')[0],
        status: 'POSTED',
        lines: [
          { accountId: revenueAcc.id, debit: amount, credit: 0, description: `Revenue reversal - ${creditNoteNumber}` },
          { accountId: cashAcc.id, debit: 0, credit: amount, description: `Cash refund - ${creditNoteNumber}` },
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

    if (method === 'INVOICE_REDUCTION') {
      const originalTotal = Number(invoice.total);
      const newTotal = Math.round((originalTotal - amount) * 100) / 100;
      const newBaseCurrencyAmount =
        invoice.baseCurrencyAmount != null && originalTotal > 0
          ? Math.round(((Number(invoice.baseCurrencyAmount) * newTotal) / originalTotal) * 100) / 100
          : invoice.baseCurrencyAmount;
      await (client as any).invoice.update({
        where: { id: invoiceId },
        data: { total: newTotal, baseCurrencyAmount: newBaseCurrencyAmount },
      });
    }

    return note;
  });

  await recordAuditLog({
    action: 'CREDIT_NOTE.ISSUED',
    entity: 'CreditNote',
    entityId: created.id,
    actor,
    details: `Credit note ${creditNoteNumber} for ${amount.toFixed(2)} against invoice ${invoice.invoiceNumber} (${method}). Reason: ${reason}`,
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
    const expenseAcc = accounts.find((a: any) => a.code === '5010') || accounts[accounts.length - 1] || accounts[0];
    const cashAcc = accounts.find((a: any) => a.code === '1010') || accounts[0];
    if (!expenseAcc || !cashAcc) {
      throw new CreditDebitNoteServiceError('No accounts available to post the debit note reversal - set up your Chart of Accounts first.', 400);
    }
    const journal = await journalEntryService.createJournalEntry(
      {
        description: `Debit Note ${debitNoteNumber} for Bill ${bill.billNumber} (${bill.vendor.name}) - ${reason}`,
        entryDate: new Date().toISOString().split('T')[0],
        status: 'POSTED',
        lines: [
          { accountId: cashAcc.id, debit: amount, credit: 0, description: `Cash refund received - ${debitNoteNumber}` },
          { accountId: expenseAcc.id, debit: 0, credit: amount, description: `Expense reversal - ${debitNoteNumber}` },
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

    return note;
  });

  await recordAuditLog({
    action: 'DEBIT_NOTE.ISSUED',
    entity: 'DebitNote',
    entityId: created.id,
    actor,
    details: `Debit note ${debitNoteNumber} for ${amount.toFixed(2)} against bill ${bill.billNumber} (${method}). Reason: ${reason}`,
  });

  return created;
}

export async function listDebitNotesForBill(billId: string) {
  const { tenantId } = requireTenantContext();
  return withCurrentTenantDb(prisma, async (client) => {
    return (client as any).debitNote.findMany({ where: { billId, tenantId }, orderBy: { createdAt: 'desc' } });
  });
}
