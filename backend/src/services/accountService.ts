import { prisma } from '../config/db';
import { withCurrentTenantDb } from '../database/tenantClient';
import { getTenantContext } from '../context/tenantContext';
import * as accountRepository from '../repository/accountRepository';
import { AccountRecord, AccountType, AccountDefaultRole, CreateAccountData } from '../repository/accountRepository';
import { recordAuditLogTx, diffFields, AuditActor } from './auditLogService';
import { recordChange, notifyChange } from './syncChangeLogService';

// Sentinel used to unwind a poisoned transaction cleanly on a clientTxnId
// race (see createAccount) - never surfaced to a caller directly.
class DuplicateAccountReplayError extends Error {}

function accountSyncPayload(account: AccountRecord): Record<string, unknown> {
  return {
    id: account.id,
    code: account.code,
    name: account.name,
    type: account.type,
    parentId: account.parentId,
    currency: account.currency,
    isActive: account.isActive,
    isCashEquivalent: account.isCashEquivalent,
    isFixedAsset: account.isFixedAsset,
    defaultRole: account.defaultRole,
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString(),
  };
}

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

const VALID_ACCOUNT_TYPES: AccountType[] = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE', 'COST_OF_SALES'];

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

export async function createAccount(data: CreateAccountData, actor?: AuditActor): Promise<AccountRecord> {
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

  let syncSeq: bigint | null = null;
  let replayed = false;

  let created: AccountRecord;
  try {
    created = await withCurrentTenantDb(prisma, async (client) => {
      // 0. Idempotency fast path - a retried offline-queued create (same
      // clientTxnId) returns the account already created by an earlier
      // attempt instead of erroring on the now-duplicate code, or worse,
      // creating a second account. Mirrors CashSale's clientTxnId pattern.
      if (data.clientTxnId) {
        const existing = await accountRepository.getAccountByClientTxnId(client, data.clientTxnId);
        if (existing) {
          replayed = true;
          return existing;
        }
      }

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

      let account: AccountRecord;
      try {
        account = await accountRepository.createAccount(client, {
          ...data,
          type: normalizedType,
        });
      } catch (error: any) {
        // A concurrent retry racing on the SAME clientTxnId can lose the
        // fast-path check above (Read Committed isolation - both can start
        // before either commits). Once Postgres rejects this INSERT the
        // whole transaction is poisoned (no further queries can run in it),
        // so recovery can't happen here inline - throw a sentinel so this
        // transaction rolls back cleanly, then look the winner up in a
        // FRESH transaction below (same two-phase pattern cashTill.ts's
        // DuplicateSaleReplayError uses).
        //
        // Two concurrent inserts sharing the same clientTxnId also share the
        // same `code` (it's a retry of the identical logical create), so
        // Postgres can report the conflict on EITHER unique index depending
        // on which one it evaluates first - observed both ways in practice
        // (uq_accounts_client_txn_id locally, accounts_code_key under CI's
        // timing). Both must be treated as "go look up the real winner",
        // not just the client_txn_id one.
        const message = String(error.message || '');
        if (error.code === '23505' && data.clientTxnId &&
          (message.includes('uq_accounts_client_txn_id') || message.includes('accounts_code_key'))) {
          throw new DuplicateAccountReplayError();
        }
        throw error;
      }

      // The transactional outbox entry - must stay inside this same
      // transaction (see syncChangeLogService.recordChange) so a client can
      // never observe a committed account that never got logged.
      syncSeq = await recordChange(client, {
        tenantId: getTenantContext()!.tenantId,
        entityType: 'Account',
        entityId: account.id,
        operation: 'CREATE',
        payload: accountSyncPayload(account),
      });

      // Same transaction as the account row itself, for the same reason as
      // recordChange above - and only on this genuine-creation path, never
      // on an idempotency replay (which didn't actually create anything).
      await recordAuditLogTx(client, {
        action: 'ACCOUNT.CREATED',
        entity: 'Account',
        entityId: account.id,
        actor,
        details: `Account ${account.code} - ${account.name} (${account.type}) created.`,
      });

      return account;
    });
  } catch (raceError: any) {
    if (raceError instanceof DuplicateAccountReplayError) {
      // The winning transaction is guaranteed committed by now (Postgres
      // blocked our INSERT until it resolved) - a fresh transaction here is
      // safe and will find it. Under heavy CI concurrency, the lookup can
      // occasionally return null on the first try before the connection pool
      // delivers the committed row; one short retry is enough.
      created = await withCurrentTenantDb(prisma, async (client) => {
        let winner = await accountRepository.getAccountByClientTxnId(client, data.clientTxnId!);
        // Under heavy CI concurrency the winning transaction's committed row
        // can take longer than 50 ms to be visible through the connection pool.
        // Retry up to 3 times with exponential back-off before giving up.
        for (let attempt = 0; !winner && attempt < 3; attempt++) {
          await new Promise((r) => setTimeout(r, 50 * 2 ** attempt)); // 50, 100, 200 ms
          winner = await accountRepository.getAccountByClientTxnId(client, data.clientTxnId!);
        }
        if (winner) return winner;
        // The code collision wasn't actually the same logical create racing
        // itself (no account exists under this clientTxnId) - it's a
        // genuine, unrelated code conflict with a different account. Surface
        // the real 409 instead of the opaque sentinel.
        throw new AccountServiceError(`Account code "${data.code.trim()}" already exists.`, 409);
      });
      replayed = true;
    } else {
      throw raceError;
    }
  }

  // Best-effort live push, only for a genuinely new change (not an
  // idempotency-replay of an already-notified create) - must happen AFTER
  // the transaction above has committed, see notifyChange's own comment.
  if (syncSeq !== null) {
    notifyChange({
      tenantId: getTenantContext()!.tenantId,
      entityType: 'Account',
      entityId: created.id,
      operation: 'CREATE',
      payload: accountSyncPayload(created),
      sequence: syncSeq,
    });
  }

  return created;
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
  data: Partial<CreateAccountData>,
  actor?: AuditActor
): Promise<AccountRecord> {
  if (!id || typeof id !== 'string') {
    throw new AccountServiceError('Account ID is required.', 400);
  }

  let previous: AccountRecord | null = null;
  let syncSeq: bigint | null = null;

  const updated = await withCurrentTenantDb(prisma, async (client) => {
    // 1. Check existing account
    const existing = await accountRepository.getAccountById(client, id);
    if (!existing) {
      throw new AccountServiceError(`Account with ID "${id}" not found.`, 404);
    }
    previous = existing;

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

    syncSeq = await recordChange(client, {
      tenantId: getTenantContext()!.tenantId,
      entityType: 'Account',
      entityId: updated.id,
      operation: 'UPDATE',
      payload: accountSyncPayload(updated),
    });

    await recordAuditLogTx(client, {
      action: 'ACCOUNT.UPDATED',
      entity: 'Account',
      entityId: updated.id,
      actor,
      changes: diffFields(previous, updated, ['code', 'name', 'type', 'isActive', 'parentId', 'isCashEquivalent', 'isFixedAsset']),
    });

    return updated;
  });

  if (syncSeq !== null) {
    notifyChange({
      tenantId: getTenantContext()!.tenantId,
      entityType: 'Account',
      entityId: updated.id,
      operation: 'UPDATE',
      payload: accountSyncPayload(updated),
      sequence: syncSeq,
    });
  }

  return updated;
}

