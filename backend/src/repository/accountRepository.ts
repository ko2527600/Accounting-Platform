import { PrismaClient } from '@prisma/client';

export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE' | 'COST_OF_SALES';

// The single account each auto-posting service should target for the
// generic cash/revenue/expense side of a transaction - see migration
// 009_add_account_default_role. At most one account per role per tenant.
// DEPRECIATION_EXPENSE/ACCUMULATED_DEPRECIATION added by migration
// 010_add_fixed_asset_support for fixedAssetService.ts's monthly postings.
export type AccountDefaultRole = 'CASH' | 'REVENUE' | 'EXPENSE' | 'DEPRECIATION_EXPENSE' | 'ACCUMULATED_DEPRECIATION' | 'COGS' | 'INVENTORY_ASSET' | 'SALARY_EXPENSE' | 'EMPLOYER_SSNIT_EXPENSE' | 'PAYE_PAYABLE' | 'SSNIT_PAYABLE' | 'NET_PAY_PAYABLE';

export interface AccountRecord {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  parentId: string | null;
  currency: string;
  isActive: boolean;
  isCashEquivalent: boolean;
  // Which ASSET accounts represent long-lived fixed assets (Vehicles,
  // Equipment, etc.) rather than ordinary working-capital assets - see
  // migration 010. Unlike defaultRole, multiple accounts can hold this flag.
  isFixedAsset: boolean;
  defaultRole: AccountDefaultRole | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAccountData {
  code: string;
  name: string;
  type: AccountType;
  parentId?: string | null;
  currency?: string;
  isActive?: boolean;
  isCashEquivalent?: boolean;
  isFixedAsset?: boolean;
  // Client-generated dedup key for offline-queued/retried account creation
  // (local-first sync pilot) - see createAccount's P2002-equivalent handling.
  clientTxnId?: string | null;
}

function mapAccountRow(row: any): AccountRecord {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    type: row.type as AccountType,
    parentId: row.parent_id || null,
    currency: row.currency || 'USD',
    isActive: Boolean(row.is_active),
    isCashEquivalent: Boolean(row.is_cash_equivalent),
    isFixedAsset: Boolean(row.is_fixed_asset),
    defaultRole: (row.default_role as AccountDefaultRole) || null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

const ACCOUNT_COLUMNS = 'id, code, name, type, parent_id, currency, is_active, is_cash_equivalent, is_fixed_asset, default_role, created_at, updated_at';

/**
 * Default for isCashEquivalent when not explicitly supplied: ASSET accounts
 * whose name reads like a cash/bank/till account. Mirrors the same naming
 * convention the '004_add_cash_equivalent_flag' tenant migration backfills
 * existing accounts with, so newly-created accounts behave consistently
 * with older ones for Cash Flow Statement purposes.
 */
export function defaultIsCashEquivalent(type: AccountType, name: string): boolean {
  return type === 'ASSET' && /cash|bank|till/i.test(name);
}

/**
 * Resolves which account an auto-posting service (invoice payments,
 * credit/debit notes, vendor bill payments, expense reimbursements) should
 * target for the generic cash/revenue/expense side of a transaction.
 *
 * Three tiers, in order:
 *  1. Whichever account the tenant has explicitly designated for this role
 *     (Account.defaultRole - see migration 009 and accountService.setDefaultRole).
 *  2. An account whose code happens to match the historical convention
 *     (1010/4010/5010) - kept for tenants who set their chart up that way
 *     before this designation feature existed.
 *  3. The first account of a plausible TYPE for this role, so a chart that
 *     matches neither of the above still posts to an account of the RIGHT
 *     KIND (e.g. some Revenue account) rather than silently landing on
 *     whatever happened to be next in a code-sorted list - which is exactly
 *     the bug this function replaces (a payment's "revenue" leg could
 *     previously resolve to an ASSET account with no revenue account
 *     anywhere in the chart using code 4010).
 *
 * Returns undefined only if the chart has no account of a plausible type at
 * all for this role - callers already handle "no accounts configured" as an
 * error case.
 */
// Partial: DEPRECIATION_EXPENSE/ACCUMULATED_DEPRECIATION are new roles with
// no pre-existing account-code convention to fall back to - a tenant must
// explicitly designate both, same "clear error over silent wrong guess"
// philosophy the whole defaultRole mechanism was built on.
const LEGACY_ROLE_CODES: Partial<Record<AccountDefaultRole, string>> = { CASH: '1010', REVENUE: '4010', EXPENSE: '5010' };
const PLAUSIBLE_TYPES_FOR_ROLE: Record<AccountDefaultRole, AccountType[]> = {
  CASH: ['ASSET'],
  REVENUE: ['REVENUE'],
  EXPENSE: ['EXPENSE', 'COST_OF_SALES'],
  DEPRECIATION_EXPENSE: ['EXPENSE'],
  ACCUMULATED_DEPRECIATION: ['ASSET'],
  COGS: ['COST_OF_SALES', 'EXPENSE'],
  INVENTORY_ASSET: ['ASSET'],
  SALARY_EXPENSE: ['EXPENSE'],
  EMPLOYER_SSNIT_EXPENSE: ['EXPENSE'],
  PAYE_PAYABLE: ['LIABILITY'],
  SSNIT_PAYABLE: ['LIABILITY'],
  NET_PAY_PAYABLE: ['LIABILITY'],
};

export function resolveDefaultAccount(
  accounts: AccountRecord[],
  role: AccountDefaultRole
): AccountRecord | undefined {
  const legacyCode = LEGACY_ROLE_CODES[role];
  return (
    accounts.find((a) => a.defaultRole === role) ||
    (legacyCode ? accounts.find((a) => a.code === legacyCode) : undefined) ||
    accounts.find((a) => PLAUSIBLE_TYPES_FOR_ROLE[role].includes(a.type))
  );
}

/**
 * Picks a sensible one-time default-role candidate from a freshly-seeded
 * chart of accounts (see onboardingWizardService.seedChartOfAccounts) -
 * lowest-code cash-equivalent ASSET for CASH, lowest-code REVENUE account,
 * and for EXPENSE a "Miscellaneous"-named account if one exists (a genuine
 * catch-all is a better default target than an arbitrary specific category
 * like "Rent Expense"), else the lowest-code EXPENSE/COST_OF_SALES account.
 * Mirrors migration 009's SQL backfill logic in JS, for the accounts a
 * brand-new tenant creates through the wizard rather than ones that already
 * existed when that migration ran.
 */
export function pickAutoDefaultCandidate(
  accounts: AccountRecord[],
  role: AccountDefaultRole
): AccountRecord | undefined {
  const byCodeAsc = (a: AccountRecord, b: AccountRecord) => a.code.localeCompare(b.code);

  if (role === 'CASH') {
    return accounts.filter((a) => a.type === 'ASSET' && a.isCashEquivalent).sort(byCodeAsc)[0];
  }
  if (role === 'REVENUE') {
    return accounts.filter((a) => a.type === 'REVENUE').sort(byCodeAsc)[0];
  }
  if (role === 'COGS') {
    const cogsAccounts = accounts.filter((a) => a.type === 'COST_OF_SALES');
    return cogsAccounts.sort(byCodeAsc)[0];
  }
  if (role === 'INVENTORY_ASSET') {
    const inv = accounts.filter((a) => a.type === 'ASSET' && !a.isCashEquivalent && !a.isFixedAsset);
    return inv.find((a) => /inventor|stock|goods/i.test(a.name)) || inv.sort(byCodeAsc)[0];
  }
  if (role === 'SALARY_EXPENSE') {
    const salaryAccounts = accounts.filter((a) => a.type === 'EXPENSE');
    return salaryAccounts.find((a) => /salar|wage|payroll/i.test(a.name)) || salaryAccounts.sort(byCodeAsc)[0];
  }
  if (role === 'EMPLOYER_SSNIT_EXPENSE') {
    const expAccounts = accounts.filter((a) => a.type === 'EXPENSE');
    return expAccounts.find((a) => /ssnit|social|pension/i.test(a.name)) || expAccounts.sort(byCodeAsc)[0];
  }
  if (role === 'PAYE_PAYABLE') {
    const liabilities = accounts.filter((a) => a.type === 'LIABILITY');
    return liabilities.find((a) => /paye|income tax|tax payable/i.test(a.name)) || liabilities.sort(byCodeAsc)[0];
  }
  if (role === 'SSNIT_PAYABLE') {
    const liabilities = accounts.filter((a) => a.type === 'LIABILITY');
    return liabilities.find((a) => /ssnit|social|pension/i.test(a.name)) || liabilities.sort(byCodeAsc)[0];
  }
  if (role === 'NET_PAY_PAYABLE') {
    const liabilities = accounts.filter((a) => a.type === 'LIABILITY');
    return liabilities.find((a) => /net pay|salaries payable|wages payable/i.test(a.name)) || liabilities.sort(byCodeAsc)[0];
  }
  const expenseAccounts = accounts.filter((a) => a.type === 'EXPENSE' || a.type === 'COST_OF_SALES');
  return expenseAccounts.find((a) => /miscellaneous/i.test(a.name)) || expenseAccounts.sort(byCodeAsc)[0];
}

export async function getChildAccountsCount(prisma: PrismaClient, parentId: string): Promise<number> {
  if (!parentId || !isValidUuid(parentId)) return 0;
  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int as count FROM accounts WHERE parent_id = $1::uuid`,
    parentId
  );
  return rows[0]?.count ? Number(rows[0].count) : 0;
}

export function isValidUuid(id: string): boolean {
  const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  return uuidRegex.test(id);
}

export async function createAccount(
  prisma: PrismaClient,
  data: CreateAccountData
): Promise<AccountRecord> {
  const name = data.name.trim();
  const isCashEquivalent =
    data.isCashEquivalent !== undefined ? data.isCashEquivalent : defaultIsCashEquivalent(data.type, name);

  const rows: any[] = await prisma.$queryRawUnsafe(
    `INSERT INTO accounts (code, name, type, parent_id, currency, is_active, is_cash_equivalent, is_fixed_asset, client_txn_id)
     VALUES ($1, $2, $3, $4::uuid, $5, $6, $7, $8, $9::uuid)
     RETURNING ${ACCOUNT_COLUMNS}`,
    data.code.trim(),
    name,
    data.type,
    data.parentId || null,
    data.currency || 'USD',
    data.isActive !== undefined ? data.isActive : true,
    isCashEquivalent,
    data.isFixedAsset !== undefined ? data.isFixedAsset : false,
    data.clientTxnId || null
  );

  return mapAccountRow(rows[0]);
}

/** Idempotency fast path: an account already created from this exact client-generated key, if any. */
export async function getAccountByClientTxnId(
  prisma: PrismaClient,
  clientTxnId: string
): Promise<AccountRecord | null> {
  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT ${ACCOUNT_COLUMNS}
     FROM accounts
     WHERE client_txn_id = $1::uuid`,
    clientTxnId
  );

  if (!rows || rows.length === 0) return null;
  return mapAccountRow(rows[0]);
}

export async function getAccountById(
  prisma: PrismaClient,
  id: string
): Promise<AccountRecord | null> {
  if (!isValidUuid(id)) return null;

  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT ${ACCOUNT_COLUMNS}
     FROM accounts
     WHERE id = $1::uuid`,
    id
  );

  if (!rows || rows.length === 0) return null;
  return mapAccountRow(rows[0]);
}

export async function getAccountByCode(
  prisma: PrismaClient,
  code: string
): Promise<AccountRecord | null> {
  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT ${ACCOUNT_COLUMNS}
     FROM accounts
     WHERE code = $1`,
    code.trim()
  );

