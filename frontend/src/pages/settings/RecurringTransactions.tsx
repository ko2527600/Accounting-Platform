import { useState, useEffect, useCallback } from "react";
import { Repeat, PlusCircle, Trash2 } from "lucide-react";
import { useAccounts } from "../../hooks/useAccounts";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../../components/ui/Card";
import { api } from "../../lib/api";
import { useTenantSettings } from "../../contexts/TenantSettingsContext";
import { UpgradeRequired } from "../../components/UpgradeRequired";

interface RecurringTransaction {
  id: string;
  name: string;
  frequency: string;
  startDate: string;
  nextRun: string;
  lastRun: string | null;
  isActive: boolean;
}

export function RecurringTransactions() {
  const { accounts } = useAccounts();
  const { settings: tenantSettings, isLoading: isLoadingTenantSettings } = useTenantSettings();
  const [items, setItems] = useState<RecurringTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: "",
    frequency: "MONTHLY",
    startDate: new Date().toISOString().split("T")[0],
    debitAccountId: "",
    creditAccountId: "",
    amount: "",
    description: "",
  });

  const fetchItems = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.get("/recurring-transactions");
      setItems(res.data?.data?.recurringTransactions || []);
    } catch (err) {
      console.error("Failed to load recurring transactions:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isLoadingTenantSettings && tenantSettings.tier >= 2) {
      fetchItems();
    } else if (!isLoadingTenantSettings) {
      setIsLoading(false);
    }
  }, [fetchItems, isLoadingTenantSettings, tenantSettings.tier]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    const amount = Number(form.amount);
    try {
      await api.post("/recurring-transactions", {
        name: form.name,
        frequency: form.frequency,
        startDate: form.startDate,
        templateData: {
          description: form.description || form.name,
          lines: [
            { accountId: form.debitAccountId, debit: amount, credit: 0 },
            { accountId: form.creditAccountId, debit: 0, credit: amount },
          ],
        },
      });
      setMessage("✅ Recurring transaction created.");
      setForm({ ...form, name: "", amount: "", description: "" });
      fetchItems();
    } catch (err: any) {
      setMessage(`❌ ${err.response?.data?.error || "Failed to create recurring transaction."}`);
    }
  };

  const handleDelete = async (id: string) => {
    setMessage(null);
    try {
      await api.delete(`/recurring-transactions/${id}`);
      fetchItems();
    } catch (err: any) {
      setMessage(`❌ ${err.response?.data?.error || "Failed to delete recurring transaction."}`);
    }
  };

  if (!isLoadingTenantSettings && tenantSettings.tier < 2) {
    return <UpgradeRequired featureLabel="Recurring Transactions" requiredTier={2} currentTier={tenantSettings.tier} />;
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-4xl mx-auto">
      <div>
        <h2 className="text-3xl font-bold tracking-tight text-secondary-900 dark:text-secondary-50">Recurring Transactions</h2>
        <p className="text-secondary-500 dark:text-secondary-400 mt-1">
          Automatically generate real journal entries on a schedule (rent, subscriptions, depreciation, etc.).
        </p>
      </div>

      {message && (
        <div className="p-3 bg-secondary-50 dark:bg-secondary-900 border border-secondary-200 dark:border-secondary-800 rounded-lg text-xs">
          {message}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <Repeat className="mr-2 h-5 w-5 text-primary-600" />
            Scheduled Transactions
          </CardTitle>
          <CardDescription>Checked hourly - a due row automatically posts a real journal entry.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-xs text-secondary-500 py-4 text-center">Loading...</div>
          ) : items.length === 0 ? (
            <div className="text-xs text-secondary-500 py-4 text-center">No recurring transactions set up yet.</div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-secondary-500 border-b border-secondary-200 dark:border-secondary-800">
                  <th className="py-2">Name</th>
                  <th className="py-2">Frequency</th>
                  <th className="py-2">Next Run</th>
                  <th className="py-2">Last Run</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-b border-secondary-100 dark:border-secondary-800">
                    <td className="py-2">{item.name}</td>
                    <td className="py-2">{item.frequency}</td>
                    <td className="py-2">{new Date(item.nextRun).toLocaleDateString()}</td>
                    <td className="py-2">{item.lastRun ? new Date(item.lastRun).toLocaleDateString() : "Never"}</td>
                    <td className="py-2 text-right">
                      <button onClick={() => handleDelete(item.id)} className="text-red-500 hover:text-red-700" title="Delete">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <form onSubmit={handleCreate}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <PlusCircle className="mr-2 h-5 w-5 text-primary-600" />
              Add a Recurring Transaction
            </CardTitle>
            <CardDescription>Debits the first account and credits the second for the given amount, on each cycle.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Name</label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Monthly Rent" required />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Frequency</label>
              <select
                className="w-full h-10 px-3 rounded-md border border-secondary-300 bg-white dark:bg-secondary-800 text-secondary-900 dark:text-secondary-50 text-sm"
                value={form.frequency}
                onChange={(e) => setForm({ ...form, frequency: e.target.value })}
              >
                <option value="DAILY">Daily</option>
                <option value="WEEKLY">Weekly</option>
                <option value="MONTHLY">Monthly</option>
                <option value="QUARTERLY">Quarterly</option>
                <option value="YEARLY">Yearly</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Start Date</label>
              <Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} required />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Amount</label>
              <Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Debit Account (Expense)</label>
              <select
                className="w-full h-10 px-3 rounded-md border border-secondary-300 bg-white dark:bg-secondary-800 text-secondary-900 dark:text-secondary-50 text-sm"
                value={form.debitAccountId}
                onChange={(e) => setForm({ ...form, debitAccountId: e.target.value })}
                required
              >
                <option value="">-- Choose Account --</option>
                {accounts.map((a: any) => (
                  <option key={a.id} value={a.id}>{a.code} - {a.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Credit Account (Cash/Bank)</label>
              <select
                className="w-full h-10 px-3 rounded-md border border-secondary-300 bg-white dark:bg-secondary-800 text-secondary-900 dark:text-secondary-50 text-sm"
                value={form.creditAccountId}
                onChange={(e) => setForm({ ...form, creditAccountId: e.target.value })}
                required
              >
                <option value="">-- Choose Account --</option>
                {accounts.map((a: any) => (
                  <option key={a.id} value={a.id}>{a.code} - {a.name}</option>
                ))}
              </select>
            </div>
          </CardContent>
          <CardFooter>
            <Button type="submit" variant="primary">Add Recurring Transaction</Button>
          </CardFooter>
        </Card>
      </form>
    </div>
  );
}
