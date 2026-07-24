import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import type { Account } from '../types/accounting';

export interface LedgerReportLine {
  date: string;
  journalId: string;
  description: string;
  lineDescription?: string;
  debit: number;
  credit: number;
  runningBalance: number;
}

export function useLedgerReport(accountId: string | null) {
  const [account, setAccount] = useState<Account | null>(null);
  const [lines, setLines] = useState<LedgerReportLine[]>([]);
  const [totalDebit, setTotalDebit] = useState(0);
  const [totalCredit, setTotalCredit] = useState(0);
  const [closingBalance, setClosingBalance] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!accountId) {
      setAccount(null);
      setLines([]);
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
          const { account, transactions, closingBalance, totalDebits, totalCredits } = response.data.data;
          
          setAccount({
            id: account.id,
            code: account.code,
            name: account.name,
            type: account.type.charAt(0).toUpperCase() + account.type.slice(1).toLowerCase(),
            status: account.isActive ? 'Active' : 'Archived',
            balance: closingBalance,
            createdAt: account.createdAt,
            updatedAt: account.updatedAt,
          });

          setLines(transactions.map((t: any) => ({
            date: new Date(t.transactionDate).toISOString().split('T')[0],
            journalId: t.journalEntry?.entryNumber || t.journalEntryId || '-',
            description: t.journalEntry?.description || t.description || 'Ledger Entry',
            lineDescription: t.description || '',
            debit: Number(t.debit),
            credit: Number(t.credit),
            runningBalance: Number(t.balance)
          })));

          setTotalDebit(Number(totalDebits));
          setTotalCredit(Number(totalCredits));
          setClosingBalance(Number(closingBalance));
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
    totalDebit,
    totalCredit,
    closingBalance,
    isLoading
  };
}
