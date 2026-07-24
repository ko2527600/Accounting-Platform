import { useState } from "react";
import { Download, BookOpen, ChevronRight } from "lucide-react";
import { useAccounts } from "../../hooks/useAccounts";
import { useLedgerReport } from "../../hooks/useLedgerReport";
import { Button } from "../../components/ui/Button";
import { Card, CardContent } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { exportToCsv } from "../../lib/exportCsv";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/Table";

export function GeneralLedger() {
  const { accounts } = useAccounts();
  const [selectedAccountId, setSelectedAccountId] = useState<string>(accounts[0]?.id || "");
  const { account, lines, totalDebit, totalCredit, closingBalance } = useLedgerReport(selectedAccountId);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(amount);
  };

  const handleExport = () => {
    if (!account || lines.length === 0) return;
    const exportData = lines.map(line => ({
      Date: line.date,
      Journal_ID: line.journalId,
      Journal_Description: line.description,
      Line_Description: line.lineDescription || '',
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
                <p className="text-2xl font-bold mt-1 text-secondary-900 dark:text-secondary-50">$0.00</p>
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
                        <div className="flex items-center text-primary-600 dark:text-primary-400 hover:underline cursor-pointer">
                          {line.journalId}
                          <ChevronRight className="h-3 w-3 ml-1" />
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="font-medium text-secondary-900 dark:text-secondary-50">
                          {line.description}
                        </span>
                        {line.lineDescription && (
                          <div className="text-xs text-secondary-500 mt-0.5">
                            {line.lineDescription}
                          </div>
                        )}
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
    </div>
  );
}
