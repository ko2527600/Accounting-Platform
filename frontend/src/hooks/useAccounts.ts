import { useState, useCallback, useEffect } from 'react';
import { api } from '../lib/api';
import type { Account, CreateAccountDTO, UpdateAccountDTO } from '../types/accounting';

export function useAccounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchAccounts = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await api.get('/accounts');
      if (response.data.success) {
        // The backend returns { accounts: [...], tree: [...] }
        // We might need to map backend Prisma fields to frontend fields if they differ
        // e.g., mapping type 'ASSET' to 'Asset', isActive to status
        const mappedAccounts = response.data.data.accounts.map((acc: any) => ({
          ...acc,
          type: acc.type.charAt(0).toUpperCase() + acc.type.slice(1).toLowerCase(), // "ASSET" -> "Asset"
          status: acc.isActive ? 'Active' : 'Archived',
          balance: 0 // Balance might need to be fetched separately or calculated, but for basic accounts list we default to 0 if not provided
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
      const payload = {
        code: data.code,
        name: data.name,
        type: data.type.toUpperCase(), // "Asset" -> "ASSET"
        currency: "USD",
        isActive: true,
      };
      
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
      if (data.type) payload.type = data.type.toUpperCase();
      if (data.status) payload.isActive = data.status === 'Active';
      
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
