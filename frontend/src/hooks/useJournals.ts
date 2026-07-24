import { useState, useCallback, useEffect } from 'react';
import { api } from '../lib/api';
import type { JournalEntry, CreateJournalEntryDTO } from '../types/accounting';

export function useJournals() {
  const [journals, setJournals] = useState<JournalEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchJournals = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await api.get('/journal-entries');
      if (response.data.success) {
        // Map backend Prisma format to frontend format
        const mappedJournals = response.data.data.journalEntries.map((je: any) => {
          const totalDebit = je.lines.reduce((sum: number, line: any) => sum + Number(line.debit), 0);
          const totalCredit = je.lines.reduce((sum: number, line: any) => sum + Number(line.credit), 0);
          
          return {
            id: je.id,
            date: new Date(je.entryDate).toISOString().split('T')[0],
            description: je.description || '',
            status: je.status.charAt(0).toUpperCase() + je.status.slice(1).toLowerCase(), // 'POSTED' -> 'Posted'
            totalDebit,
            totalCredit,
            createdAt: je.createdAt,
            lines: je.lines.map((line: any) => ({
              id: line.id,
              accountId: line.accountId,
              description: line.description || '',
              debit: Number(line.debit),
              credit: Number(line.credit)
            }))
          };
        });
        setJournals(mappedJournals);
        return mappedJournals;
      }
    } catch (error) {
      console.error('Failed to fetch journals:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const postJournal = useCallback(async (data: CreateJournalEntryDTO) => {
    setIsLoading(true);
    try {
      // Calculate totals to ensure balance
      const totalDebit = data.lines.reduce((sum, line) => sum + (Number(line.debit) || 0), 0);
      const totalCredit = data.lines.reduce((sum, line) => sum + (Number(line.credit) || 0), 0);

      if (totalDebit !== totalCredit) {
        throw new Error("Journal entry must balance (Total Debits = Total Credits).");
      }

      const payload = {
        entryDate: new Date(data.date).toISOString(),
        description: data.description,
        lines: data.lines.map(line => ({
          accountId: line.accountId,
          debit: Number(line.debit) || 0,
          credit: Number(line.credit) || 0,
          description: line.description
        }))
      };

      const response = await api.post('/journal-entries', payload);
      if (response.data.success) {
        await fetchJournals();
        return response.data.data.journalEntry;
      }
    } catch (error: any) {
      console.error('Failed to post journal:', error);
      throw error.response?.data?.error || error.message || "Failed to post journal entry";
    } finally {
      setIsLoading(false);
    }
  }, [fetchJournals]);

  useEffect(() => {
    fetchJournals();
  }, [fetchJournals]);

  return {
    journals,
    isLoading,
    fetchJournals,
    postJournal
  };
}
