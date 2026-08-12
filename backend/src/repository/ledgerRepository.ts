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
  fundId: string | null;
}

export interface CreateLedgerData {
  accountId: string;
  transactionDate?: Date;
  journalEntryId?: string | null;
  debit: number;
  credit: number;
  balance?: number;
  description?: string | null;
  fundId?: string | null;
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
    fundId: row.fund_id || null,
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
    `INSERT INTO ledgers (account_id, transaction_date, journal_entry_id, debit, credit, balance, description, fund_id)
     VALUES ($1::uuid, $2::date, $3::uuid, $4, $5, $6, $7, $8::uuid)
     RETURNING id, account_id, transaction_date, journal_entry_id, debit, credit, balance, description, created_at, fund_id`,
    data.accountId,
    transactionDate,
    data.journalEntryId || null,
    data.debit || 0.00,
    data.credit || 0.00,
    data.balance || 0.00,
    data.description || null,
    data.fundId || null
  );

  return mapLedgerRow(rows[0]);
}

export async function getLedgerByAccountId(
  prisma: PrismaClient,
  accountId: string
): Promise<LedgerRecord[]> {
  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT id, account_id, transaction_date, journal_entry_id, debit, credit, balance, description, created_at, fund_id
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

  if (!entry.lines || entry.lines.length === 0) {
    return [];
  }

  const createdLedgerEntries: LedgerRecord[] = [];

  // Uses FOR UPDATE row locks below to prevent race conditions

  // Extract unique account IDs from journal entry lines
  const accountIds = [...new Set(entry.lines.map(line => line.accountId))];

  // Batch fetch latest balances for all affected accounts in a single query
  // Uses DISTINCT ON to get the most recent ledger entry per account
  // Includes FOR UPDATE to lock rows and prevent race conditions
  // Postgres rejects FOR UPDATE combined with DISTINCT ON in the same query,
  // so the row lock is taken in the inner query and the latest-per-account
  // row is picked in the (lock-free) outer DISTINCT ON.
  const balanceQuery = `
    SELECT DISTINCT ON (account_id)
      account_id,
      balance
    FROM (
      SELECT account_id, balance, transaction_date, created_at
      FROM ledgers
      WHERE account_id = ANY($1::uuid[])
      FOR UPDATE
    ) locked_rows
    ORDER BY account_id, transaction_date DESC, created_at DESC
  `;

  const balanceRows: any[] = await prisma.$queryRawUnsafe(balanceQuery, accountIds);

  // Build a map of account_id -> current balance for O(1) lookups
  const balanceMap = new Map<string, number>();
  for (const row of balanceRows) {
    balanceMap.set(row.account_id, parseFloat(row.balance));
  }

  // Track running balances for accounts that appear multiple times in the same journal entry
  const runningBalances = new Map<string, number>();
  for (const accountId of accountIds) {
    runningBalances.set(accountId, balanceMap.get(accountId) || 0.00);
  }

  // Process each line and create ledger entries
  for (const line of entry.lines) {
    const prevBalance = runningBalances.get(line.accountId) || 0.00;
    const newBalance = prevBalance + line.debit - line.credit;
    
    // Update running balance for this account
    runningBalances.set(line.accountId, newBalance);

    const ledger = await createLedgerEntry(prisma, {
      accountId: line.accountId,
      transactionDate: entry.entryDate,
      journalEntryId: entry.id,
      debit: line.debit,
      credit: line.credit,
      balance: newBalance,
      description: line.description || entry.description,
      fundId: line.fundId,
    });

    createdLedgerEntries.push(ledger);
  }

  return createdLedgerEntries;
}

