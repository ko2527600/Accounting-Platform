import { prisma } from '../config/db';
import { withCurrentTenantDb } from '../database/tenantClient';
import * as accountRepository from '../repository/accountRepository';
import * as journalEntryService from './journalEntryService';
import { AuditActor } from './auditLogService';

export class PettyCashServiceError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number = 400) {
    super(message);
    this.name = 'PettyCashServiceError';
    this.statusCode = statusCode;
  }
}

export interface RecordPettyCashEntryInput {
  tenantId: string;
  direction: 'DISBURSEMENT' | 'REPLENISHMENT';
  description: string;
  amount: number;
  entryDate?: string | Date;
  pettyCashAccountId: string;
  counterAccountId: string;
}

/**
 * Records one petty cash disbursement/replenishment - posts a real 2-line
 * journal entry immediately (same "constrained wrapper around
 * createJournalEntry" pattern as Contra Vouchers), then logs a
 * PettyCashEntry row over it. Both accounts must belong to this tenant's
 * real Chart of Accounts; whether they're the "right kind" of account
 * (petty cash should be an Asset, the counter account is whatever the user
 * actually spent against/funded from) is left to the user's own judgment,
 * same as Contra Vouchers only constrain the pair to both being Assets.
 */
export async function recordPettyCashEntry(input: RecordPettyCashEntryInput, actor?: AuditActor) {
  if (!input.description || !input.description.trim()) {
    throw new PettyCashServiceError('A description is required.', 400);
  }
  const amount = Number(input.amount);
  if (isNaN(amount) || amount <= 0) {
    throw new PettyCashServiceError('Amount must be a positive number.', 400);
  }
  if (input.direction !== 'DISBURSEMENT' && input.direction !== 'REPLENISHMENT') {
    throw new PettyCashServiceError('direction must be "DISBURSEMENT" or "REPLENISHMENT".', 400);
  }
  if (!input.pettyCashAccountId || !input.counterAccountId) {
    throw new PettyCashServiceError('Both a petty cash account and a counter account are required.', 400);
  }
  if (input.pettyCashAccountId === input.counterAccountId) {
    throw new PettyCashServiceError('The petty cash account and counter account must be different.', 400);
  }

  const { pettyCashAccount, counterAccount } = await withCurrentTenantDb(prisma, async (client) => {
    const accounts = await accountRepository.listAccounts(client);
    const pettyCashAccount = accounts.find((a) => a.id === input.pettyCashAccountId);
    const counterAccount = accounts.find((a) => a.id === input.counterAccountId);
    if (!pettyCashAccount) throw new PettyCashServiceError('Petty cash account not found.', 400);
    if (!counterAccount) throw new PettyCashServiceError('Counter account not found.', 400);
    return { pettyCashAccount, counterAccount };
  });

  const entryNumber = `PC-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
  const description = input.description.trim();
  const journalDescription =
    input.direction === 'DISBURSEMENT'
      ? `Petty Cash Disbursement: ${description}`
      : `Petty Cash Replenishment: ${description}`;

  const lines =
    input.direction === 'DISBURSEMENT'
      ? [
          { accountId: input.counterAccountId, debit: amount, credit: 0, description },
          { accountId: input.pettyCashAccountId, debit: 0, credit: amount, description },
        ]
      : [
          { accountId: input.pettyCashAccountId, debit: amount, credit: 0, description },
          { accountId: input.counterAccountId, debit: 0, credit: amount, description },
        ];

  const journal = await journalEntryService.createJournalEntry(
    {
      entryNumber,
      entryDate: input.entryDate,
      description: journalDescription,
      status: 'POSTED',
      lines,
    },
    actor
  );

  const entry = await prisma.pettyCashEntry.create({
    data: {
      tenantId: input.tenantId,
      entryDate: input.entryDate ? new Date(input.entryDate) : new Date(),
      direction: input.direction,
      description,
      amount,
      pettyCashAccountId: input.pettyCashAccountId,
      counterAccountId: input.counterAccountId,
      journalId: journal.id,
      recordedByUserId: actor?.userId,
      recordedByEmail: actor?.userEmail,
    },
  });

  return { entry, journal, pettyCashAccountName: pettyCashAccount.name, counterAccountName: counterAccount.name };
}

export interface PettyCashEntryWithRunningBalance {
  id: string;
  entryDate: Date;
  direction: string;
  description: string;
  amount: number;
  runningBalance: number;
  counterAccountId: string;
  recordedByEmail: string | null;
}

/**
 * Lists every entry for one petty cash account, oldest-first, with a
 * running balance computed as we go (Replenishment adds, Disbursement
 * subtracts) - there's no separate "opening balance" concept, the account
 * starts at zero the same way any new Chart of Accounts account does.
 */
export async function listPettyCashEntries(
  tenantId: string,
  pettyCashAccountId: string
): Promise<{ entries: PettyCashEntryWithRunningBalance[]; currentBalance: number }> {
  const rows = await prisma.pettyCashEntry.findMany({
    where: { tenantId, pettyCashAccountId },
    orderBy: { entryDate: 'asc' },
  });

  let running = 0;
  const entries = rows.map((r) => {
    const amount = Number(r.amount);
    running += r.direction === 'REPLENISHMENT' ? amount : -amount;
    return {
      id: r.id,
      entryDate: r.entryDate,
      direction: r.direction,
      description: r.description,
      amount,
      runningBalance: Math.round(running * 100) / 100,
      counterAccountId: r.counterAccountId,
      recordedByEmail: r.recordedByEmail,
    };
  });

  return { entries, currentBalance: Math.round(running * 100) / 100 };
}
