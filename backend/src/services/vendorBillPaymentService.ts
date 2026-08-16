import { prisma } from '../config/db';
import { withCurrentTenantDb } from '../database/tenantClient';
import * as accountRepository from '../repository/accountRepository';
import * as journalService from './journalEntryService';
import * as approvalWorkflowService from './approvalWorkflowService';
import { recordAuditLogTx, diffFields, AuditActor } from './auditLogService';

export class VendorBillPaymentServiceError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number = 400) {
    super(message);
    this.name = 'VendorBillPaymentServiceError';
    this.statusCode = statusCode;
  }
}

/**
 * Marks one vendor bill PAID and posts the real Debit Expense / Credit Cash
 * journal entry - extracted from routes/bills.ts's POST /:id/pay so this
 * exact logic can also be called from vendorPaymentSchedulingCronService.ts
 * (automated payment on a bill's scheduledPaymentDate) without duplicating
 * it. Requires an active tenant context (withCurrentTenantDb) - the cron
 * establishes one via runWithTenantContext per tenant, same as
 * dunningReminderService.ts.
 */
export async function payVendorBill(tenantId: string, billId: string, actor?: AuditActor) {
  const bill = await withCurrentTenantDb(prisma, async (client) => {
    return (client as any).vendorBill.findFirst({ where: { id: billId, tenantId }, include: { vendor: true } });
  });

  if (!bill) {
    throw new VendorBillPaymentServiceError('Vendor bill not found.', 404);
  }
  if (bill.status === 'PAID') {
    throw new VendorBillPaymentServiceError('Vendor bill is already paid.', 400);
  }

  // Opt-in approval gate: only blocks if approval was actually requested for this bill.
  await approvalWorkflowService.assertApprovedOrNoWorkflow(tenantId, 'VendorBill', billId);

  const accounts = await withCurrentTenantDb(prisma, (client) => accountRepository.listAccounts(client));
  const expenseAcc = accountRepository.resolveDefaultAccount(accounts, 'EXPENSE') || accounts[0];
  const cashAcc = accountRepository.resolveDefaultAccount(accounts, 'CASH') || accounts[0];

  const postingAmount = bill.baseCurrencyAmount != null ? Number(bill.baseCurrencyAmount) : Number(bill.amount);

  let journalId = null;
  if (expenseAcc && cashAcc) {
    const journal = await journalService.createJournalEntry(
      {
        description: `Vendor Bill Payment for ${bill.billNumber} (${bill.vendor.name})`,
        entryDate: new Date().toISOString().split('T')[0],
        status: 'POSTED',
        lines: [
          { accountId: expenseAcc.id, debit: postingAmount, credit: 0, description: `Expense - ${bill.billNumber}`, fundId: bill.fundId || undefined },
          { accountId: cashAcc.id, debit: 0, credit: postingAmount, description: `Cash Payment - ${bill.billNumber}`, fundId: bill.fundId || undefined },
        ],
      },
      actor
    );
    journalId = journal.id;
  }

  return withCurrentTenantDb(prisma, async (client) => {
    const updated = await (client as any).vendorBill.update({
      where: { id: billId },
      data: { status: 'PAID', journalId },
    });

    await recordAuditLogTx(client, {
      action: 'VENDOR_BILL.PAID',
      entity: 'VendorBill',
      entityId: billId,
      actor,
      changes: diffFields(bill, updated, ['status', 'journalId']),
      details: `Vendor bill ${bill.billNumber} marked PAID (${postingAmount}).`,
    });

    return updated;
  });
}