export async function getLedgerById(
  prisma: PrismaClient,
  id: string
): Promise<LedgerRecord | null> {
  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT id, account_id, transaction_date, journal_entry_id, debit, credit, balance, description, created_at, fund_id
     FROM ledgers
     WHERE id = $1::uuid`,
    id
  );

  return rows.length > 0 ? mapLedgerRow(rows[0]) : null;
}

export interface CashLedgerMatchCandidate extends LedgerRecord {
  accountCode: string;
  accountName: string;
}

/**
 * Finds Ledger rows on cash/bank-equivalent accounts (`accounts.is_cash_equivalent`)
 * whose net movement (debit - credit) exactly equals `amount` - the same
 * sign convention monoService.ts uses for bank transactions (positive =
 * deposit/debit-normal increase, negative = withdrawal) - within `dayWindow`
 * days of `targetDate` either side (bank posting dates commonly lag or lead
 * the book date by a few days), excluding any ledger row already linked to
 * a bank transaction. Ranked by date proximity to `targetDate` first (exact
 * same-day matches surface before a few-days-off one), then oldest first as
 * a stable tiebreaker.
 */
export async function findCashLedgerMatchCandidates(
  prisma: PrismaClient,
  params: { amount: number; targetDate: Date; dayWindow: number; excludeLedgerIds: string[]; limit?: number }
): Promise<CashLedgerMatchCandidate[]> {
  const targetDateStr = params.targetDate.toISOString().split('T')[0];
  const limit = params.limit ?? 10;

  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT l.id, l.account_id, l.transaction_date, l.journal_entry_id, l.debit, l.credit, l.balance, l.description, l.created_at, l.fund_id,
            a.code as account_code, a.name as account_name
     FROM ledgers l
     JOIN accounts a ON l.account_id = a.id
     WHERE a.is_cash_equivalent = true
       AND (l.debit - l.credit) = $1
       AND l.transaction_date BETWEEN ($2::date - ($3 || ' days')::interval) AND ($2::date + ($3 || ' days')::interval)
       AND NOT (l.id = ANY($4::uuid[]))
     ORDER BY ABS(l.transaction_date - $2::date) ASC, l.created_at ASC
     LIMIT $5`,
    params.amount,
    targetDateStr,
    params.dayWindow,
    params.excludeLedgerIds,
    limit
  );

  return rows.map((row) => ({
    ...mapLedgerRow(row),
    accountCode: row.account_code,
    accountName: row.account_name,
  }));
}

export interface LedgerTransactionRecord {
  id: string;
  accountId: string;
  accountCode?: string;
  accountName?: string;
  accountType?: string;
  transactionDate: Date;
  journalEntryId: string | null;
  entryNumber?: string | null;
  debit: number;
  credit: number;
  balance: number;
  runningBalance?: number;
  description: string | null;
  createdAt: Date;
  fundId: string | null;
}

