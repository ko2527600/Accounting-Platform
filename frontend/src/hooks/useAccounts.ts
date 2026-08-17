import { useState, useCallback, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { api } from '../lib/api';
import { useTenantSettings } from './useTenantSettings';
import { syncDb, createAccountLocalFirst, updateAccountLocalFirst } from '../lib/syncEngine';
import type { Account, AccountType, CreateAccountDTO, UpdateAccountDTO } from '../types/accounting';

// Backend account type values (fixed, matching the tenant-schema CHECK
// constraint) don't title-case cleanly - "COST_OF_SALES" needs "of"
// lowercase, not a generic per-word capitalization - so map explicitly
// both ways instead of guessing from string transforms.
const ACCOUNT_TYPE_TO_DISPLAY: Record<string, AccountType> = {
  ASSET: 'Asset',
  LIABILITY: 'Liability',
  EQUITY: 'Equity',
  REVENUE: 'Revenue',
  EXPENSE: 'Expense',
  COST_OF_SALES: 'Cost of Sales',
};
const ACCOUNT_TYPE_TO_BACKEND: Record<AccountType, string> = {
  Asset: 'ASSET',
  Liability: 'LIABILITY',
  Equity: 'EQUITY',
  Revenue: 'REVENUE',
  Expense: 'EXPENSE',
  'Cost of Sales': 'COST_OF_SALES',
};

function accountTypeToDisplay(type: string): AccountType {
  return ACCOUNT_TYPE_TO_DISPLAY[type] || (type as AccountType);
}

function accountTypeToBackend(type: AccountType): string {
  return ACCOUNT_TYPE_TO_BACKEND[type] || type.toUpperCase();
}

// Local-first: the account list itself renders straight from the IndexedDB
// mirror (syncEngine.ts, kept fresh by the bootstrap + live push - see
// useSyncEngineLifecycle) via useLiveQuery, so opening this page never waits
// on a network round-trip. Ledger balances are NOT part of the sync pilot
// yet (journal entries/ledgers are a later phase - see STATUS.md), so
// they're still fetched live and merged in on top of the local rows.
export function useAccounts() {
  const { settings } = useTenantSettings();
  const [balanceByAccountId, setBalanceByAccountId] = useState<Map<string, number>>(new Map());
  const [isLoading, setIsLoading] = useState(false);

  const localAccounts = useLiveQuery(() => syncDb.accounts.toArray(), []);

  const fetchBalances = useCallback(async () => {
    setIsLoading(true);
    try {
      const summaryResponse = await api.get('/ledgers/summary');
      if (summaryResponse.data.success) {
        setBalanceByAccountId(
          new Map<string, number>(summaryResponse.data.data.accounts.map((a: any) => [a.id, a.closingBalance]))
        );
      }
    } catch (error) {
      console.error('Failed to fetch account balances:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBalances();
  }, [fetchBalances]);

  const accounts: Account[] = (localAccounts ?? [])
    .map((acc) => ({
      ...acc,
      type: accountTypeToDisplay(acc.type),
      status: acc.isActive ? 'Active' : 'Archived',
      balance: balanceByAccountId.get(acc.id) ?? 0,
    }))
    .sort((a, b) => a.code.localeCompare(b.code)) as unknown as Account[];

  const createAccount = useCallback(async (data: CreateAccountDTO) => {
    // Currency always follows the tenant's own configured base currency -
    // there's no per-account currency picker anywhere in the UI, and the
    // ledger is single-currency by design, so a hardcoded literal here
    // would just silently drift from whatever the tenant actually set
    // under Settings > Currency & Regional.
    const payload: any = {
      code: data.code,
      name: data.name,
      type: accountTypeToBackend(data.type),
      currency: settings.baseCurrency,
      isActive: true,
    };
    if (data.isCashEquivalent !== undefined) payload.isCashEquivalent = data.isCashEquivalent;
    if (data.isFixedAsset !== undefined) payload.isFixedAsset = data.isFixedAsset;

    // Writes locally first (instant) and queues the real request in the
    // background - see createAccountLocalFirst. The live query above picks
    // up the optimistic row immediately, no explicit refetch needed.
    return createAccountLocalFirst(payload);
  }, [settings.baseCurrency]);

  const updateAccount = useCallback(async (id: string, data: UpdateAccountDTO) => {
    const payload: any = {};
    if (data.name) payload.name = data.name;
    if (data.code) payload.code = data.code;
    if (data.type) payload.type = accountTypeToBackend(data.type);
    if (data.status) payload.isActive = data.status === 'Active';
    if (data.isCashEquivalent !== undefined) payload.isCashEquivalent = data.isCashEquivalent;
    if (data.isFixedAsset !== undefined) payload.isFixedAsset = data.isFixedAsset;

    await updateAccountLocalFirst(id, payload);
  }, []);

  // Not routed through the offline outbox like create/updateAccount above -
  // designating a default posting account is a one-time setup action best
  // done online, and a dedicated endpoint (not the generic account PUT), so
  // it's a direct call. Updates the local mirror on success so the UI
  // reflects it immediately rather than waiting on the next live push -
  // including clearing the same role locally from whoever previously held
  // it (the server already did this atomically), so the UI never shows two
  // "default" badges for one role in the gap before that push arrives.
  const setAccountDefaultRole = useCallback(async (id: string, role: 'CASH' | 'REVENUE' | 'EXPENSE' | 'DEPRECIATION_EXPENSE' | 'ACCUMULATED_DEPRECIATION' | null) => {
    const res = await api.put(`/accounts/${id}/default-role`, { role });
    const updated = res.data.data.account;
    if (res.data.success) {
      if (role) {
        const all = await syncDb.accounts.toArray();
        const previousHolders = all.filter((a) => a.defaultRole === role && a.id !== updated.id);
        await Promise.all(previousHolders.map((a) => syncDb.accounts.put({ ...a, defaultRole: null })));
      }
      await syncDb.accounts.put(updated);
    }
    return updated;
  }, []);

  return {
    accounts,
    isLoading,
    fetchAccounts: fetchBalances,
    createAccount,
    updateAccount,
    setAccountDefaultRole,
  };
}
