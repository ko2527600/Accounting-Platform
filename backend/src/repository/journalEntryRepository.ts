import { PrismaClient } from '@prisma/client';

export type JournalEntryStatus = 'DRAFT' | 'POSTED' | 'VOID';

export interface JournalEntryLineRecord {
  id: string;
  journalEntryId: string;
  accountId: string;
  debit: number;
  credit: number;
  description: string | null;
  createdAt: Date;
}

export interface JournalEntryRecord {
  id: string;
  entryNumber: string;
  entryDate: Date;
  description: string | null;
  status: JournalEntryStatus;
  createdAt: Date;
  updatedAt: Date;
  lines?: JournalEntryLineRecord[];
}

export interface CreateJournalEntryLineData {
  accountId: string;
  debit: number;
  credit: number;
  description?: string;
}

export interface CreateJournalEntryData {
  entryNumber: string;
  entryDate?: Date;
  description?: string;
  status?: JournalEntryStatus;
  lines: CreateJournalEntryLineData[];
}

function mapJournalEntryRow(row: any, lines: JournalEntryLineRecord[] = []): JournalEntryRecord {
  return {
    id: row.id,
    entryNumber: row.entry_number,
    entryDate: new Date(row.entry_date),
    description: row.description || null,
    status: row.status as JournalEntryStatus,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    lines,
  };
}

function mapJournalEntryLineRow(row: any): JournalEntryLineRecord {
  return {
    id: row.id,
    journalEntryId: row.journal_entry_id,
    accountId: row.account_id,
    debit: parseFloat(row.debit),
    credit: parseFloat(row.credit),
    description: row.description || null,
    createdAt: new Date(row.created_at),
  };
}

export async function createJournalEntry(
  prisma: PrismaClient,
  data: CreateJournalEntryData
): Promise<JournalEntryRecord> {
  const status = data.status || 'DRAFT';
  const entryDate = data.entryDate ? data.entryDate.toISOString().split('T')[0] : new Date().toISOString().split('T')[0];

  // Insert header
  const headerRows: any[] = await prisma.$queryRawUnsafe(
    `INSERT INTO journal_entries (entry_number, entry_date, description, status)
     VALUES ($1, $2::date, $3, $4)
     RETURNING id, entry_number, entry_date, description, status, created_at, updated_at`,
    data.entryNumber.trim(),
    entryDate,
    data.description || null,
    status
  );

  const entryHeader = headerRows[0];
  const insertedLines: JournalEntryLineRecord[] = [];

  // Insert lines
  for (const line of data.lines) {
    const lineRows: any[] = await prisma.$queryRawUnsafe(
      `INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5)
       RETURNING id, journal_entry_id, account_id, debit, credit, description, created_at`,
      entryHeader.id,
      line.accountId,
      line.debit || 0.00,
      line.credit || 0.00,
      line.description || null
    );
    insertedLines.push(mapJournalEntryLineRow(lineRows[0]));
  }

  return mapJournalEntryRow(entryHeader, insertedLines);
}

export async function getJournalEntryById(
  prisma: PrismaClient,
  id: string
): Promise<JournalEntryRecord | null> {
  const headerRows: any[] = await prisma.$queryRawUnsafe(
    `SELECT id, entry_number, entry_date, description, status, created_at, updated_at
     FROM journal_entries
     WHERE id = $1::uuid`,
    id
  );

  if (!headerRows || headerRows.length === 0) return null;

  const lineRows: any[] = await prisma.$queryRawUnsafe(
    `SELECT id, journal_entry_id, account_id, debit, credit, description, created_at
     FROM journal_entry_lines
     WHERE journal_entry_id = $1::uuid
     ORDER BY created_at ASC`,
    id
  );

  const lines = lineRows.map(mapJournalEntryLineRow);
  return mapJournalEntryRow(headerRows[0], lines);
}

export async function listJournalEntries(prisma: PrismaClient): Promise<JournalEntryRecord[]> {
  const headerRows: any[] = await prisma.$queryRawUnsafe(
    `SELECT id, entry_number, entry_date, description, status, created_at, updated_at
     FROM journal_entries
     ORDER BY entry_date DESC, created_at DESC`
  );

  const results: JournalEntryRecord[] = [];
  for (const header of headerRows) {
    const lineRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT id, journal_entry_id, account_id, debit, credit, description, created_at
       FROM journal_entry_lines
       WHERE journal_entry_id = $1::uuid
       ORDER BY created_at ASC`,
      header.id
    );
    results.push(mapJournalEntryRow(header, lineRows.map(mapJournalEntryLineRow)));
  }

  return results;
}

export async function updateJournalEntryStatus(
  prisma: PrismaClient,
  id: string,
  status: JournalEntryStatus
): Promise<JournalEntryRecord | null> {
  const rows: any[] = await prisma.$queryRawUnsafe(
    `UPDATE journal_entries
     SET status = $1, updated_at = CURRENT_TIMESTAMP
     WHERE id = $2::uuid
     RETURNING id, entry_number, entry_date, description, status, created_at, updated_at`,
    status,
    id
  );

  if (!rows || rows.length === 0) return null;
  return getJournalEntryById(prisma, id);
}

export async function deleteJournalEntry(prisma: PrismaClient, id: string): Promise<boolean> {
  const count = await prisma.$executeRawUnsafe(
    `DELETE FROM journal_entries WHERE id = $1::uuid`,
    id
  );
  return count > 0;
}
