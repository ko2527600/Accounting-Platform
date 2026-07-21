import { PrismaClient } from '@prisma/client';

export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';

export interface AccountRecord {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  parentId: string | null;
  currency: string;
  isActive: boolean;
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
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
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
  const rows: any[] = await prisma.$queryRawUnsafe(
    `INSERT INTO accounts (code, name, type, parent_id, currency, is_active)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, code, name, type, parent_id, currency, is_active, created_at, updated_at`,
    data.code.trim(),
    data.name.trim(),
    data.type,
    data.parentId || null,
    data.currency || 'USD',
    data.isActive !== undefined ? data.isActive : true
  );

  return mapAccountRow(rows[0]);
}

export async function getAccountById(
  prisma: PrismaClient,
  id: string
): Promise<AccountRecord | null> {
  if (!isValidUuid(id)) return null;

  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT id, code, name, type, parent_id, currency, is_active, created_at, updated_at
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
    `SELECT id, code, name, type, parent_id, currency, is_active, created_at, updated_at
     FROM accounts
     WHERE code = $1`,
    code.trim()
  );

  if (!rows || rows.length === 0) return null;
  return mapAccountRow(rows[0]);
}

export async function listAccounts(prisma: PrismaClient): Promise<AccountRecord[]> {
  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT id, code, name, type, parent_id, currency, is_active, created_at, updated_at
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

  const rows: any[] = await prisma.$queryRawUnsafe(
    `UPDATE accounts
     SET code = $1, name = $2, type = $3, parent_id = $4, currency = $5, is_active = $6, updated_at = CURRENT_TIMESTAMP
     WHERE id = $7::uuid
     RETURNING id, code, name, type, parent_id, currency, is_active, created_at, updated_at`,
    code,
    name,
    type,
    parentId,
    currency,
    isActive,
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

