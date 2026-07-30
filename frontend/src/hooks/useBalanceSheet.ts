import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import type { Account } from '../types/accounting';

export interface BalanceSheetAccountRow {
  account: Partial<Account>;
  balance: number;
}

export interface BalanceSheetReport {
  asOfDate: string | null;
  assetAccounts: BalanceSheetAccountRow[];
  liabilityAccounts: BalanceSheetAccountRow[];
  equityAccounts: BalanceSheetAccountRow[];
  totalAssets: number;
  totalLiabilities: number;
  totalEquityAccounts: number;
  retainedEarnings: number;
  totalEquity: number;
  totalLiabilitiesAndEquity: number;
  isBalanced: boolean;
  isLoading: boolean;
}

export function useBalanceSheet(): BalanceSheetReport {
  const [asOfDate, setAsOfDate] = useState<string | null>(null);
  const [assetAccounts, setAssetAccounts] = useState<BalanceSheetAccountRow[]>([]);
  const [liabilityAccounts, setLiabilityAccounts] = useState<BalanceSheetAccountRow[]>([]);
  const [equityAccounts, setEquityAccounts] = useState<BalanceSheetAccountRow[]>([]);
  const [totalAssets, setTotalAssets] = useState(0);
  const [totalLiabilities, setTotalLiabilities] = useState(0);
  const [totalEquityAccounts, setTotalEquityAccounts] = useState(0);
  const [retainedEarnings, setRetainedEarnings] = useState(0);
  const [totalEquity, setTotalEquity] = useState(0);
  const [totalLiabilitiesAndEquity, setTotalLiabilitiesAndEquity] = useState(0);
  const [isBalanced, setIsBalanced] = useState(true);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const fetchBalanceSheet = async () => {
      setIsLoading(true);
      try {
        const response = await api.get('/reports/balance-sheet');
        if (response.data.success) {
          const data = response.data.data;

          const mapRow = (a: any): BalanceSheetAccountRow => ({
            account: { id: a.id, code: a.code, name: a.name, type: a.type },
            balance: a.balance,
          });

          setAsOfDate(data.asOfDate);
          setAssetAccounts(data.assets.map(mapRow));
          setLiabilityAccounts(data.liabilities.map(mapRow));
          setEquityAccounts(data.equity.map(mapRow));
          setTotalAssets(data.totalAssets);
          setTotalLiabilities(data.totalLiabilities);
          setTotalEquityAccounts(data.totalEquityAccounts);
          setRetainedEarnings(data.retainedEarnings);
          setTotalEquity(data.totalEquity);
          setTotalLiabilitiesAndEquity(data.totalLiabilitiesAndEquity);
          setIsBalanced(data.isBalanced);
        }
      } catch (error) {
        console.error('Failed to fetch Balance Sheet report:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchBalanceSheet();
  }, []);

  return {
    asOfDate,
    assetAccounts,
    liabilityAccounts,
    equityAccounts,
    totalAssets,
    totalLiabilities,
    totalEquityAccounts,
    retainedEarnings,
    totalEquity,
    totalLiabilitiesAndEquity,
    isBalanced,
    isLoading,
  };
}
