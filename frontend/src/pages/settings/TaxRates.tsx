import { useState, useEffect, useCallback } from "react";
import { Percent, Trash2, PlusCircle } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../../components/ui/Card";
import { api } from "../../lib/api";

interface TaxRate {
  id: string;
  name: string;
  code: string;
  rate: string;
  isActive: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export function TaxRates() {
  const [taxRates, setTaxRates] = useState<TaxRate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: "",
    code: "",
    ratePercent: "",
    effectiveFrom: new Date().toISOString().split("T")[0],
  });

  const fetchTaxRates = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.get("/tax-rates");
      setTaxRates(res.data?.data?.taxRates || []);
    } catch (err) {
      console.error("Failed to load tax rates:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTaxRates();
  }, [fetchTaxRates]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    const rate = Number(form.ratePercent) / 100;
    try {
      await api.post("/tax-rates", {
        name: form.name,
        code: form.code,
        rate,
        effectiveFrom: form.effectiveFrom,
      });
      setForm({ name: "", code: "", ratePercent: "", effectiveFrom: new Date().toISOString().split("T")[0] });
      setMessage("✅ Tax rate created.");
      fetchTaxRates();
    } catch (err: any) {
      setMessage(`❌ ${err.response?.data?.error || "Failed to create tax rate."}`);
    }
  };

  const handleDelete = async (id: string) => {
    setMessage(null);
    try {
      await api.delete(`/tax-rates/${id}`);
      fetchTaxRates();
    } catch (err: any) {
      setMessage(`❌ ${err.response?.data?.error || "Failed to delete tax rate."}`);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-4xl mx-auto">
      <div>
        <h2 className="text-3xl font-bold tracking-tight text-secondary-900 dark:text-secondary-50">Tax Rates</h2>
        <p className="text-secondary-500 dark:text-secondary-400 mt-1">
          Configure the real tax rates applied to invoices - replaces any hardcoded percentage.
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
            <Percent className="mr-2 h-5 w-5 text-primary-600" />
            Active Tax Rates
          </CardTitle>
          <CardDescription>New invoices use whichever rate is active and effective on the invoice date.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-xs text-secondary-500 py-4 text-center">Loading tax rates...</div>
          ) : taxRates.length === 0 ? (
            <div className="text-xs text-secondary-500 py-4 text-center">
              No tax rates configured yet - invoices will be created with zero tax until one is added.
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-secondary-500 border-b border-secondary-200 dark:border-secondary-800">
                  <th className="py-2">Name</th>
                  <th className="py-2">Code</th>
                  <th className="py-2">Rate</th>
                  <th className="py-2">Effective From</th>
                  <th className="py-2">Status</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {taxRates.map((tr) => (
                  <tr key={tr.id} className="border-b border-secondary-100 dark:border-secondary-800">
                    <td className="py-2">{tr.name}</td>
                    <td className="py-2 font-mono">{tr.code}</td>
                    <td className="py-2">{(Number(tr.rate) * 100).toFixed(2)}%</td>
                    <td className="py-2">{new Date(tr.effectiveFrom).toLocaleDateString()}</td>
                    <td className="py-2">
                      <span className={tr.isActive ? "text-emerald-600" : "text-secondary-400"}>
                        {tr.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="py-2 text-right">
                      <button
                        onClick={() => handleDelete(tr.id)}
                        className="text-red-500 hover:text-red-700"
                        title="Delete"
                      >
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
              Add a Tax Rate
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Name</label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Standard VAT"
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Code</label>
              <Input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder="VAT-STD"
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Rate (%)</label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                max="100"
                value={form.ratePercent}
                onChange={(e) => setForm({ ...form, ratePercent: e.target.value })}
                placeholder="15"
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Effective From</label>
              <Input
                type="date"
                value={form.effectiveFrom}
                onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })}
                required
              />
            </div>
          </CardContent>
          <CardFooter>
            <Button type="submit" variant="primary">Add Tax Rate</Button>
          </CardFooter>
        </Card>
      </form>
    </div>
  );
}
