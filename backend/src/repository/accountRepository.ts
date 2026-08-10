import { PrismaClient } from '@prisma/client';

export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE' | 'COST_OF_SALES';

export interface AccountRecord {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  parentId: string | null;
  currency: string;
  isActive: boolean;
  isCashEquivalent: boolean;
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
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

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
    `INSERT INTO accounts (code, name, type, parent_id, currency, is_active, is_cash_equivalent, client_txn_id)
     VALUES ($1, $2, $3, $4::uuid, $5, $6, $7, $8::uuid)
     RETURNING id, code, name, type, parent_id, currency, is_active, is_cash_equivalent, created_at, updated_at`,
    data.code.trim(),
    name,
    data.type,
    data.parentId || null,
    data.currency || 'USD',
    data.isActive !== undefined ? data.isActive : true,
    isCashEquivalent,
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
    `SELECT id, code, name, type, parent_id, currency, is_active, is_cash_equivalent, created_at, updated_at
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
    `SELECT id, code, name, type, parent_id, currency, is_active, is_cash_equivalent, created_at, updated_at
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
    `SELECT id, code, name, type, parent_id, currency, is_active, is_cash_equivalent, created_at, updated_at
     FROM accounts
     WHERE code = $1`,
    code.trim()
  );

  if (!rows || rows.length === 0) return null;
  return mapAccountRow(rows[0]);
}

export async function listAccounts(prisma: PrismaClient): Promise<AccountRecord[]> {
  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT id, code, name, type, parent_id, currency, is_active, is_cash_equivalent, created_at, updated_at
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

  const rows: any[] = await prisma.$queryRawUnsafe(
    `UPDATE accounts
     SET code = $1, name = $2, type = $3, parent_id = $4::uuid, currency = $5, is_active = $6, is_cash_equivalent = $7, updated_at = CURRENT_TIMESTAMP
     WHERE id = $8::uuid
     RETURNING id, code, name, type, parent_id, currency, is_active, is_cash_equivalent, created_at, updated_at`,
    code,
    name,
    type,
    parentId,
    currency,
    isActive,
    isCashEquivalent,
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

