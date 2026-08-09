import { useState, useCallback, useEffect } from 'react';
import { api } from '../lib/api';
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

export function useAccounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchAccounts = useCallback(async () => {
    setIsLoading(true);
    try {
      const [accountsResponse, summaryResponse] = await Promise.all([
        api.get('/accounts'),
        api.get('/ledgers/summary'),
      ]);

      if (accountsResponse.data.success) {
        const balanceByAccountId = new Map<string, number>(
          summaryResponse.data.success
            ? summaryResponse.data.data.accounts.map((a: any) => [a.id, a.closingBalance])
            : []
        );

        // The backend returns { accounts: [...], tree: [...] }
        // We might need to map backend Prisma fields to frontend fields if they differ
        // e.g., mapping type 'ASSET' to 'Asset', isActive to status
        const mappedAccounts = accountsResponse.data.data.accounts.map((acc: any) => ({
          ...acc,
          type: accountTypeToDisplay(acc.type),
          status: acc.isActive ? 'Active' : 'Archived',
          balance: balanceByAccountId.get(acc.id) ?? 0,
        }));
        setAccounts(mappedAccounts);
        return mappedAccounts;
      }
    } catch (error) {
      console.error('Failed to fetch accounts:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const createAccount = useCallback(async (data: CreateAccountDTO) => {
    setIsLoading(true);
    try {
      // Map frontend DTO to backend Prisma payload
      const payload: any = {
        code: data.code,
        name: data.name,
        type: accountTypeToBackend(data.type),
        currency: "USD",
        isActive: true,
      };
      if (data.isCashEquivalent !== undefined) payload.isCashEquivalent = data.isCashEquivalent;
      
      const response = await api.post('/accounts', payload);
      if (response.data.success) {
        await fetchAccounts();
        return response.data.data.account;
      }
    } catch (error) {
      console.error('Failed to create account:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [fetchAccounts]);

  const updateAccount = useCallback(async (id: string, data: UpdateAccountDTO) => {
    setIsLoading(true);
    try {
      const payload: any = {};
      if (data.name) payload.name = data.name;
      if (data.code) payload.code = data.code;
      if (data.type) payload.type = accountTypeToBackend(data.type);
      if (data.status) payload.isActive = data.status === 'Active';
      if (data.isCashEquivalent !== undefined) payload.isCashEquivalent = data.isCashEquivalent;
      
      const response = await api.put(`/accounts/${id}`, payload);
      if (response.data.success) {
        await fetchAccounts();
      }
    } catch (error) {
      console.error('Failed to update account:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [fetchAccounts]);

  // Initial fetch
  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  return {
    accounts,
    isLoading,
    fetchAccounts,
    createAccount,
    updateAccount
  };
}
