import { prisma } from '../config/db';
import { withCurrentTenantDb } from '../database/tenantClient';
import * as journalEntryRepository from '../repository/journalEntryRepository';
import {
  JournalEntryRecord,
  JournalEntryStatus,
  CreateJournalEntryLineData,
  ListJournalEntriesFilter,
} from '../repository/journalEntryRepository';
import * as accountRepository from '../repository/accountRepository';
import * as ledgerRepository from '../repository/ledgerRepository';
import * as fundService from './fundService';
import { requireTenantContext } from '../context/tenantContext';
import * as fiscalPeriodService from './fiscalPeriodService';
import * as approvalWorkflowService from './approvalWorkflowService';
import { recordAuditLogTx, AuditActor } from './auditLogService';
import { invalidateReportCache } from '../cache/reportCache';

export class JournalEntryServiceError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number = 400) {
    super(message);
    this.name = 'JournalEntryServiceError';
    this.statusCode = statusCode;
  }
}

async function assertPeriodOpenOrThrowJournalError(tenantId: string, date: Date): Promise<void> {
  try {
    await fiscalPeriodService.assertPeriodOpenForDate(tenantId, date);
  } catch (error: any) {
    if (error instanceof fiscalPeriodService.FiscalPeriodServiceError) {
      throw new JournalEntryServiceError(error.message, error.statusCode);
    }
    throw error;
  }
}

export interface CreateJournalEntryInput {
  entryNumber?: string;
  entryDate?: string | Date;
  description?: string;
  status?: JournalEntryStatus;
  lines: CreateJournalEntryLineData[];
}

