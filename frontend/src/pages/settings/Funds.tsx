import { useState, useEffect, useCallback } from "react";
import { Landmark, Trash2, PlusCircle } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../../components/ui/Card";
import { api } from "../../lib/api";

interface Fund {
  id: string;
  name: string;
  code: string;
  description: string | null;
  isRestricted: boolean;
  isActive: boolean;
}

export function Funds() {
  const [funds, setFunds] = useState<Fund[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: "",
    code: "",
    description: "",
    isRestricted: true,
  });

  const fetchFunds = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.get("/funds");
      setFunds(res.data?.data?.funds || []);
    } catch (err) {
      console.error("Failed to load funds:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFunds();
  }, [fetchFunds]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    try {
      await api.post("/funds", {
        name: form.name,
        code: form.code,
        description: form.description || undefined,
        isRestricted: form.isRestricted,
      });
      setForm({ name: "", code: "", description: "", isRestricted: true });
      setMessage("✅ Fund created.");
      fetchFunds();
    } catch (err: any) {
      setMessage(`❌ ${err.response?.data?.error || "Failed to create fund."}`);
    }
  };

  const handleDeactivate = async (fund: Fund) => {
    setMessage(null);
    try {
      await api.put(`/funds/${fund.id}`, { isActive: false });
      fetchFunds();
    } catch (err: any) {
      setMessage(`❌ ${err.response?.data?.error || "Failed to deactivate fund."}`);
    }
  };

  const handleDelete = async (id: string) => {
    setMessage(null);
    try {
      await api.delete(`/funds/${id}`);
      fetchFunds();
    } catch (err: any) {
      setMessage(`❌ ${err.response?.data?.error || "Failed to delete fund."}`);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-4xl mx-auto">
      <div>
        <h2 className="text-3xl font-bold tracking-tight text-secondary-900 dark:text-secondary-50">Funds</h2>
        <p className="text-secondary-500 dark:text-secondary-400 mt-1">
          Track restricted and unrestricted donor funds (e.g. a "Building Fund" grant) separately from your general
          operating money. Invoices, vendor bills, and journal vouchers can each be tagged to a fund, and the
          Balance Sheet / P&amp;L reports can be filtered to show just one fund's activity.
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
            <Landmark className="mr-2 h-5 w-5 text-primary-600" />
            Funds
          </CardTitle>
          <CardDescription>Any invoice/bill/journal voucher can optionally be tagged to one of these.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-xs text-secondary-500 py-4 text-center">Loading funds...</div>
          ) : funds.length === 0 ? (
            <div className="text-xs text-secondary-500 py-4 text-center">
              No funds configured yet - transactions won't be tagged to any fund until one is added.
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-secondary-500 border-b border-secondary-200 dark:border-secondary-800">
                  <th className="py-2">Name</th>
                  <th className="py-2">Code</th>
                  <th className="py-2">Type</th>
                  <th className="py-2">Status</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {funds.map((fund) => (
                  <tr key={fund.id} className="border-b border-secondary-100 dark:border-secondary-800">
                    <td className="py-2">
                      <div>{fund.name}</div>
                      {fund.description && <div className="text-secondary-400 mt-0.5">{fund.description}</div>}
                    </td>
                    <td className="py-2 font-mono">{fund.code}</td>
                    <td className="py-2">{fund.isRestricted ? "Restricted" : "Unrestricted"}</td>
                    <td className="py-2">
                      <span className={fund.isActive ? "text-emerald-600" : "text-secondary-400"}>
                        {fund.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="py-2 text-right space-x-2">
                      {fund.isActive && (
                        <button
                          onClick={() => handleDeactivate(fund)}
                          className="text-secondary-500 hover:text-secondary-700"
                          title="Deactivate"
                        >
                          Deactivate
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(fund.id)}
                        className="text-red-500 hover:text-red-700"
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5 inline" />
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
              Add a Fund
            </CardTitle>
            <CardDescription>
              A restricted fund is money designated for a specific purpose (a grant, a building campaign). An
              unrestricted fund (e.g. "General Fund") is your normal operating money, tracked separately just to
              give it its own report.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Name</label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Building Fund"
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Code</label>
                <Input
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  placeholder="BUILDING"
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">
                Description (optional)
              </label>
              <Input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Restricted grant for the new roof project"
              />
            </div>
            <div className="flex items-start">
              <input
                id="isRestricted"
                type="checkbox"
                checked={form.isRestricted}
                onChange={(e) => setForm({ ...form, isRestricted: e.target.checked })}
                className="h-4 w-4 mt-0.5 rounded border-secondary-300 text-primary-600 focus:ring-primary-500"
              />
              <label htmlFor="isRestricted" className="ml-2 text-xs text-secondary-600 dark:text-secondary-400">
                Restricted (money must be used for a specific purpose). Uncheck to model an unrestricted general fund.
              </label>
            </div>
          </CardContent>
          <CardFooter>
            <Button type="submit" variant="primary">
              Add Fund
            </Button>
          </CardFooter>
        </Card>
      </form>
    </div>
  );
}
