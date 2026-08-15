import { useState, useEffect, useCallback, useMemo } from "react";
import MonoConnect from "@mono.co/connect.js";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "../../components/ui/Table";
import { api } from "../../lib/api";
import { useAuth } from "../../contexts/AuthContext";
import { useToast } from "../../contexts/ToastContext";
import { useTenantSettings } from "../../contexts/TenantSettingsContext";
import { UpgradeRequired } from "../../components/UpgradeRequired";
import { Landmark, Plus, CheckCircle, RefreshCw, ArrowUpRight, ArrowDownLeft, Search, X } from "lucide-react";

const MONO_PUBLIC_KEY = import.meta.env.VITE_MONO_PUBLIC_KEY as string | undefined;

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

interface LedgerCandidate {
  id: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  transactionDate: string;
  debit: number;
  credit: number;
  description: string | null;
}

export function BankReconciliation() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const { settings: tenantSettings, isLoading: isLoadingTenantSettings } = useTenantSettings();
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [transactions, setTransactions] = useState<BankTx[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [expandedTxId, setExpandedTxId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<LedgerCandidate[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [confirmingLedgerId, setConfirmingLedgerId] = useState<string | null>(null);

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
    // Skip the fetch entirely below Business tier - avoids a guaranteed 403
    // round trip (see requireTier() gating this router) before the locked
    // state below even has a chance to render.
    if (!isLoadingTenantSettings && tenantSettings.tier >= 2) {
      fetchBankingData();
    } else if (!isLoadingTenantSettings) {
      setIsLoading(false);
    }
  }, [fetchBankingData, isLoadingTenantSettings, tenantSettings.tier]);

  const handleMonoCode = useCallback(
    async ({ code }: { code: string }) => {
      setIsConnecting(true);
      setConnectError(null);
      try {
        const res = await api.post("/banking/connect", { monoCode: code });
        if (res.data.success) {
          fetchBankingData();
        }
      } catch (err: any) {
        setConnectError(err.response?.data?.error || "Failed to link bank account.");
      } finally {
        setIsConnecting(false);
      }
    },
    [fetchBankingData]
  );

  const monoConnect = useMemo(() => {
    if (!MONO_PUBLIC_KEY) return null;
    const instance = new MonoConnect({
      key: MONO_PUBLIC_KEY,
      data: { customer: { name: user?.name || "", email: user?.email || "" } },
      onSuccess: handleMonoCode,
      onClose: () => {},
    });
    instance.setup();
    return instance;
  }, [user, handleMonoCode]);

  const handleSyncFeeds = async () => {
    setIsSyncing(true);
    try {
      await Promise.all(bankAccounts.map((acc) => api.post(`/banking/accounts/${acc.id}/sync`)));
      await fetchBankingData();
    } catch (err: any) {
      showToast(err.response?.data?.error || "Failed to sync bank feeds.", "error");
    } finally {
      setIsSyncing(false);
    }
  };

  const handleToggleFindMatch = async (txId: string) => {
    if (expandedTxId === txId) {
      setExpandedTxId(null);
      return;
    }
    setExpandedTxId(txId);
    setSuggestions([]);
    setSuggestionsLoading(true);
    try {
      const res = await api.get(`/banking/transactions/${txId}/suggestions`);
      if (res.data.success) setSuggestions(res.data.data.candidates);
    } catch (err: any) {
      showToast(err.response?.data?.error || "Failed to find matching ledger entries.", "error");
    } finally {
      setSuggestionsLoading(false);
    }
  };

  const handleConfirmMatch = async (txId: string, ledgerId: string) => {
    setConfirmingLedgerId(ledgerId);
    try {
      const res = await api.post("/banking/reconcile", { transactionId: txId, ledgerId });
      if (res.data.success) {
        setExpandedTxId(null);
        showToast("Bank transaction reconciled.", "success");
        fetchBankingData();
      }
    } catch (err: any) {
      showToast(err.response?.data?.error || "Reconciliation failed.", "error");
    } finally {
      setConfirmingLedgerId(null);
    }
  };

  const formatCurrency = (amt: number, currency: string = "USD") => {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amt);
  };

  if (!isLoadingTenantSettings && tenantSettings.tier < 2) {
    return <UpgradeRequired featureLabel="Bank Reconciliation" requiredTier={2} currentTier={tenantSettings.tier} />;
  }

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
          <Button
            variant="outline"
            onClick={handleSyncFeeds}
            disabled={isSyncing || bankAccounts.length === 0}
            className="flex items-center"
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            {isSyncing ? "Syncing..." : "Sync Feeds"}
          </Button>
          <Button
            variant="primary"
            onClick={() => monoConnect?.open()}
            disabled={!monoConnect || isConnecting}
            className="flex items-center"
          >
            <Plus className="mr-2 h-4 w-4" />
            {isConnecting ? "Linking..." : "Link Bank Account"}
          </Button>
        </div>
      </div>

      {!MONO_PUBLIC_KEY && (
        <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg text-sm text-amber-800 dark:text-amber-300">
          Bank integration is not configured for this environment. Set <code>VITE_MONO_PUBLIC_KEY</code> to enable linking real bank feeds via Mono.
        </div>
      )}

      {connectError && (
        <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-lg text-sm text-rose-800 dark:text-rose-300">
          {connectError}
        </div>
      )}

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
                {formatCurrency(Number(acc.currentBalance), acc.currency)}
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
                          {formatCurrency(Math.abs(Number(tx.amount)), tx.bankAccount?.currency)}
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
                            onClick={() => handleToggleFindMatch(tx.id)}
                            className="text-xs"
                          >
                            {expandedTxId === tx.id ? (
                              <>
                                <X className="mr-1.5 h-3.5 w-3.5" /> Close
                              </>
                            ) : (
                              <>
                                <Search className="mr-1.5 h-3.5 w-3.5" /> Find Match
                              </>
                            )}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {expandedTxId &&
                  (() => {
                    const tx = transactions.find((t) => t.id === expandedTxId);
                    if (!tx) return null;
                    return (
                      <TableRow key={`${expandedTxId}-suggestions`} className="bg-secondary-50/50 dark:bg-secondary-900/50">
                        <TableCell colSpan={6}>
                          <div className="py-2">
                            <p className="text-xs font-medium text-secondary-500 mb-2">
                              General Ledger entries matching {formatCurrency(Math.abs(Number(tx.amount)), tx.bankAccount?.currency)} within ±10 days of {new Date(tx.postedDate).toLocaleDateString()}:
                            </p>
                            {suggestionsLoading ? (
                              <div className="text-sm text-secondary-500 py-2">Searching the ledger...</div>
                            ) : suggestions.length === 0 ? (
                              <div className="text-sm text-secondary-500 py-2">
                                No matching ledger entry found. Post the corresponding journal entry first, then try again.
                              </div>
                            ) : (
                              <div className="space-y-2">
                                {suggestions.map((candidate) => (
                                  <div
                                    key={candidate.id}
                                    className="flex items-center justify-between gap-4 p-2.5 rounded-md border border-secondary-200 dark:border-secondary-800 bg-white dark:bg-secondary-950"
                                  >
                                    <div className="text-xs">
                                      <div className="font-medium text-secondary-900 dark:text-secondary-50">
                                        {candidate.accountCode} · {candidate.accountName}
                                      </div>
                                      <div className="text-secondary-500">
                                        {new Date(candidate.transactionDate).toLocaleDateString()} — {candidate.description || "No description"}
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-3 shrink-0">
                                      <span className="text-xs font-semibold text-secondary-900 dark:text-secondary-50">
                                        {formatCurrency(Math.abs(candidate.debit - candidate.credit), tx.bankAccount?.currency)}
                                      </span>
                                      <Button
                                        variant="primary"
                                        size="sm"
                                        className="text-xs"
                                        disabled={confirmingLedgerId === candidate.id}
                                        onClick={() => handleConfirmMatch(tx.id, candidate.id)}
                                      >
                                        {confirmingLedgerId === candidate.id ? "Confirming..." : "Confirm Match"}
                                      </Button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })()}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

    </div>
  );
}
