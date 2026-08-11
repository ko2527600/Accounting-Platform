import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import type { AccountType } from '../types/accounting';

export interface LedgerReportLine {
  date: string;
  journalId: string;
  journalEntryId: string | null;
  description: string;
  debit: number;
  credit: number;
  runningBalance: number;
}

export interface LedgerReportAccount {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  currency: string;
}

export function useLedgerReport(accountId: string | null) {
  const [account, setAccount] = useState<LedgerReportAccount | null>(null);
  const [lines, setLines] = useState<LedgerReportLine[]>([]);
  const [openingBalance, setOpeningBalance] = useState(0);
  const [totalDebit, setTotalDebit] = useState(0);
  const [totalCredit, setTotalCredit] = useState(0);
  const [closingBalance, setClosingBalance] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!accountId) {
      setAccount(null);
      setLines([]);
      setOpeningBalance(0);
      setTotalDebit(0);
      setTotalCredit(0);
      setClosingBalance(0);
      return;
    }

    const fetchLedger = async () => {
      setIsLoading(true);
      try {
        const response = await api.get(`/ledgers/accounts/${accountId}`);
        if (response.data.success) {
          // Backend returns { account: {...}, statement: { transactions, openingBalance, totalDebit, totalCredit, closingBalance } }
          const { account: acc, statement } = response.data.data;

          setAccount({
            id: acc.id,
            code: acc.code,
            name: acc.name,
            type: (acc.type.charAt(0).toUpperCase() + acc.type.slice(1).toLowerCase()) as AccountType,
            currency: acc.currency,
          });

          setLines(statement.transactions.map((t: any) => ({
            date: new Date(t.transactionDate).toISOString().split('T')[0],
            journalId: t.entryNumber || t.journalEntryId || '-',
            journalEntryId: t.journalEntryId || null,
            description: t.description || 'Ledger Entry',
            debit: Number(t.debit),
            credit: Number(t.credit),
            runningBalance: Number(t.runningBalance),
          })));

          setOpeningBalance(Number(statement.openingBalance));
          setTotalDebit(Number(statement.totalDebit));
          setTotalCredit(Number(statement.totalCredit));
          setClosingBalance(Number(statement.closingBalance));
        }
      } catch (error) {
        console.error('Failed to fetch ledger report:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchLedger();
  }, [accountId]);

  return {
    account,
    lines,
    openingBalance,
    totalDebit,
    totalCredit,
    closingBalance,
    isLoading,
  };
}
