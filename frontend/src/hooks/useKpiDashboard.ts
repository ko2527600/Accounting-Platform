import { useState, useEffect } from 'react';
import { api } from '../lib/api';

export interface KpiDashboardReport {
  startDate: string | null;
  endDate: string | null;
  netIncome: number;
  totalRevenue: number;
  totalExpenses: number;
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  totalCashEquivalents: number;
  netProfitMarginPct: number | null;
  returnOnAssetsPct: number | null;
  debtToEquityRatio: number | null;
  cashRatio: number | null;
  equityRatioPct: number | null;
  isLoading: boolean;
}

export function useKpiDashboard(): KpiDashboardReport {
  const [data, setData] = useState<Omit<KpiDashboardReport, 'isLoading'>>({
    startDate: null,
    endDate: null,
    netIncome: 0,
    totalRevenue: 0,
    totalExpenses: 0,
    totalAssets: 0,
    totalLiabilities: 0,
    totalEquity: 0,
    totalCashEquivalents: 0,
    netProfitMarginPct: null,
    returnOnAssetsPct: null,
    debtToEquityRatio: null,
    cashRatio: null,
    equityRatioPct: null,
  });
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const fetchKpis = async () => {
      setIsLoading(true);
      try {
        const response = await api.get('/reports/kpis');
        if (response.data.success) {
          setData(response.data.data);
        }
      } catch (error) {
        console.error('Failed to fetch KPI dashboard:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchKpis();
  }, []);

  return { ...data, isLoading };
}
