import { prisma } from '../config/db';
import { withCurrentTenantDb } from '../database/tenantClient';
import * as accountRepository from '../repository/accountRepository';
import { AccountRecord, AccountType, CreateAccountData } from '../repository/accountRepository';

export class AccountServiceError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number = 400) {
    super(message);
    this.name = 'AccountServiceError';
    this.statusCode = statusCode;
  }
}

export interface AccountTreeNode extends AccountRecord {
  children: AccountTreeNode[];
}

export interface ListAccountsResult {
  accounts: AccountRecord[];
  tree: AccountTreeNode[];
}

const VALID_ACCOUNT_TYPES: AccountType[] = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'];

export function buildAccountTree(accounts: AccountRecord[]): AccountTreeNode[] {
  const map = new Map<string, AccountTreeNode>();
  const tree: AccountTreeNode[] = [];

  accounts.forEach((acc) => {
    map.set(acc.id, { ...acc, children: [] });
  });

  accounts.forEach((acc) => {
    const node = map.get(acc.id)!;
    if (acc.parentId && map.has(acc.parentId)) {
      map.get(acc.parentId)!.children.push(node);
    } else {
      tree.push(node);
    }
  });

  return tree;
}

export async function createAccount(data: CreateAccountData): Promise<AccountRecord> {
  if (!data.code || typeof data.code !== 'string' || !data.code.trim()) {
    throw new AccountServiceError('Account code is required and cannot be empty.', 400);
  }

  if (!data.name || typeof data.name !== 'string' || !data.name.trim()) {
    throw new AccountServiceError('Account name is required and cannot be empty.', 400);
  }

  if (!data.type || !VALID_ACCOUNT_TYPES.includes(data.type.toUpperCase() as AccountType)) {
    throw new AccountServiceError(
      `Invalid account type "${data.type}". Allowed types: ${VALID_ACCOUNT_TYPES.join(', ')}`,
      400
    );
  }

  const normalizedType = data.type.toUpperCase() as AccountType;

  return withCurrentTenantDb(prisma, async (client) => {
    // 1. Check duplicate code
    const existingCode = await accountRepository.getAccountByCode(client, data.code);
    if (existingCode) {
      throw new AccountServiceError(`Account code "${data.code.trim()}" already exists.`, 409);
    }

    // 2. Check parentId existence if specified
    if (data.parentId) {
      const parentAcc = await accountRepository.getAccountById(client, data.parentId);
      if (!parentAcc) {
        throw new AccountServiceError(`Parent account with ID "${data.parentId}" not found.`, 400);
      }
    }

    return accountRepository.createAccount(client, {
      ...data,
      type: normalizedType,
    });
  });
}

export async function getAccountById(id: string): Promise<AccountRecord | null> {
  if (!id || typeof id !== 'string') {
    return null;
  }

  return withCurrentTenantDb(prisma, async (client) => {
    return accountRepository.getAccountById(client, id);
  });
}

export async function listAccounts(): Promise<ListAccountsResult> {
  return withCurrentTenantDb(prisma, async (client) => {
    const accounts = await accountRepository.listAccounts(client);
    const tree = buildAccountTree(accounts);
    return { accounts, tree };
  });
}

export async function updateAccount(
  id: string,
  data: Partial<CreateAccountData>
): Promise<AccountRecord> {
  if (!id || typeof id !== 'string') {
    throw new AccountServiceError('Account ID is required.', 400);
  }

  return withCurrentTenantDb(prisma, async (client) => {
    // 1. Check existing account
    const existing = await accountRepository.getAccountById(client, id);
    if (!existing) {
      throw new AccountServiceError(`Account with ID "${id}" not found.`, 404);
    }

    // 2. Validate code uniqueness if code is updated
    if (data.code !== undefined && data.code.trim() !== existing.code) {
      const newCode = data.code.trim();
      if (!newCode) {
        throw new AccountServiceError('Account code cannot be empty.', 400);
      }
      const existingCodeAcc = await accountRepository.getAccountByCode(client, newCode);
      if (existingCodeAcc && existingCodeAcc.id !== id) {
        throw new AccountServiceError(`Account code "${newCode}" already exists.`, 409);
      }
    }

    // 3. Validate account type if type is updated
    let normalizedType: AccountType | undefined;
    if (data.type !== undefined) {
      normalizedType = data.type.toUpperCase() as AccountType;
      if (!VALID_ACCOUNT_TYPES.includes(normalizedType)) {
        throw new AccountServiceError(
          `Invalid account type "${data.type}". Allowed types: ${VALID_ACCOUNT_TYPES.join(', ')}`,
          400
        );
      }
    }

    // 4. Validate parentId if parentId is updated
    if (data.parentId !== undefined && data.parentId !== null) {
      if (data.parentId === id) {
        throw new AccountServiceError('An account cannot be set as its own parent.', 400);
      }

      const parentAcc = await accountRepository.getAccountById(client, data.parentId);
      if (!parentAcc) {
        throw new AccountServiceError(`Parent account with ID "${data.parentId}" not found.`, 400);
      }

      // Detect circular reference: trace ancestors up from parentId
      let currentParentId: string | null = parentAcc.parentId;
      const visited = new Set<string>([id, parentAcc.id]);

      while (currentParentId) {
        if (currentParentId === id) {
          throw new AccountServiceError('Circular parent account reference detected.', 400);
        }
        if (visited.has(currentParentId)) {
          break;
        }
        visited.add(currentParentId);

        const currParent = await accountRepository.getAccountById(client, currentParentId);
        currentParentId = currParent ? currParent.parentId : null;
      }
    }

    const updated = await accountRepository.updateAccount(client, id, {
      ...data,
      ...(normalizedType ? { type: normalizedType } : {}),
    });

    if (!updated) {
      throw new AccountServiceError(`Failed to update account with ID "${id}".`, 500);
    }

    return updated;
  });
}

export async function deleteAccount(id: string): Promise<boolean> {
  if (!id || typeof id !== 'string') {
    throw new AccountServiceError('Account ID is required.', 400);
  }

  return withCurrentTenantDb(prisma, async (client) => {
    // 1. Check existing account
    const existing = await accountRepository.getAccountById(client, id);
    if (!existing) {
      throw new AccountServiceError(`Account with ID "${id}" not found.`, 404);
    }

    // 2. Check child accounts existence
    const childCount = await accountRepository.getChildAccountsCount(client, id);
    if (childCount > 0) {
      throw new AccountServiceError(
        `Cannot delete account "${existing.name}" (${existing.code}) because it has ${childCount} child account(s). Reassign or delete child accounts first.`,
        400
      );
    }

    try {
      const deleted = await accountRepository.deleteAccount(client, id);
      return deleted;
    } catch (error: any) {
      if (error.code === '23503' || (error.message && error.message.includes('foreign key constraint'))) {
        throw new AccountServiceError(
          `Cannot delete account "${existing.name}" (${existing.code}) because it is referenced in journal entries or ledgers.`,
          400
        );
      }
      throw error;
    }
  });
}
