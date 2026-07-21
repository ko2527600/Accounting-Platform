import { PrismaClient } from '@prisma/client';
import { getJournalEntryById } from './journalEntryRepository';

export interface LedgerRecord {
  id: string;
  accountId: string;
  transactionDate: Date;
  journalEntryId: string | null;
  debit: number;
  credit: number;
  balance: number;
  description: string | null;
  createdAt: Date;
}

export interface CreateLedgerData {
  accountId: string;
  transactionDate?: Date;
  journalEntryId?: string | null;
  debit: number;
  credit: number;
  balance?: number;
  description?: string | null;
}

function mapLedgerRow(row: any): LedgerRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    transactionDate: new Date(row.transaction_date),
    journalEntryId: row.journal_entry_id || null,
    debit: parseFloat(row.debit),
    credit: parseFloat(row.credit),
    balance: parseFloat(row.balance),
    description: row.description || null,
    createdAt: new Date(row.created_at),
  };
}

export async function createLedgerEntry(
  prisma: PrismaClient,
  data: CreateLedgerData
): Promise<LedgerRecord> {
  const transactionDate = data.transactionDate
    ? data.transactionDate.toISOString().split('T')[0]
    : new Date().toISOString().split('T')[0];

  const rows: any[] = await prisma.$queryRawUnsafe(
    `INSERT INTO ledgers (account_id, transaction_date, journal_entry_id, debit, credit, balance, description)
     VALUES ($1::uuid, $2::date, $3::uuid, $4, $5, $6, $7)
     RETURNING id, account_id, transaction_date, journal_entry_id, debit, credit, balance, description, created_at`,
    data.accountId,
    transactionDate,
    data.journalEntryId || null,
    data.debit || 0.00,
    data.credit || 0.00,
    data.balance || 0.00,
    data.description || null
  );

  return mapLedgerRow(rows[0]);
}

export async function getLedgerByAccountId(
  prisma: PrismaClient,
  accountId: string
): Promise<LedgerRecord[]> {
  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT id, account_id, transaction_date, journal_entry_id, debit, credit, balance, description, created_at
     FROM ledgers
     WHERE account_id = $1::uuid
     ORDER BY transaction_date ASC, created_at ASC`,
    accountId
  );

  return rows.map(mapLedgerRow);
}

export async function postJournalEntryToLedger(
  prisma: PrismaClient,
  journalEntryId: string
): Promise<LedgerRecord[]> {
  const entry = await getJournalEntryById(prisma, journalEntryId);
  if (!entry) {
    throw new Error(`Journal entry ${journalEntryId} not found.`);
  }

  if (entry.status !== 'POSTED') {
    throw new Error(`Journal entry ${journalEntryId} must be POSTED before posting to ledgers.`);
  }

  const createdLedgerEntries: LedgerRecord[] = [];

  for (const line of entry.lines || []) {
    // Fetch latest balance for account
    const lastLedgers: any[] = await prisma.$queryRawUnsafe(
      `SELECT balance FROM ledgers WHERE account_id = $1::uuid ORDER BY transaction_date DESC, created_at DESC LIMIT 1`,
      line.accountId
    );

    const prevBalance = lastLedgers.length > 0 ? parseFloat(lastLedgers[0].balance) : 0.00;
    const newBalance = prevBalance + line.debit - line.credit;

    const ledger = await createLedgerEntry(prisma, {
      accountId: line.accountId,
      transactionDate: entry.entryDate,
      journalEntryId: entry.id,
      debit: line.debit,
      credit: line.credit,
      balance: newBalance,
      description: line.description || entry.description,
    });

    createdLedgerEntries.push(ledger);
  }

  return createdLedgerEntries;
}