export async function createJournalEntry(data: CreateJournalEntryInput, actor?: AuditActor): Promise<JournalEntryRecord> {
  // 1. Validate lines presence & minimum count
  if (!data || !data.lines || !Array.isArray(data.lines) || data.lines.length < 2) {
    throw new JournalEntryServiceError(
      'A journal entry must contain at least 2 lines (debits and credits).',
      400
    );
  }

  // 2. Validate line numbers and amounts
  let totalDebit = 0;
  let totalCredit = 0;

  for (let i = 0; i < data.lines.length; i++) {
    const line = data.lines[i];
    if (!line.accountId || typeof line.accountId !== 'string') {
      throw new JournalEntryServiceError(`Line ${i + 1}: Account ID is required.`, 400);
    }
    const debit = Number(line.debit || 0);
    const credit = Number(line.credit || 0);

    if (isNaN(debit) || debit < 0) {
      throw new JournalEntryServiceError(`Line ${i + 1}: Debit must be a non-negative number.`, 400);
    }
    if (isNaN(credit) || credit < 0) {
      throw new JournalEntryServiceError(`Line ${i + 1}: Credit must be a non-negative number.`, 400);
    }
    if (debit === 0 && credit === 0) {
      throw new JournalEntryServiceError(
        `Line ${i + 1}: Line must specify either a debit or credit amount greater than 0.`,
        400
      );
    }
    if (debit > 0 && credit > 0) {
      throw new JournalEntryServiceError(
        `Line ${i + 1}: A line cannot contain both debit and credit amounts.`,
        400
      );
    }

    totalDebit += debit;
    totalCredit += credit;
  }

  // 3. Double-entry balancing validation
  const roundedDebit = Math.round(totalDebit * 100) / 100;
  const roundedCredit = Math.round(totalCredit * 100) / 100;

  if (Math.abs(roundedDebit - roundedCredit) > 0.001) {
    throw new JournalEntryServiceError(
      `Journal entry is not balanced. Total Debits (${roundedDebit.toFixed(
        2
      )}) must equal Total Credits (${roundedCredit.toFixed(2)}).`,
      400
    );
  }

  if (roundedDebit <= 0) {
    throw new JournalEntryServiceError('Journal entry total debit/credit amount must be greater than 0.', 400);
  }

  // 4. Validate status
  const status: JournalEntryStatus = data.status || 'DRAFT';
  if (!['DRAFT', 'POSTED'].includes(status)) {
    throw new JournalEntryServiceError(`Invalid status "${data.status}". Creation allowed status: DRAFT, POSTED.`, 400);
  }

  // 5. Generate entryNumber if not provided
  let entryNumber = data.entryNumber?.trim();
  if (!entryNumber) {
    entryNumber = `JE-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
  }

  const entry = await withCurrentTenantDb(prisma, async (client) => {
    // Check entryNumber uniqueness
    const existingEntry = await journalEntryRepository.getJournalEntryByEntryNumber(client, entryNumber!);
    if (existingEntry) {
      throw new JournalEntryServiceError(`Journal entry number "${entryNumber}" already exists.`, 409);
    }

    // Verify all accountIds exist in tenant schema
    for (let i = 0; i < data.lines.length; i++) {
      const line = data.lines[i];
      const account = await accountRepository.getAccountById(client, line.accountId);
      if (!account) {
        throw new JournalEntryServiceError(
          `Line ${i + 1}: Account with ID "${line.accountId}" does not exist.`,
          400
        );
      }
    }

    // Verify any fundId referenced by a line belongs to this tenant (fund
    // accounting for nonprofit tenants) - Fund lives in the shared public
    // schema, so this is a separate lookup from the accountId check above.
    const { tenantId: currentTenantId } = requireTenantContext();
    for (let i = 0; i < data.lines.length; i++) {
      const line = data.lines[i];
      if (line.fundId) {
        try {
          await fundService.validateFundId(currentTenantId, line.fundId);
        } catch (error: any) {
          if (error instanceof fundService.FundServiceError) {
            throw new JournalEntryServiceError(`Line ${i + 1}: ${error.message}`, error.statusCode);
          }
          throw error;
        }
      }
    }

    // Convert date string if provided
    let entryDate: Date | undefined;
    if (data.entryDate) {
      entryDate = new Date(data.entryDate);
      if (isNaN(entryDate.getTime())) {
        throw new JournalEntryServiceError('Invalid entry date format.', 400);
      }
    }

    // Only entries that post immediately touch the ledger, so only those need
    // the fiscal-period-open check here - a DRAFT can still be saved for a
    // closed/locked period date since it has no ledger effect until posted.
    if (status === 'POSTED') {
      const { tenantId } = requireTenantContext();
      await assertPeriodOpenOrThrowJournalError(tenantId, entryDate || new Date());
    }

    // Create journal entry in DB
    const entry = await journalEntryRepository.createJournalEntry(client, {
      entryNumber: entryNumber!,
      entryDate,
      description: data.description,
      status,
      lines: data.lines.map((l) => ({
        accountId: l.accountId,
        debit: Number(l.debit || 0),
        credit: Number(l.credit || 0),
        description: l.description,
        fundId: l.fundId || undefined,
      })),
    });

    // If created with status POSTED, post to ledger
    if (status === 'POSTED') {
      await ledgerRepository.postJournalEntryToLedger(client, entry.id);
    }

    // Written in the same transaction as the ledger write above so the audit
    // trail can never desync from the data it describes - a failed audit
    // write rolls the whole entry back rather than landing unaudited.
    await recordAuditLogTx(client, {
      action: 'JOURNAL_ENTRY.CREATED',
      entity: 'JournalEntry',
      entityId: entry.id,
      actor,
      details: `Journal entry ${entry.entryNumber} created with status ${entry.status}.`,
    });

    return entry;
  });

  return entry;
}

export interface CreateContraVoucherInput {
  entryDate?: string | Date;
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  description?: string;
}

/**
 * A Contra Voucher is an internal fund transfer between two of the
 * business's own cash/bank accounts (e.g. "till to bank"). It's a
 * constrained, exactly-two-line journal entry: destination account is
 * debited, source account is credited, both for the same amount. Uses a
 * distinct `CV-` entryNumber prefix (vs. the generic `JE-`) as the
 * discriminator between contra vouchers and regular journal entries -
 * no separate schema column needed since createJournalEntry already
 * accepts a caller-supplied entryNumber.
 */
export async function createContraVoucher(data: CreateContraVoucherInput, actor?: AuditActor): Promise<JournalEntryRecord> {
  if (!data.fromAccountId || typeof data.fromAccountId !== 'string') {
    throw new JournalEntryServiceError('A source ("from") account is required.', 400);
  }
  if (!data.toAccountId || typeof data.toAccountId !== 'string') {
    throw new JournalEntryServiceError('A destination ("to") account is required.', 400);
  }
  if (data.fromAccountId === data.toAccountId) {
    throw new JournalEntryServiceError('The source and destination accounts must be different.', 400);
  }
  const amount = Number(data.amount);
  if (isNaN(amount) || amount <= 0) {
    throw new JournalEntryServiceError('Transfer amount must be a positive number.', 400);
  }

  const { fromAccount, toAccount } = await withCurrentTenantDb(prisma, async (client) => {
    const fromAccount = await accountRepository.getAccountById(client, data.fromAccountId);
    if (!fromAccount) {
      throw new JournalEntryServiceError(`Source account with ID "${data.fromAccountId}" does not exist.`, 400);
    }
    const toAccount = await accountRepository.getAccountById(client, data.toAccountId);
    if (!toAccount) {
      throw new JournalEntryServiceError(`Destination account with ID "${data.toAccountId}" does not exist.`, 400);
    }
    if (fromAccount.type !== 'ASSET' || toAccount.type !== 'ASSET') {
      throw new JournalEntryServiceError(
        'Contra Vouchers can only transfer funds between Asset accounts (cash/bank/till).',
        400
      );
    }
    return { fromAccount, toAccount };
  });

  const entryNumber = `CV-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
  const description = data.description?.trim()
    ? `Contra Voucher: ${fromAccount.name} → ${toAccount.name} - ${data.description.trim()}`
    : `Contra Voucher: ${fromAccount.name} → ${toAccount.name}`;

  return createJournalEntry(
    {
      entryNumber,
      entryDate: data.entryDate,
      description,
      status: 'POSTED',
      lines: [
        { accountId: data.toAccountId, debit: amount, credit: 0 },
        { accountId: data.fromAccountId, debit: 0, credit: amount },
      ],
    },
    actor
  );
}

export async function listJournalEntries(
  filter?: ListJournalEntriesFilter
): Promise<JournalEntryRecord[]> {
  return withCurrentTenantDb(prisma, async (client) => {
    return journalEntryRepository.listJournalEntries(client, filter);
  });
}

export async function getJournalEntryById(id: string): Promise<JournalEntryRecord | null> {
  if (!id || typeof id !== 'string') {
    return null;
  }

  return withCurrentTenantDb(prisma, async (client) => {
    return journalEntryRepository.getJournalEntryById(client, id);
  });
}

export async function postJournalEntry(id: string, actor?: AuditActor): Promise<JournalEntryRecord> {
  if (!id || typeof id !== 'string') {
    throw new JournalEntryServiceError('Journal Entry ID is required.', 400);
  }

  let previousStatus: JournalEntryStatus = 'DRAFT';

  const updatedEntry = await withCurrentTenantDb(prisma, async (client) => {
    const entry = await journalEntryRepository.getJournalEntryById(client, id);
    if (!entry) {
      throw new JournalEntryServiceError(`Journal entry with ID "${id}" not found.`, 404);
    }

    if (entry.status === 'POSTED') {
      throw new JournalEntryServiceError(`Journal entry "${entry.entryNumber}" is already posted.`, 400);
    }

    if (entry.status === 'VOID') {
      throw new JournalEntryServiceError(`Cannot post a voided journal entry.`, 400);
    }

    previousStatus = entry.status;

    // Re-verify double-entry balance
    let totalDebit = 0;
    let totalCredit = 0;
    for (const line of entry.lines || []) {
      totalDebit += line.debit;
      totalCredit += line.credit;
    }

    const roundedDebit = Math.round(totalDebit * 100) / 100;
    const roundedCredit = Math.round(totalCredit * 100) / 100;

    if (Math.abs(roundedDebit - roundedCredit) > 0.001) {
      throw new JournalEntryServiceError(
        `Journal entry is not balanced. Total Debits (${roundedDebit.toFixed(
          2
        )}) must equal Total Credits (${roundedCredit.toFixed(2)}).`,
        400
      );
    }

    const { tenantId } = requireTenantContext();
    await assertPeriodOpenOrThrowJournalError(tenantId, entry.entryDate);

    // Opt-in approval gate: only blocks if someone actually requested
    // approval for this journal entry - most entries have no workflow at all.
    try {
      await approvalWorkflowService.assertApprovedOrNoWorkflow(tenantId, 'JournalEntry', id);
    } catch (error: any) {
      if (error instanceof approvalWorkflowService.ApprovalWorkflowServiceError) {
        throw new JournalEntryServiceError(error.message, error.statusCode);
      }
      throw error;
    }

    // Update status to POSTED
    const updatedEntry = await journalEntryRepository.updateJournalEntryStatus(client, id, 'POSTED');
    if (!updatedEntry) {
      throw new JournalEntryServiceError(`Failed to update status for journal entry "${id}".`, 500);
    }

    // Create ledger records
    await ledgerRepository.postJournalEntryToLedger(client, id);

    await recordAuditLogTx(client, {
      action: 'JOURNAL_ENTRY.POSTED',
      entity: 'JournalEntry',
      entityId: updatedEntry.id,
      actor,
      changes: { status: { from: previousStatus, to: 'POSTED' } },
    });

    return updatedEntry;
  });

  const { tenantId } = requireTenantContext();
  void invalidateReportCache(tenantId);

  return updatedEntry;
}

export interface VoidJournalEntryResult {
  journalEntry: JournalEntryRecord;
  reversalEntry: JournalEntryRecord | null;
}

export async function voidJournalEntry(
  id: string,
  actor?: AuditActor,
  reason?: string
): Promise<VoidJournalEntryResult> {
  if (!id || typeof id !== 'string') {
    throw new JournalEntryServiceError('Journal Entry ID is required.', 400);
  }

  let previousStatus: JournalEntryStatus = 'DRAFT';

  const { journalEntry, reversalEntry } = await withCurrentTenantDb(prisma, async (client) => {
    const entry = await journalEntryRepository.getJournalEntryById(client, id);
    if (!entry) {
      throw new JournalEntryServiceError(`Journal entry with ID "${id}" not found.`, 404);
    }

    if (entry.status === 'VOID') {
      throw new JournalEntryServiceError(`Journal entry "${entry.entryNumber}" is already voided.`, 400);
    }

    previousStatus = entry.status;

    // A DRAFT never touched the ledger, so voiding it is just a status flip -
    // no reversal is needed or created.
    if (entry.status === 'DRAFT') {
      const updatedEntry = await journalEntryRepository.updateJournalEntryStatus(client, id, 'VOID');
      if (!updatedEntry) {
        throw new JournalEntryServiceError(`Failed to void journal entry "${id}".`, 500);
      }
      await recordAuditLogTx(client, {
        action: 'JOURNAL_ENTRY.VOIDED',
        entity: 'JournalEntry',
        entityId: updatedEntry.id,
        actor,
        changes: { status: { from: previousStatus, to: 'VOID' } },
      });
      return { journalEntry: updatedEntry, reversalEntry: null as JournalEntryRecord | null };
    }

    // entry.status === 'POSTED': it already has real ledger rows, so voiding
    // it must post a real offsetting entry today (not just flip a flag) -
    // reports/G-L sum directly from `ledgers` with no join back to journal
    // entry status, so only an actual reversing entry corrects the numbers.
    const { tenantId } = requireTenantContext();
    const today = new Date();
    await assertPeriodOpenOrThrowJournalError(tenantId, today);

    let reversalEntryNumber = `REV-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
    while (await journalEntryRepository.getJournalEntryByEntryNumber(client, reversalEntryNumber)) {
      reversalEntryNumber = `REV-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
    }

    const reversal = await journalEntryRepository.createJournalEntry(client, {
      entryNumber: reversalEntryNumber,
      entryDate: today,
      description: `Reversal of ${entry.entryNumber}: ${reason?.trim() || entry.description || 'Journal Entry Void'}`,
      status: 'POSTED',
      reversalOfEntryId: entry.id,
      // fundId must be carried through here or a void of a fund-tagged entry
      // produces a reversal with no fund tag - the original stays counted
      // against the fund in a fund-filtered report but its reversal never
      // cancels it out, permanently overstating that fund's balance.
      lines: (entry.lines || []).map((l) => ({
        accountId: l.accountId,
        debit: l.credit,
        credit: l.debit,
        description: l.description || undefined,
        fundId: l.fundId || undefined,
      })),
    });

    await ledgerRepository.postJournalEntryToLedger(client, reversal.id);

    const voidedOriginal = await journalEntryRepository.setReversalLink(client, entry.id, reversal.id);
    if (!voidedOriginal) {
      throw new JournalEntryServiceError(`Failed to void journal entry "${id}".`, 500);
    }

    const reversalWithLines = await journalEntryRepository.getJournalEntryById(client, reversal.id);

    await recordAuditLogTx(client, {
      action: 'JOURNAL_ENTRY.VOIDED',
      entity: 'JournalEntry',
      entityId: voidedOriginal.id,
      actor,
      changes: { status: { from: previousStatus, to: 'VOID' } },
      details: reversalWithLines ? `Reversed by ${reversalWithLines.entryNumber}.` : undefined,
    });

    if (reversalWithLines) {
      await recordAuditLogTx(client, {
        action: 'JOURNAL_ENTRY.REVERSED',
        entity: 'JournalEntry',
        entityId: reversalWithLines.id,
        actor,
        details: `Reversal of ${voidedOriginal.entryNumber}.`,
      });
    }

    return { journalEntry: voidedOriginal, reversalEntry: reversalWithLines };
  });

  const { tenantId } = requireTenantContext();
  void invalidateReportCache(tenantId);

  return { journalEntry, reversalEntry };
}