export interface ListLedgerFilter {
  accountId?: string;
  fundId?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface ListLedgerResult {
  transactions: LedgerTransactionRecord[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface AccountLedgerStatement {
  account: {
    id: string;
    code: string;
    name: string;
    type: string;
    currency: string;
  };
  statement: {
    startDate: string | null;
    endDate: string | null;
    openingBalance: number;
    totalDebit: number;
    totalCredit: number;
    netChange: number;
    closingBalance: number;
    transactions: LedgerTransactionRecord[];
  };
}

export interface LedgerSummaryAccount {
  id: string;
  code: string;
  name: string;
  type: string;
  currency: string;
  openingBalance: number;
  totalDebit: number;
  totalCredit: number;
  netChange: number;
  closingBalance: number;
}

export interface LedgerSummaryResult {
  startDate: string | null;
  endDate: string | null;
  accounts: LedgerSummaryAccount[];
  totals: {
    totalDebit: number;
    totalCredit: number;
  };
}

function isValidUuid(id: string): boolean {
  const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  return uuidRegex.test(id);
}

export async function listLedgerTransactions(
  prisma: PrismaClient,
  filter: ListLedgerFilter = {}
): Promise<ListLedgerResult> {
  const page = Math.max(1, Number(filter.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(filter.limit) || 20));
  const offset = (page - 1) * limit;

  const conditions: string[] = [];
  const params: any[] = [];
  let paramIndex = 1;

  if (filter.accountId && isValidUuid(filter.accountId)) {
    conditions.push(`l.account_id = $${paramIndex++}::uuid`);
    params.push(filter.accountId);
  }

  if (filter.fundId && isValidUuid(filter.fundId)) {
    conditions.push(`l.fund_id = $${paramIndex++}::uuid`);
    params.push(filter.fundId);
  }

  if (filter.startDate) {
    conditions.push(`l.transaction_date >= $${paramIndex++}::date`);
    params.push(filter.startDate);
  }

  if (filter.endDate) {
    conditions.push(`l.transaction_date <= $${paramIndex++}::date`);
    params.push(filter.endDate);
  }

  if (filter.search && filter.search.trim()) {
    const searchPattern = `%${filter.search.trim()}%`;
    conditions.push(
      `(l.description ILIKE $${paramIndex} OR je.entry_number ILIKE $${paramIndex} OR a.code ILIKE $${paramIndex} OR a.name ILIKE $${paramIndex})`
    );
    params.push(searchPattern);
    paramIndex++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countSql = `
    SELECT COUNT(*)::int as total
    FROM ledgers l
    JOIN accounts a ON l.account_id = a.id
    LEFT JOIN journal_entries je ON l.journal_entry_id = je.id
    ${whereClause}
  `;

  const countRows: any[] = await prisma.$queryRawUnsafe(countSql, ...params);
  const total = countRows[0]?.total ? Number(countRows[0].total) : 0;
  const totalPages = Math.ceil(total / limit) || 1;

  const dataSql = `
    SELECT l.id, l.account_id, l.transaction_date, l.journal_entry_id, l.debit, l.credit, l.balance, l.description, l.created_at, l.fund_id,
           a.code as account_code, a.name as account_name, a.type as account_type,
           je.entry_number
    FROM ledgers l
    JOIN accounts a ON l.account_id = a.id
    LEFT JOIN journal_entries je ON l.journal_entry_id = je.id
    ${whereClause}
    ORDER BY l.transaction_date DESC, l.created_at DESC, l.id DESC
    LIMIT $${paramIndex++} OFFSET $${paramIndex++}
  `;

  const dataRows: any[] = await prisma.$queryRawUnsafe(dataSql, ...params, limit, offset);

  const transactions: LedgerTransactionRecord[] = dataRows.map((row) => ({
    id: row.id,
    accountId: row.account_id,
    accountCode: row.account_code,
    accountName: row.account_name,
    accountType: row.account_type,
    transactionDate: new Date(row.transaction_date),
    journalEntryId: row.journal_entry_id || null,
    entryNumber: row.entry_number || null,
    debit: parseFloat(row.debit),
    credit: parseFloat(row.credit),
    balance: parseFloat(row.balance),
    description: row.description || null,
    createdAt: new Date(row.created_at),
    fundId: row.fund_id || null,
  }));

  return {
    transactions,
    pagination: {
      total,
      page,
      limit,
      totalPages,
    },
  };
}

export async function getAccountLedgerStatement(
  prisma: PrismaClient,
  account: { id: string; code: string; name: string; type: string; currency: string },
  startDate?: string,
  endDate?: string
): Promise<AccountLedgerStatement> {
  let openingBalance = 0.0;
  if (startDate) {
    const obRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT COALESCE(SUM(debit), 0) as total_debit, COALESCE(SUM(credit), 0) as total_credit
       FROM ledgers
       WHERE account_id = $1::uuid AND transaction_date < $2::date`,
      account.id,
      startDate
    );

    if (obRows.length > 0) {
      const priorDebit = parseFloat(obRows[0].total_debit);
      const priorCredit = parseFloat(obRows[0].total_credit);
      openingBalance = priorDebit - priorCredit;
    }
  }

  const conditions: string[] = [`l.account_id = $1::uuid`];
  const params: any[] = [account.id];
  let paramIndex = 2;

  if (startDate) {
    conditions.push(`l.transaction_date >= $${paramIndex++}::date`);
    params.push(startDate);
  }

  if (endDate) {
    conditions.push(`l.transaction_date <= $${paramIndex++}::date`);
    params.push(endDate);
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;

  const sql = `
    SELECT l.id, l.account_id, l.transaction_date, l.journal_entry_id, l.debit, l.credit, l.balance, l.description, l.created_at, l.fund_id,
           je.entry_number
    FROM ledgers l
    LEFT JOIN journal_entries je ON l.journal_entry_id = je.id
    ${whereClause}
    ORDER BY l.transaction_date ASC, l.created_at ASC, l.id ASC
  `;

  const rows: any[] = await prisma.$queryRawUnsafe(sql, ...params);

  let runningBalance = openingBalance;
  let totalDebit = 0.0;
  let totalCredit = 0.0;

  const transactions: LedgerTransactionRecord[] = rows.map((row) => {
    const debit = parseFloat(row.debit);
    const credit = parseFloat(row.credit);

    totalDebit += debit;
    totalCredit += credit;
    runningBalance = Math.round((runningBalance + debit - credit) * 100) / 100;

    return {
      id: row.id,
      accountId: row.account_id,
      accountCode: account.code,
      accountName: account.name,
      accountType: account.type,
      transactionDate: new Date(row.transaction_date),
      journalEntryId: row.journal_entry_id || null,
      entryNumber: row.entry_number || null,
      debit,
      credit,
      balance: parseFloat(row.balance),
      runningBalance,
      description: row.description || null,
      createdAt: new Date(row.created_at),
      fundId: row.fund_id || null,
    };
  });

  const roundedOpening = Math.round(openingBalance * 100) / 100;
  const roundedTotalDebit = Math.round(totalDebit * 100) / 100;
  const roundedTotalCredit = Math.round(totalCredit * 100) / 100;
  const netChange = Math.round((roundedTotalDebit - roundedTotalCredit) * 100) / 100;
  const closingBalance = Math.round((roundedOpening + netChange) * 100) / 100;

  return {
    account: {
      id: account.id,
      code: account.code,
      name: account.name,
      type: account.type,
      currency: account.currency,
    },
    statement: {
      startDate: startDate || null,
      endDate: endDate || null,
      openingBalance: roundedOpening,
      totalDebit: roundedTotalDebit,
      totalCredit: roundedTotalCredit,
      netChange,
      closingBalance,
      transactions,
    },
  };
}

export async function getGeneralLedgerSummary(
  prisma: PrismaClient,
  startDate?: string,
  endDate?: string
): Promise<LedgerSummaryResult> {
  let rows: any[] = [];

  if (startDate && endDate) {
    rows = await prisma.$queryRawUnsafe(
      `SELECT
         a.id as account_id,
         a.code as account_code,
         a.name as account_name,
         a.type as account_type,
         a.currency as account_currency,
         COALESCE(SUM(CASE WHEN l.transaction_date < $1::date THEN l.debit - l.credit ELSE 0 END), 0) as opening_balance,
         COALESCE(SUM(CASE WHEN l.transaction_date >= $1::date AND l.transaction_date <= $2::date THEN l.debit ELSE 0 END), 0) as total_debit,
         COALESCE(SUM(CASE WHEN l.transaction_date >= $1::date AND l.transaction_date <= $2::date THEN l.credit ELSE 0 END), 0) as total_credit
       FROM accounts a
       LEFT JOIN ledgers l ON a.id = l.account_id
       GROUP BY a.id, a.code, a.name, a.type, a.currency
       ORDER BY a.code ASC`,
      startDate,
      endDate
    );
  } else if (startDate) {
    rows = await prisma.$queryRawUnsafe(
      `SELECT
         a.id as account_id,
         a.code as account_code,
         a.name as account_name,
         a.type as account_type,
         a.currency as account_currency,
         COALESCE(SUM(CASE WHEN l.transaction_date < $1::date THEN l.debit - l.credit ELSE 0 END), 0) as opening_balance,
         COALESCE(SUM(CASE WHEN l.transaction_date >= $1::date THEN l.debit ELSE 0 END), 0) as total_debit,
         COALESCE(SUM(CASE WHEN l.transaction_date >= $1::date THEN l.credit ELSE 0 END), 0) as total_credit
       FROM accounts a
       LEFT JOIN ledgers l ON a.id = l.account_id
       GROUP BY a.id, a.code, a.name, a.type, a.currency
       ORDER BY a.code ASC`,
      startDate
    );
  } else if (endDate) {
    rows = await prisma.$queryRawUnsafe(
      `SELECT
         a.id as account_id,
         a.code as account_code,
         a.name as account_name,
         a.type as account_type,
         a.currency as account_currency,
         0 as opening_balance,
         COALESCE(SUM(CASE WHEN l.transaction_date <= $1::date THEN l.debit ELSE 0 END), 0) as total_debit,
         COALESCE(SUM(CASE WHEN l.transaction_date <= $1::date THEN l.credit ELSE 0 END), 0) as total_credit
       FROM accounts a
       LEFT JOIN ledgers l ON a.id = l.account_id
       GROUP BY a.id, a.code, a.name, a.type, a.currency
       ORDER BY a.code ASC`,
      endDate
    );
  } else {
    rows = await prisma.$queryRawUnsafe(
      `SELECT
         a.id as account_id,
         a.code as account_code,
         a.name as account_name,
         a.type as account_type,
         a.currency as account_currency,
         0 as opening_balance,
         COALESCE(SUM(l.debit), 0) as total_debit,
         COALESCE(SUM(l.credit), 0) as total_credit
       FROM accounts a
       LEFT JOIN ledgers l ON a.id = l.account_id
       GROUP BY a.id, a.code, a.name, a.type, a.currency
       ORDER BY a.code ASC`
    );
  }

  let grandTotalDebit = 0.0;
  let grandTotalCredit = 0.0;

  const accounts: LedgerSummaryAccount[] = rows.map((r) => {
    const ob = Math.round(parseFloat(r.opening_balance) * 100) / 100;
    const td = Math.round(parseFloat(r.total_debit) * 100) / 100;
    const tc = Math.round(parseFloat(r.total_credit) * 100) / 100;
    const net = Math.round((td - tc) * 100) / 100;
    const cb = Math.round((ob + net) * 100) / 100;

    grandTotalDebit += td;
    grandTotalCredit += tc;

    return {
      id: r.account_id,
      code: r.account_code,
      name: r.account_name,
      type: r.account_type,
      currency: r.account_currency,
      openingBalance: ob,
      totalDebit: td,
      totalCredit: tc,
      netChange: net,
      closingBalance: cb,
    };
  });

  return {
    startDate: startDate || null,
    endDate: endDate || null,
    accounts,
    totals: {
      totalDebit: Math.round(grandTotalDebit * 100) / 100,
      totalCredit: Math.round(grandTotalCredit * 100) / 100,
    },
  };
}

