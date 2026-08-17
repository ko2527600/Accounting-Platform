import { useState, useEffect, useCallback } from "react";
import { Target, PlusCircle } from "lucide-react";
import { useAccounts } from "../../hooks/useAccounts";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../../components/ui/Card";
import { api } from "../../lib/api";
import { useTenantSettings } from "../../contexts/TenantSettingsContext";
import { UpgradeRequired } from "../../components/UpgradeRequired";

interface FiscalPeriod {
  id: string;
  name: string;
  fiscalYear: number;
  periodNumber: number;
}

interface Budget {
  id: string;
  accountId: string;
  fiscalPeriodId: string;
  budgetAmount: string;
  actualAmount: string;
  variance: string;
}

export function Budgets() {
  const { accounts } = useAccounts();
  const { settings: tenantSettings, isLoading: isLoadingTenantSettings } = useTenantSettings();
  const [periods, setPeriods] = useState<FiscalPeriod[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState("");
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const [form, setForm] = useState({ accountId: "", budgetAmount: "" });

  const fetchPeriods = useCallback(async () => {
    const res = await api.get("/fiscal-periods");
    const list = res.data?.data?.fiscalPeriods || [];
    setPeriods(list);
    if (list.length > 0 && !selectedPeriodId) {
      setSelectedPeriodId(list[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchBudgets = useCallback(async (periodId: string) => {
    if (!periodId) {
      setBudgets([]);
      return;
    }
    setIsLoading(true);
    try {
      const res = await api.get("/budgets", { params: { fiscalPeriodId: periodId } });
      setBudgets(res.data?.data?.budgets || []);
    } catch (err) {
      console.error("Failed to load budgets:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPeriods();
  }, [fetchPeriods]);

  useEffect(() => {
    if (!isLoadingTenantSettings && tenantSettings.tier >= 2) {
      fetchBudgets(selectedPeriodId);
    } else if (!isLoadingTenantSettings) {
      setIsLoading(false);
    }
  }, [selectedPeriodId, fetchBudgets, isLoadingTenantSettings, tenantSettings.tier]);

  const accountName = (id: string) => accounts.find((a: any) => a.id === id)?.name || id;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    try {
      await api.post("/budgets", {
        accountId: form.accountId,
        fiscalPeriodId: selectedPeriodId,
        budgetAmount: Number(form.budgetAmount),
      });
      setForm({ accountId: "", budgetAmount: "" });
      setMessage("✅ Budget created.");
      fetchBudgets(selectedPeriodId);
    } catch (err: any) {
      setMessage(`❌ ${err.response?.data?.error || "Failed to create budget."}`);
    }
  };

  if (!isLoadingTenantSettings && tenantSettings.tier < 2) {
    return <UpgradeRequired featureLabel="Budgets" requiredTier={2} currentTier={tenantSettings.tier} />;
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-4xl mx-auto">
      <div>
        <h2 className="text-3xl font-bold tracking-tight text-secondary-900 dark:text-secondary-50">Budgets</h2>
        <p className="text-secondary-500 dark:text-secondary-400 mt-1">
          Budget vs. actual, computed live from real ledger activity for the selected fiscal period.
        </p>
      </div>

      {message && (
        <div className="p-3 bg-secondary-50 dark:bg-secondary-900 border border-secondary-200 dark:border-secondary-800 rounded-lg text-xs">
          {message}
        </div>
      )}

      <div className="space-y-2 max-w-xs">
        <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Fiscal Period</label>
        <select
          className="w-full h-10 px-3 rounded-md border border-secondary-300 bg-white dark:bg-secondary-800 text-secondary-900 dark:text-secondary-50 text-sm"
          value={selectedPeriodId}
          onChange={(e) => setSelectedPeriodId(e.target.value)}
        >
          {periods.map((p) => (
            <option key={p.id} value={p.id}>{p.name} (FY{p.fiscalYear} P{p.periodNumber})</option>
          ))}
        </select>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <Target className="mr-2 h-5 w-5 text-primary-600" />
            Budget vs. Actual
          </CardTitle>
          <CardDescription>Actual and variance are recomputed from real ledger postings on every load.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-xs text-secondary-500 py-4 text-center">Loading budgets...</div>
          ) : budgets.length === 0 ? (
            <div className="text-xs text-secondary-500 py-4 text-center">No budgets set for this period yet.</div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-secondary-500 border-b border-secondary-200 dark:border-secondary-800">
                  <th className="py-2">Account</th>
                  <th className="py-2">Budget</th>
                  <th className="py-2">Actual</th>
                  <th className="py-2">Variance</th>
                </tr>
              </thead>
              <tbody>
                {budgets.map((b) => (
                  <tr key={b.id} className="border-b border-secondary-100 dark:border-secondary-800">
                    <td className="py-2">{accountName(b.accountId)}</td>
                    <td className="py-2">{Number(b.budgetAmount).toFixed(2)}</td>
                    <td className="py-2">{Number(b.actualAmount).toFixed(2)}</td>
                    <td className={`py-2 font-semibold ${Number(b.variance) < 0 ? "text-red-600" : "text-emerald-600"}`}>
                      {Number(b.variance).toFixed(2)}
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
              Add a Budget Line
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Account</label>
              <select
                className="w-full h-10 px-3 rounded-md border border-secondary-300 bg-white dark:bg-secondary-800 text-secondary-900 dark:text-secondary-50 text-sm"
                value={form.accountId}
                onChange={(e) => setForm({ ...form, accountId: e.target.value })}
                required
              >
                <option value="">-- Choose Account --</option>
                {accounts.map((a: any) => (
                  <option key={a.id} value={a.id}>{a.code} - {a.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Budget Amount</label>
              <Input type="number" step="0.01" value={form.budgetAmount} onChange={(e) => setForm({ ...form, budgetAmount: e.target.value })} required />
            </div>
          </CardContent>
          <CardFooter>
            <Button type="submit" variant="primary" disabled={!selectedPeriodId}>Add Budget Line</Button>
          </CardFooter>
        </Card>
      </form>
    </div>
  );
}
