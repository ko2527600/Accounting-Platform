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

export class JournalEntryServiceError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number = 400) {
    super(message);
    this.name = 'JournalEntryServiceError';
    this.statusCode = statusCode;
  }
}

export interface CreateJournalEntryInput {
  entryNumber?: string;
  entryDate?: string | Date;
  description?: string;
  status?: JournalEntryStatus;
  lines: CreateJournalEntryLineData[];
}

export async function createJournalEntry(data: CreateJournalEntryInput): Promise<JournalEntryRecord> {
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

  return withCurrentTenantDb(prisma, async (client) => {
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

    // Convert date string if provided
    let entryDate: Date | undefined;
    if (data.entryDate) {
      entryDate = new Date(data.entryDate);
      if (isNaN(entryDate.getTime())) {
        throw new JournalEntryServiceError('Invalid entry date format.', 400);
      }
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
      })),
    });

    // If created with status POSTED, post to ledger
    if (status === 'POSTED') {
      await ledgerRepository.postJournalEntryToLedger(client, entry.id);
    }

    return entry;
  });
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

export async function postJournalEntry(id: string): Promise<JournalEntryRecord> {
  if (!id || typeof id !== 'string') {
    throw new JournalEntryServiceError('Journal Entry ID is required.', 400);
  }

  return withCurrentTenantDb(prisma, async (client) => {
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

    // Update status to POSTED
    const updatedEntry = await journalEntryRepository.updateJournalEntryStatus(client, id, 'POSTED');
    if (!updatedEntry) {
      throw new JournalEntryServiceError(`Failed to update status for journal entry "${id}".`, 500);
    }

    // Create ledger records
    await ledgerRepository.postJournalEntryToLedger(client, id);

    return updatedEntry;
  });
}

export async function voidJournalEntry(id: string): Promise<JournalEntryRecord> {
  if (!id || typeof id !== 'string') {
    throw new JournalEntryServiceError('Journal Entry ID is required.', 400);
  }

  return withCurrentTenantDb(prisma, async (client) => {
    const entry = await journalEntryRepository.getJournalEntryById(client, id);
    if (!entry) {
      throw new JournalEntryServiceError(`Journal entry with ID "${id}" not found.`, 404);
    }

    if (entry.status === 'VOID') {
      throw new JournalEntryServiceError(`Journal entry "${entry.entryNumber}" is already voided.`, 400);
    }

    const updatedEntry = await journalEntryRepository.updateJournalEntryStatus(client, id, 'VOID');
    if (!updatedEntry) {
      throw new JournalEntryServiceError(`Failed to void journal entry "${id}".`, 500);
    }

    return updatedEntry;
  });
}
