import { useState } from "react";
import { Download, BookOpen, ChevronRight } from "lucide-react";
import { useAccounts } from "../../hooks/useAccounts";
import { useLedgerReport } from "../../hooks/useLedgerReport";
import { useTenantSettings } from "../../hooks/useTenantSettings";
import { Button } from "../../components/ui/Button";
import { Card, CardContent } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Modal } from "../../components/ui/Modal";
import { exportToCsv } from "../../lib/exportCsv";
import { api } from "../../lib/api";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/Table";

interface JournalEntryLineDetail {
  id: string;
  accountId: string;
  debit: number;
  credit: number;
  description: string | null;
}

interface JournalEntryDetail {
  id: string;
  entryNumber: string;
  entryDate: string;
  description: string | null;
  status: string;
  reversalOfEntryId: string | null;
  reversedByEntryId: string | null;
  lines: JournalEntryLineDetail[];
}

export function GeneralLedger() {
  const { accounts } = useAccounts();
  const [selectedAccountId, setSelectedAccountId] = useState<string>(accounts[0]?.id || "");
  const { account, lines, openingBalance, totalDebit, totalCredit, closingBalance } = useLedgerReport(selectedAccountId);
  const { settings } = useTenantSettings();

  const [isJournalModalOpen, setIsJournalModalOpen] = useState(false);
  const [journalEntry, setJournalEntry] = useState<JournalEntryDetail | null>(null);
  const [isJournalLoading, setIsJournalLoading] = useState(false);
  const [journalError, setJournalError] = useState<string | null>(null);

  const accountLabelById = new Map(accounts.map((a) => [a.id, `${a.code} - ${a.name}`]));

  const openJournalEntry = async (journalEntryId: string) => {
    setIsJournalModalOpen(true);
    setIsJournalLoading(true);
    setJournalError(null);
    setJournalEntry(null);
    try {
      const res = await api.get(`/journal-entries/${journalEntryId}`);
      setJournalEntry(res.data.data.journalEntry);
    } catch (err: any) {
      setJournalError(err.response?.data?.error || "Failed to load this journal entry.");
    } finally {
      setIsJournalLoading(false);
    }
  };

  // Formats using the tenant's real configured base currency, the same
  // source every other report (Chart of Accounts, P&L, Balance Sheet, etc.)
  // already reads - not the stored per-account `currency` field, which is
  // write-only accident-of-creation-time data (the ledger is single-currency
  // by design, so every account's `currency` is always the tenant's own).
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: settings.baseCurrency,
    }).format(amount);
  };

  const handleExport = () => {
    if (!account || lines.length === 0) return;
    const exportData = lines.map(line => ({
      Date: line.date,
      Journal_ID: line.journalId,
      Description: line.description,
      Debit: line.debit,
      Credit: line.credit,
      Balance: line.runningBalance
    }));
    exportToCsv(`${account.code}_ledger_${new Date().toISOString().split('T')[0]}`, exportData);
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-secondary-900 dark:text-secondary-50">
            General Ledger Report
          </h2>
          <p className="text-secondary-500 dark:text-secondary-400 mt-1">
            View the complete transaction history for a specific account.
          </p>
        </div>
        <Button variant="outline" onClick={handleExport} disabled={!account || lines.length === 0}>
          <Download className="mr-2 h-4 w-4" />
          Export CSV
        </Button>
      </div>

      <Card className="border-none shadow-sm bg-white dark:bg-secondary-900">
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row gap-4 items-end">
            <div className="w-full sm:w-1/3">
              <label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
                Select Account
              </label>
              <select
                value={selectedAccountId}
                onChange={(e) => setSelectedAccountId(e.target.value)}
                className="flex h-10 w-full rounded-md border border-secondary-300 bg-white px-3 py-2 text-sm text-secondary-900 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-secondary-700 dark:bg-secondary-950 dark:text-secondary-50"
              >
                <option value="" disabled>Select an account...</option>
                {accounts.map(acc => (
                  <option key={acc.id} value={acc.id}>
                    {acc.code} - {acc.name}
                  </option>
                ))}
              </select>
            </div>
            {account && (
              <div className="flex items-center space-x-2 pb-2 pl-4 border-l border-secondary-200 dark:border-secondary-800">
                <Badge variant="secondary" className="text-xs">
                  {account.type}
                </Badge>
                <span className="text-sm text-secondary-500">
                  Normal Balance: {['Asset', 'Expense'].includes(account.type) ? 'Debit' : 'Credit'}
                </span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {account ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="shadow-sm">
              <CardContent className="p-4">
                <p className="text-sm font-medium text-secondary-500 dark:text-secondary-400">Opening Balance</p>
                <p className="text-2xl font-bold mt-1 text-secondary-900 dark:text-secondary-50">{formatCurrency(openingBalance)}</p>
              </CardContent>
            </Card>
            <Card className="shadow-sm">
              <CardContent className="p-4">
                <p className="text-sm font-medium text-secondary-500 dark:text-secondary-400">Total Debits</p>
                <p className="text-2xl font-bold mt-1 text-emerald-600 dark:text-emerald-400">{formatCurrency(totalDebit)}</p>
              </CardContent>
            </Card>
            <Card className="shadow-sm">
              <CardContent className="p-4">
                <p className="text-sm font-medium text-secondary-500 dark:text-secondary-400">Total Credits</p>
                <p className="text-2xl font-bold mt-1 text-amber-600 dark:text-amber-400">{formatCurrency(totalCredit)}</p>
              </CardContent>
            </Card>
            <Card className="shadow-sm border-primary-200 dark:border-primary-900 bg-primary-50/50 dark:bg-primary-900/10">
              <CardContent className="p-4">
                <p className="text-sm font-medium text-primary-700 dark:text-primary-300">Closing Balance</p>
                <p className="text-2xl font-bold mt-1 text-primary-900 dark:text-primary-100">{formatCurrency(closingBalance)}</p>
              </CardContent>
            </Card>
          </div>

          <div className="bg-white dark:bg-secondary-900 shadow-sm border border-secondary-200 dark:border-secondary-800 rounded-xl overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[120px]">Date</TableHead>
                  <TableHead className="w-[120px]">Journal ID</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right w-[140px]">Debit</TableHead>
                  <TableHead className="text-right w-[140px]">Credit</TableHead>
                  <TableHead className="text-right w-[160px] bg-secondary-50/50 dark:bg-secondary-800/30">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-48 text-center">
                      <div className="flex flex-col items-center justify-center text-secondary-500">
                        <BookOpen className="h-8 w-8 text-secondary-300 mb-2" />
                        No transactions found for this account.
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  lines.map((line, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="text-secondary-600 dark:text-secondary-400">
                        {line.date}
                      </TableCell>
                      <TableCell>
                        {line.journalEntryId ? (
                          <button
                            type="button"
                            onClick={() => openJournalEntry(line.journalEntryId!)}
                            className="flex items-center text-primary-600 dark:text-primary-400 hover:underline cursor-pointer"
                            title="View the full journal entry"
                          >
                            {line.journalId}
                            <ChevronRight className="h-3 w-3 ml-1" />
                          </button>
                        ) : (
                          <span className="text-secondary-500">{line.journalId}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="font-medium text-secondary-900 dark:text-secondary-50">
                          {line.description}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-secondary-900 dark:text-secondary-100">
                        {line.debit > 0 ? formatCurrency(line.debit) : "-"}
                      </TableCell>
                      <TableCell className="text-right text-secondary-900 dark:text-secondary-100">
                        {line.credit > 0 ? formatCurrency(line.credit) : "-"}
                      </TableCell>
                      <TableCell className="text-right font-medium bg-secondary-50/30 dark:bg-secondary-800/10">
                        {formatCurrency(line.runningBalance)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </>
      ) : (
        <Card>
          <CardContent className="h-64 flex flex-col items-center justify-center text-secondary-500">
            <BookOpen className="h-12 w-12 text-secondary-300 mb-4" />
            <p>Please select an account to view its ledger.</p>
          </CardContent>
        </Card>
      )}

      <Modal
        isOpen={isJournalModalOpen}
        onClose={() => setIsJournalModalOpen(false)}
        title={journalEntry ? `Journal Entry ${journalEntry.entryNumber}` : "Journal Entry"}
        description={journalEntry ? new Date(journalEntry.entryDate).toISOString().split("T")[0] : undefined}
        className="max-w-2xl"
      >
        {isJournalLoading ? (
          <div className="py-8 text-center text-sm text-secondary-500">Loading journal entry...</div>
        ) : journalError ? (
          <div className="py-4 text-sm text-red-600">{journalError}</div>
        ) : journalEntry ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-secondary-900 dark:text-secondary-50">
                  {journalEntry.description || "No description"}
                </p>
                {journalEntry.reversalOfEntryId && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">Reversal of another entry</p>
                )}
                {journalEntry.reversedByEntryId && (
                  <p className="text-xs text-secondary-500 mt-0.5">Reversed by another entry</p>
                )}
              </div>
              <Badge
                variant={
                  journalEntry.status === "POSTED"
                    ? "success"
                    : journalEntry.status === "VOID"
                    ? "danger"
                    : "warning"
                }
              >
                {journalEntry.status}
              </Badge>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Debit</TableHead>
                  <TableHead className="text-right">Credit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {journalEntry.lines.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell className="font-medium text-secondary-900 dark:text-secondary-50">
                      {accountLabelById.get(line.accountId) || line.accountId}
                    </TableCell>
                    <TableCell className="text-secondary-500 text-xs">{line.description || "-"}</TableCell>
                    <TableCell className="text-right">{line.debit > 0 ? formatCurrency(line.debit) : "-"}</TableCell>
                    <TableCell className="text-right">{line.credit > 0 ? formatCurrency(line.credit) : "-"}</TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell colSpan={2} className="text-right font-semibold text-xs uppercase tracking-wider text-secondary-500">
                    Total
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    {formatCurrency(journalEntry.lines.reduce((sum, l) => sum + l.debit, 0))}
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    {formatCurrency(journalEntry.lines.reduce((sum, l) => sum + l.credit, 0))}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
