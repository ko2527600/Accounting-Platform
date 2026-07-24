import { useState, useEffect, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "../../components/ui/Table";
import { Modal } from "../../components/ui/Modal";
import { api } from "../../lib/api";
import { Landmark, Plus, CheckCircle, RefreshCw, ArrowUpRight, ArrowDownLeft } from "lucide-react";

interface BankAccount {
  id: string;
  accountName: string;
  accountNumber: string;
  bankName: string;
  currency: string;
  currentBalance: number;
  isActive: boolean;
}

interface BankTx {
  id: string;
  bankAccountId: string;
  amount: number;
  payee: string;
  description?: string;
  postedDate: string;
  status: string;
  bankAccount?: BankAccount;
}

export function BankReconciliation() {
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [transactions, setTransactions] = useState<BankTx[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnectOpen, setIsConnectOpen] = useState(false);

  // Link Form State
  const [bankName, setBankName] = useState("Chase Bank");
  const [accountName, setAccountName] = useState("Business Checking");
  const [accountNumber, setAccountNumber] = useState("4589");
  const [initialBalance, setInitialBalance] = useState("15000");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchBankingData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [accRes, txRes] = await Promise.all([
        api.get("/banking/accounts"),
        api.get("/banking/transactions"),
      ]);

      if (accRes.data.success) setBankAccounts(accRes.data.data.bankAccounts);
      if (txRes.data.success) setTransactions(txRes.data.data.transactions);
    } catch (err) {
      console.error("Failed to fetch banking data:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBankingData();
  }, [fetchBankingData]);

  const handleConnectBank = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const res = await api.post("/banking/connect", {
        bankName,
        accountName,
        accountNumber,
        initialBalance: Number(initialBalance),
      });

      if (res.data.success) {
        setIsConnectOpen(false);
        fetchBankingData();
      }
    } catch (err: any) {
      alert(err.response?.data?.error || "Failed to link bank account.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReconcileTx = async (txId: string) => {
    try {
      const res = await api.post("/banking/reconcile", { transactionId: txId });
      if (res.data.success) {
        fetchBankingData();
      }
    } catch (err: any) {
      alert(err.response?.data?.error || "Reconciliation failed.");
    }
  };

  const formatCurrency = (amt: number) => {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amt);
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-secondary-900 dark:text-secondary-50">
            Connected Banking & Reconciliation
          </h2>
          <p className="text-secondary-500 dark:text-secondary-400 mt-1">
            Link live bank feeds, inspect statement lines, and reconcile transactions with your General Ledger.
          </p>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchBankingData} className="flex items-center">
            <RefreshCw className="mr-2 h-4 w-4" />
            Sync Feeds
          </Button>
          <Button variant="primary" onClick={() => setIsConnectOpen(true)} className="flex items-center">
            <Plus className="mr-2 h-4 w-4" />
            Link Bank Account
          </Button>
        </div>
      </div>

      {/* Bank Account Cards Grid */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {bankAccounts.map((acc) => (
          <Card key={acc.id} className="border-primary-100 dark:border-primary-950">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base font-semibold">{acc.accountName}</CardTitle>
              <Landmark className="h-5 w-5 text-primary-600 dark:text-primary-400" />
            </CardHeader>
            <CardContent>
              <div className="text-xs text-secondary-500 mb-1">
                {acc.bankName} •••• {acc.accountNumber}
              </div>
              <div className="text-2xl font-bold text-secondary-900 dark:text-secondary-50">
                {formatCurrency(Number(acc.currentBalance))}
              </div>
            </CardContent>
          </Card>
        ))}

        {bankAccounts.length === 0 && !isLoading && (
          <Card className="md:col-span-3 border-dashed">
            <CardContent className="py-8 text-center text-secondary-500">
              <Landmark className="mx-auto h-8 w-8 text-secondary-400 mb-2" />
              No bank feeds connected yet. Click "Link Bank Account" to connect your checking or savings feed.
            </CardContent>
          </Card>
        )}
      </div>

      {/* Statement Reconciliation Table */}
      <Card>
        <CardHeader>
          <CardTitle>Bank Statement Reconciliation Lines ({transactions.length})</CardTitle>
          <CardDescription>Match statement transactions with General Ledger entries.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-8 text-center text-secondary-500">Loading statement transactions...</div>
          ) : transactions.length === 0 ? (
            <div className="py-8 text-center text-secondary-500 text-sm">
              No statement lines available. Connect a bank account to stream live statement transactions.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Payee / Description</TableHead>
                  <TableHead>Bank Account</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((tx) => {
                  const isCredit = Number(tx.amount) > 0;
                  return (
                    <TableRow key={tx.id}>
                      <TableCell className="text-xs text-secondary-500">
                        {new Date(tx.postedDate).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-secondary-900 dark:text-secondary-50">{tx.payee}</div>
                        <div className="text-xs text-secondary-500">{tx.description}</div>
                      </TableCell>
                      <TableCell className="text-xs">{tx.bankAccount?.bankName || "Bank Feed"}</TableCell>
                      <TableCell className="font-semibold">
                        <span className={`inline-flex items-center ${isCredit ? 'text-emerald-600 dark:text-emerald-400' : 'text-secondary-900 dark:text-secondary-50'}`}>
                          {isCredit ? <ArrowDownLeft className="mr-1 h-3.5 w-3.5" /> : <ArrowUpRight className="mr-1 h-3.5 w-3.5" />}
                          {formatCurrency(Math.abs(Number(tx.amount)))}
                        </span>
                      </TableCell>
                      <TableCell>
                        {tx.status === "RECONCILED" ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">
                            <CheckCircle className="mr-1 h-3 w-3" /> Reconciled
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
                            Unreconciled
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {tx.status !== "RECONCILED" && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleReconcileTx(tx.id)}
                            className="text-xs"
                          >
                            Reconcile Match
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Link Bank Account Modal */}
      <Modal isOpen={isConnectOpen} onClose={() => setIsConnectOpen(false)} title="Link Bank Feed">
        <form onSubmit={handleConnectBank} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
              Financial Institution
            </label>
            <Input
              required
              placeholder="e.g. Chase Bank, SVB, Wells Fargo"
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
              Account Name
            </label>
            <Input
              required
              placeholder="e.g. Primary Operating Checking"
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
              Last 4 Digits of Account Number
            </label>
            <Input
              required
              maxLength={4}
              placeholder="4589"
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
              Initial Statement Balance ($)
            </label>
            <Input
              type="number"
              required
              placeholder="15000"
              value={initialBalance}
              onChange={(e) => setInitialBalance(e.target.value)}
            />
          </div>

          <div className="flex justify-end space-x-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setIsConnectOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={isSubmitting}>
              {isSubmitting ? "Linking Feed..." : "Link Bank Feed"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
