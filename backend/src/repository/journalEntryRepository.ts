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
  // Optional restricted/unrestricted fund this line belongs to (fund
  // accounting for nonprofit tenants). Not a real FK - Fund lives in the
  // shared public schema, this table lives per-tenant - validated at the
  // service layer via fundService.validateFundId before every write.
  fundId: string | null;
}

export interface JournalEntryRecord {
  id: string;
  entryNumber: string;
  entryDate: Date;
  description: string | null;
  status: JournalEntryStatus;
  createdAt: Date;
  updatedAt: Date;
  reversalOfEntryId: string | null;
  reversedByEntryId: string | null;
  lines?: JournalEntryLineRecord[];
}

export interface CreateJournalEntryLineData {
  accountId: string;
  debit: number;
  credit: number;
  description?: string;
  fundId?: string | null;
}

export interface CreateJournalEntryData {
  entryNumber: string;
  entryDate?: Date;
  description?: string;
  status?: JournalEntryStatus;
  reversalOfEntryId?: string;
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
    reversalOfEntryId: row.reversal_of_entry_id || null,
    reversedByEntryId: row.reversed_by_entry_id || null,
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
    fundId: row.fund_id || null,
  };
}

export async function createJournalEntry(
  prisma: PrismaClient,
  data: CreateJournalEntryData
): Promise<JournalEntryRecord> {
  const status = data.status || 'DRAFT';
  const entryDate = data.entryDate ? data.entryDate.toISOString().split('T')[0] : new Date().toISOString().split('T')[0];

  // 1. Insert Header
  const headerRows: any[] = await prisma.$queryRawUnsafe(
    `INSERT INTO journal_entries (entry_number, entry_date, description, status, reversal_of_entry_id)
     VALUES ($1, $2::date, $3, CAST($4 AS "JournalEntryStatus"), $5::uuid)
     RETURNING id, entry_number, entry_date, description, status, created_at, updated_at, reversal_of_entry_id, reversed_by_entry_id`,
    data.entryNumber,
    data.entryDate || new Date(),
    data.description || null,
    data.status || 'DRAFT',
    data.reversalOfEntryId || null
  );
  const entryHeader = headerRows[0];
  const insertedLines: JournalEntryLineRecord[] = [];

  // Insert lines
  for (const line of data.lines) {
    const lineRows: any[] = await prisma.$queryRawUnsafe(
      `INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description, fund_id)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid)
       RETURNING id, journal_entry_id, account_id, debit, credit, description, created_at, fund_id`,
      entryHeader.id,
      line.accountId,
      line.debit || 0.00,
      line.credit || 0.00,
      line.description || null,
      line.fundId || null
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
    `SELECT id, entry_number, entry_date, description, status, created_at, updated_at, reversal_of_entry_id, reversed_by_entry_id
     FROM journal_entries
     WHERE id = $1::uuid`,
    id
  );

  if (!headerRows || headerRows.length === 0) return null;

  const lineRows: any[] = await prisma.$queryRawUnsafe(
    `SELECT id, journal_entry_id, account_id, debit, credit, description, created_at, fund_id
     FROM journal_entry_lines
     WHERE journal_entry_id = $1::uuid
     ORDER BY created_at ASC`,
    id
  );

  const lines = lineRows.map(mapJournalEntryLineRow);
  return mapJournalEntryRow(headerRows[0], lines);
}

export interface ListJournalEntriesFilter {
  status?: JournalEntryStatus;
  startDate?: string;
  endDate?: string;
  search?: string;
}

export async function getJournalEntryByEntryNumber(
  prisma: PrismaClient,
  entryNumber: string
): Promise<JournalEntryRecord | null> {
  const headerRows: any[] = await prisma.$queryRawUnsafe(
    `SELECT id, entry_number, entry_date, description, status, created_at, updated_at, reversal_of_entry_id, reversed_by_entry_id
     FROM journal_entries
     WHERE entry_number = $1`,
    entryNumber.trim()
  );

  if (!headerRows || headerRows.length === 0) return null;

  const lineRows: any[] = await prisma.$queryRawUnsafe(
    `SELECT id, journal_entry_id, account_id, debit, credit, description, created_at, fund_id
     FROM journal_entry_lines
     WHERE journal_entry_id = $1::uuid
     ORDER BY created_at ASC`,
    headerRows[0].id
  );

  const lines = lineRows.map(mapJournalEntryLineRow);
  return mapJournalEntryRow(headerRows[0], lines);
}

export async function listJournalEntries(
  prisma: PrismaClient,
  filter?: ListJournalEntriesFilter
): Promise<JournalEntryRecord[]> {
  const conditions: string[] = [];
  const params: any[] = [];

  if (filter?.status) {
    params.push(filter.status);
    conditions.push(`je.status = $${params.length}`);
  }

  if (filter?.startDate) {
    params.push(filter.startDate);
    conditions.push(`je.entry_date >= $${params.length}::date`);
  }

  if (filter?.endDate) {
    params.push(filter.endDate);
    conditions.push(`je.entry_date <= $${params.length}::date`);
  }

  if (filter?.search) {
    params.push(`%${filter.search}%`);
    conditions.push(`(je.entry_number ILIKE $${params.length} OR je.description ILIKE $${params.length})`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Single query with LEFT JOIN to fetch all journal entries and their lines at once
  // This eliminates the N+1 query problem (was: 1 + N queries, now: 1 query)
  const query = `
    SELECT
      je.id, je.entry_number, je.entry_date, je.description, je.status,
      je.created_at, je.updated_at, je.reversal_of_entry_id, je.reversed_by_entry_id,
      jel.id as line_id, jel.journal_entry_id, jel.account_id,
      jel.debit, jel.credit, jel.description as line_description,
      jel.created_at as line_created_at, jel.fund_id as line_fund_id
    FROM journal_entries je
    LEFT JOIN journal_entry_lines jel ON je.id = jel.journal_entry_id
    ${whereClause}
    ORDER BY je.entry_date DESC, je.created_at DESC, jel.created_at ASC
  `;

  const rows: any[] = await prisma.$queryRawUnsafe(query, ...params);

  // Group rows by journal entry ID in memory (single pass, O(n))
  const entryMap = new Map<string, { header: any; lines: any[] }>();

  for (const row of rows) {
    if (!entryMap.has(row.id)) {
      entryMap.set(row.id, {
        header: {
          id: row.id,
          entry_number: row.entry_number,
          entry_date: row.entry_date,
          description: row.description,
          status: row.status,
          created_at: row.created_at,
          updated_at: row.updated_at,
          reversal_of_entry_id: row.reversal_of_entry_id,
          reversed_by_entry_id: row.reversed_by_entry_id,
        },
        lines: [],
      });
    }

    // Only add line if it exists (LEFT JOIN may return null for entries with no lines)
    if (row.line_id) {
      entryMap.get(row.id)!.lines.push({
        id: row.line_id,
        journal_entry_id: row.journal_entry_id,
        account_id: row.account_id,
        debit: row.debit,
        credit: row.credit,
        description: row.line_description,
        created_at: row.line_created_at,
        fund_id: row.line_fund_id,
      });
    }
  }

  // Convert map to array of JournalEntryRecord objects
  const results: JournalEntryRecord[] = [];
  for (const { header, lines } of entryMap.values()) {
    results.push(mapJournalEntryRow(header, lines.map(mapJournalEntryLineRow)));
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
     SET status = CAST($1 AS "JournalEntryStatus"), updated_at = CURRENT_TIMESTAMP
     WHERE id = $2::uuid
     RETURNING id, entry_number, entry_date, description, status, created_at, updated_at`,
    status,
    id
  );

  if (!rows || rows.length === 0) return null;
  return getJournalEntryById(prisma, id);
}

/**
 * Flips the original entry to VOID and records which reversal entry
 * offsets it, in one statement. Used only when voiding a POSTED entry -
 * a DRAFT void still goes through the plain updateJournalEntryStatus path.
 */
export async function setReversalLink(
  prisma: PrismaClient,
  originalEntryId: string,
  reversalEntryId: string
): Promise<JournalEntryRecord | null> {
  const rows: any[] = await prisma.$queryRawUnsafe(
    `UPDATE journal_entries
     SET status = CAST('VOID' AS "JournalEntryStatus"), reversed_by_entry_id = $1::uuid, updated_at = CURRENT_TIMESTAMP
     WHERE id = $2::uuid
     RETURNING id`,
    reversalEntryId,
    originalEntryId
  );

  if (!rows || rows.length === 0) return null;
  return getJournalEntryById(prisma, originalEntryId);
}

export async function deleteJournalEntry(prisma: PrismaClient, id: string): Promise<boolean> {
  const count = await prisma.$executeRawUnsafe(
    `DELETE FROM journal_entries WHERE id = $1::uuid`,
    id
  );
  return count > 0;
}