  if (!rows || rows.length === 0) return null;
  return mapAccountRow(rows[0]);
}

export async function listAccounts(prisma: PrismaClient): Promise<AccountRecord[]> {
  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT ${ACCOUNT_COLUMNS}
     FROM accounts
     ORDER BY code ASC`
  );

  return rows.map(mapAccountRow);
}

export async function updateAccount(
  prisma: PrismaClient,
  id: string,
  data: Partial<CreateAccountData>
): Promise<AccountRecord | null> {
  if (!isValidUuid(id)) return null;

  const existing = await getAccountById(prisma, id);
  if (!existing) return null;

  const code = data.code !== undefined ? data.code.trim() : existing.code;
  const name = data.name !== undefined ? data.name.trim() : existing.name;
  const type = data.type !== undefined ? data.type : existing.type;
  const parentId = data.parentId !== undefined ? data.parentId : existing.parentId;
  const currency = data.currency !== undefined ? data.currency : existing.currency;
  const isActive = data.isActive !== undefined ? data.isActive : existing.isActive;
  const isCashEquivalent = data.isCashEquivalent !== undefined ? data.isCashEquivalent : existing.isCashEquivalent;
  const isFixedAsset = data.isFixedAsset !== undefined ? data.isFixedAsset : existing.isFixedAsset;

  const rows: any[] = await prisma.$queryRawUnsafe(
    `UPDATE accounts
     SET code = $1, name = $2, type = $3, parent_id = $4::uuid, currency = $5, is_active = $6, is_cash_equivalent = $7, is_fixed_asset = $8, updated_at = CURRENT_TIMESTAMP
     WHERE id = $9::uuid
     RETURNING ${ACCOUNT_COLUMNS}`,
    code,
    name,
    type,
    parentId,
    currency,
    isActive,
    isCashEquivalent,
    isFixedAsset,
    id
  );

  if (!rows || rows.length === 0) return null;
  return mapAccountRow(rows[0]);
}

export async function deleteAccount(prisma: PrismaClient, id: string): Promise<boolean> {
  if (!isValidUuid(id)) return false;

  const count = await prisma.$executeRawUnsafe(
    `DELETE FROM accounts WHERE id = $1::uuid`,
    id
  );
  return count > 0;
}

/**
 * Atomically reassigns a default role to `accountId` (clearing whoever
 * currently holds it first, since at most one account can hold a role at a
 * time - see the partial unique index in migration 009). Passing
 * `role: null` just clears `accountId`'s own role without assigning it
 * anywhere else. Caller is responsible for wrapping this in the same
 * transaction as any audit-log/sync-log write, same convention as
 * updateAccount.
 */
export async function setAccountDefaultRole(
  prisma: PrismaClient,
  accountId: string,
  role: AccountDefaultRole | null
): Promise<AccountRecord | null> {
  if (!isValidUuid(accountId)) return null;

  if (role !== null) {
    await prisma.$executeRawUnsafe(
      `UPDATE accounts SET default_role = NULL, updated_at = CURRENT_TIMESTAMP WHERE default_role = $1 AND id != $2::uuid`,
      role,
      accountId
    );
  }

  const rows: any[] = await prisma.$queryRawUnsafe(
    `UPDATE accounts SET default_role = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2::uuid RETURNING ${ACCOUNT_COLUMNS}`,
    role,
    accountId
  );

  if (!rows || rows.length === 0) return null;
  return mapAccountRow(rows[0]);
}

