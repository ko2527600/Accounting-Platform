import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import type { Account } from '../types/accounting';

export interface PnLAccountRow {
  account: Partial<Account>;
  balance: number;
}

export interface ProfitAndLossReport {
  revenueAccounts: PnLAccountRow[];
  expenseAccounts: PnLAccountRow[];
  totalRevenue: number;
  totalExpense: number;
  netIncome: number;
  isLoading: boolean;
}

export function useProfitAndLoss(): ProfitAndLossReport {
  const [revenueAccounts, setRevenueAccounts] = useState<PnLAccountRow[]>([]);
  const [expenseAccounts, setExpenseAccounts] = useState<PnLAccountRow[]>([]);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [totalExpense, setTotalExpense] = useState(0);
  const [netIncome, setNetIncome] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const fetchPnL = async () => {
      setIsLoading(true);
      try {
        const response = await api.get('/reports/profit-loss');
        if (response.data.success) {
          const data = response.data.data;
          
          setRevenueAccounts(data.revenues.map((r: any) => ({
            account: { id: r.id, code: r.code, name: r.name, type: 'Revenue' },
            balance: r.amount
          })));

          setExpenseAccounts(data.expenses.map((e: any) => ({
            account: { id: e.id, code: e.code, name: e.name, type: 'Expense' },
            balance: e.amount
          })));

          setTotalRevenue(data.totalRevenue);
          setTotalExpense(data.totalExpenses);
          setNetIncome(data.netProfit);
        }
      } catch (error) {
        console.error('Failed to fetch PnL report:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchPnL();
  }, []);

  return {
    revenueAccounts,
    expenseAccounts,
    totalRevenue,
    totalExpense,
    netIncome,
    isLoading
  };
}
