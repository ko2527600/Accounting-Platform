import { useState, useEffect } from 'react';
import { api } from '../lib/api';

export interface CashFlowLineItem {
  id: string;
  code: string;
  name: string;
  change: number;
}

export interface CashFlowReport {
  startDate: string | null;
  endDate: string | null;
  netIncome: number;
  operatingAdjustments: CashFlowLineItem[];
  netCashFromOperating: number;
  investingAdjustments: CashFlowLineItem[];
  netCashFromInvesting: number;
  financingAdjustments: CashFlowLineItem[];
  netCashFromFinancing: number;
  netChangeInCash: number;
  beginningCash: number;
  endingCash: number;
  cashTies: boolean;
  cashAccounts: { id: string; code: string; name: string; balance: number }[];
  isLoading: boolean;
}

export function useCashFlow(): CashFlowReport {
  const [data, setData] = useState<Omit<CashFlowReport, 'isLoading'>>({
    startDate: null,
    endDate: null,
    netIncome: 0,
    operatingAdjustments: [],
    netCashFromOperating: 0,
    investingAdjustments: [],
    netCashFromInvesting: 0,
    financingAdjustments: [],
    netCashFromFinancing: 0,
    netChangeInCash: 0,
    beginningCash: 0,
    endingCash: 0,
    cashTies: true,
    cashAccounts: [],
  });
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const fetchCashFlow = async () => {
      setIsLoading(true);
      try {
        const response = await api.get('/reports/cash-flow');
        if (response.data.success) {
          setData(response.data.data);
        }
      } catch (error) {
        console.error('Failed to fetch Cash Flow Statement:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchCashFlow();
  }, []);

  return { ...data, isLoading };
}
