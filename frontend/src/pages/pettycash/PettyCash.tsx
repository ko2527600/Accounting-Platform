import { useState, useEffect, useCallback } from "react";
import { Plus, Wallet, ArrowDownCircle, ArrowUpCircle } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "../../components/ui/Card";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "../../components/ui/Table";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Modal } from "../../components/ui/Modal";
import { useTenantSettings } from "../../hooks/useTenantSettings";
import { useToast } from "../../contexts/ToastContext";
import { api } from "../../lib/api";

interface AccountOption {
  id: string;
  code: string;
  name: string;
  type: string;
}

interface PettyCashEntryRow {
  id: string;
  entryDate: string;
  direction: "DISBURSEMENT" | "REPLENISHMENT";
  description: string;
  amount: number;
  runningBalance: number;
  recordedByEmail: string | null;
}

// Ad-hoc minor office cash disbursements/replenishments, distinct from POS
// sales and employee expense-claim reimbursement. Every entry is a real
// posted journal entry (see pettyCashService.ts) - this page is a log/UI
// layer over that, not a second balance. A tenant picks which real Asset
// account is "the petty cash tin" from their own Chart of Accounts (lets a
// business with multiple locations run more than one tin).
export function PettyCash() {
  const { settings } = useTenantSettings();
  const { showToast } = useToast();
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [pettyCashAccountId, setPettyCashAccountId] = useState("");
  const [entries, setEntries] = useState<PettyCashEntryRow[]>([]);
  const [currentBalance, setCurrentBalance] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [direction, setDirection] = useState<"DISBURSEMENT" | "REPLENISHMENT">("DISBURSEMENT");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [counterAccountId, setCounterAccountId] = useState("");

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: settings.baseCurrency }).format(value);

  useEffect(() => {
    api.get("/accounts").then((res) => {
      if (res.data.success) {
        const list: AccountOption[] = res.data.data.accounts;
        setAccounts(list);
        const firstAsset = list.find((a) => a.type === "ASSET");
        if (firstAsset) setPettyCashAccountId(firstAsset.id);
      }
    });
  }, []);

  const fetchEntries = useCallback(async () => {
    if (!pettyCashAccountId) return;
    setIsLoading(true);
    try {
      const res = await api.get("/petty-cash", { params: { accountId: pettyCashAccountId } });
      if (res.data.success) {
        setEntries(res.data.data.entries);
        setCurrentBalance(res.data.data.currentBalance);
      }
    } catch (err) {
      console.error("Failed to fetch petty cash entries:", err);
    } finally {
      setIsLoading(false);
    }
  }, [pettyCashAccountId]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!counterAccountId) {
      showToast(direction === "DISBURSEMENT" ? "Select which expense account this was spent on." : "Select which account funded this top-up.", "error");
      return;
    }
    try {
      const res = await api.post("/petty-cash", {
        direction,
        description,
        amount: Number(amount),
        pettyCashAccountId,
        counterAccountId,
      });
      if (res.data.success) {
        showToast("Petty cash entry recorded.", "success");
        setDescription("");
        setAmount("");
        setCounterAccountId("");
        setIsModalOpen(false);
        fetchEntries();
      }
    } catch (err: any) {
      showToast(err.response?.data?.error || "Failed to record entry.", "error");
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-secondary-900 dark:text-secondary-50">Petty Cash</h2>
          <p className="text-secondary-500 dark:text-secondary-400 mt-1">
            Ad-hoc minor office cash - every entry posts a real journal entry immediately.
          </p>
        </div>
        <Button variant="primary" onClick={() => setIsModalOpen(true)} className="flex items-center">
          <Plus className="mr-2 h-4 w-4" />
          Record Entry
        </Button>
      </div>

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-secondary-500">Petty Cash Account</CardTitle>
          </CardHeader>
          <CardContent>
            <select
              className="w-full h-9 rounded-md border border-secondary-300 bg-white px-3 text-sm dark:border-secondary-700 dark:bg-secondary-800"
              value={pettyCashAccountId}
              onChange={(e) => setPettyCashAccountId(e.target.value)}
            >
              {accounts.filter((a) => a.type === "ASSET").map((a) => (
                <option key={a.id} value={a.id}>{a.code} - {a.name}</option>
              ))}
            </select>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-secondary-500">Current Balance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-primary-600 dark:text-primary-400 flex items-center gap-2">
              <Wallet className="h-5 w-5" />
              {formatCurrency(currentBalance)}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Entry History</CardTitle>
          <CardDescription>Oldest first, with a running balance for this account.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-8 text-center text-secondary-500">Loading...</div>
          ) : entries.length === 0 ? (
            <div className="py-12 text-center text-secondary-500 text-sm">No petty cash entries yet for this account.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Recorded By</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Running Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-xs text-secondary-500">{new Date(e.entryDate).toLocaleDateString()}</TableCell>
                    <TableCell>
                      {e.direction === "DISBURSEMENT" ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 dark:text-red-400">
                          <ArrowDownCircle className="h-3.5 w-3.5" /> Disbursement
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                          <ArrowUpCircle className="h-3.5 w-3.5" /> Replenishment
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{e.description}</TableCell>
                    <TableCell className="text-xs text-secondary-500">{e.recordedByEmail || "-"}</TableCell>
                    <TableCell className={e.direction === "DISBURSEMENT" ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}>
                      {e.direction === "DISBURSEMENT" ? "-" : "+"}{formatCurrency(e.amount)}
                    </TableCell>
                    <TableCell className="font-semibold">{formatCurrency(e.runningBalance)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Record Petty Cash Entry">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex gap-2">
            <Button type="button" variant={direction === "DISBURSEMENT" ? "primary" : "outline"} onClick={() => setDirection("DISBURSEMENT")} className="flex-1">
              Disbursement
            </Button>
            <Button type="button" variant={direction === "REPLENISHMENT" ? "primary" : "outline"} onClick={() => setDirection("REPLENISHMENT")} className="flex-1">
              Replenishment
            </Button>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <Input required placeholder={direction === "DISBURSEMENT" ? "e.g. Office cleaning supplies" : "e.g. Top-up from bank"} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Amount</label>
            <Input type="number" min="0.01" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">
              {direction === "DISBURSEMENT" ? "Expense Account (what was this spent on?)" : "Funding Account (where did the top-up come from?)"}
            </label>
            <select
              required
              className="w-full h-9 rounded-md border border-secondary-300 bg-white px-3 text-sm dark:border-secondary-700 dark:bg-secondary-800"
              value={counterAccountId}
              onChange={(e) => setCounterAccountId(e.target.value)}
            >
              <option value="">-- Select Account --</option>
              {accounts.filter((a) => a.id !== pettyCashAccountId).map((a) => (
                <option key={a.id} value={a.id}>{a.code} - {a.name} ({a.type})</option>
              ))}
            </select>
          </div>
          <div className="flex justify-end space-x-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary">Record</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