// Which account TYPE is a sane fit for each default role - not a hard
// block (a business might reasonably want a LIABILITY account to soak up
// "expense" postings in an unusual setup), just a guardrail against an
// obvious mismatch like designating a LIABILITY account as the default
// CASH target.
const REASONABLE_TYPES_FOR_ROLE: Record<AccountDefaultRole, AccountType[]> = {
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

/**
 * Designates (or clears, when role is null) which single account the
 * auto-posting services (invoice payments, credit/debit notes, vendor bill
 * payments, expense reimbursements) should target for the generic
 * cash/revenue/expense side of a transaction - see
 * accountRepository.setAccountDefaultRole's own comment for why this exists
 * (replaces a hardcoded-account-code guess that silently posted to the
 * wrong account for any tenant whose chart didn't happen to use those exact
 * codes). Assigning a role away from whoever currently holds it is allowed
 * without confirmation - Chart of Accounts is expected to show the reader
 * exactly one holder per role at a time, so reassigning is a normal,
 * reversible action, not a destructive one.
 */
export async function setDefaultRole(
  id: string,
  role: AccountDefaultRole | null,
  actor?: AuditActor
): Promise<AccountRecord> {
  if (!id || typeof id !== 'string') {
    throw new AccountServiceError('Account ID is required.', 400);
  }
  if (role !== null && !REASONABLE_TYPES_FOR_ROLE[role]) {
    throw new AccountServiceError(`Invalid default role "${role}". Allowed: CASH, REVENUE, EXPENSE, DEPRECIATION_EXPENSE, ACCUMULATED_DEPRECIATION, or null to clear.`, 400);
  }

  let syncSeq: bigint | null = null;

  const updated = await withCurrentTenantDb(prisma, async (client) => {
    const existing = await accountRepository.getAccountById(client, id);
    if (!existing) {
      throw new AccountServiceError(`Account with ID "${id}" not found.`, 404);
    }

    if (role !== null && !REASONABLE_TYPES_FOR_ROLE[role].includes(existing.type)) {
      throw new AccountServiceError(
        `"${existing.name}" is a ${existing.type} account - the default ${role} account should be ${REASONABLE_TYPES_FOR_ROLE[role].join(' or ')}.`,
        400
      );
    }

    const result = await accountRepository.setAccountDefaultRole(client, id, role);
    if (!result) {
      throw new AccountServiceError(`Failed to update default role for account "${id}".`, 500);
    }

    syncSeq = await recordChange(client, {
      tenantId: getTenantContext()!.tenantId,
      entityType: 'Account',
      entityId: result.id,
      operation: 'UPDATE',
      payload: accountSyncPayload(result),
    });

    await recordAuditLogTx(client, {
      action: 'ACCOUNT.DEFAULT_ROLE_CHANGED',
      entity: 'Account',
      entityId: result.id,
      actor,
      details: role
        ? `Account ${result.code} - ${result.name} designated as the default ${role} account.`
        : `Account ${result.code} - ${result.name} unset as a default posting account.`,
    });

    return result;
  });

  if (syncSeq !== null) {
    notifyChange({
      tenantId: getTenantContext()!.tenantId,
      entityType: 'Account',
      entityId: updated.id,
      operation: 'UPDATE',
      payload: accountSyncPayload(updated),
      sequence: syncSeq,
    });
  }

  return updated;
}

export async function deleteAccount(id: string, actor?: AuditActor): Promise<boolean> {
  if (!id || typeof id !== 'string') {
    throw new AccountServiceError('Account ID is required.', 400);
  }

  let syncSeq: bigint | null = null;

  const deleted = await withCurrentTenantDb(prisma, async (client) => {
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

    let wasDeleted: boolean;
    try {
      wasDeleted = await accountRepository.deleteAccount(client, id);
    } catch (error: any) {
      if (error.code === '23503' || (error.message && error.message.includes('foreign key constraint'))) {
        throw new AccountServiceError(
          `Cannot delete account "${existing.name}" (${existing.code}) because it is referenced in journal entries or ledgers.`,
          400
        );
      }
      throw error;
    }

    if (wasDeleted) {
      // No payload - a DELETE tombstone only needs entityId/operation, and
      // the account's real row is already gone by the time a client fetches
      // this log entry.
      syncSeq = await recordChange(client, {
        tenantId: getTenantContext()!.tenantId,
        entityType: 'Account',
        entityId: id,
        operation: 'DELETE',
      });

      await recordAuditLogTx(client, {
        action: 'ACCOUNT.DELETED',
        entity: 'Account',
        entityId: id,
        actor,
        details: `Account ${existing.code} - ${existing.name} deleted.`,
      });
    }

    return wasDeleted;
  });

  if (syncSeq !== null) {
    notifyChange({
      tenantId: getTenantContext()!.tenantId,
      entityType: 'Account',
      entityId: id,
      operation: 'DELETE',
      sequence: syncSeq,
    });
  }

  return deleted;
}
