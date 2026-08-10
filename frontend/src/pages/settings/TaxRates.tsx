import { useState, useEffect, useCallback, useMemo } from "react";
import { Percent, Trash2, PlusCircle, Layers, Sparkles, ShieldCheck } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../../components/ui/Card";
import { api } from "../../lib/api";
import { useAccounts } from "../../hooks/useAccounts";

interface TaxRateComponent {
  name: string;
  rate: number;
  accountId?: string;
}

interface TaxRate {
  id: string;
  name: string;
  code: string;
  rate: string;
  isActive: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  accountId?: string | null;
  components: TaxRateComponent[] | null;
}

interface ComponentRow {
  name: string;
  ratePercent: string;
  accountId: string;
}

interface ComplianceUpdate {
  source: string;
  area: string;
  description: string;
  verifiedAt: string;
}

const GHANA_VAT_PRESET: ComponentRow[] = [
  { name: "VAT", ratePercent: "15", accountId: "" },
  { name: "NHIL", ratePercent: "2.5", accountId: "" },
  { name: "GETFund Levy", ratePercent: "2.5", accountId: "" },
];

export function TaxRates() {
  const { accounts } = useAccounts();
  const [taxRates, setTaxRates] = useState<TaxRate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const [isLayered, setIsLayered] = useState(false);
  const [componentRows, setComponentRows] = useState<ComponentRow[]>([{ name: "", ratePercent: "", accountId: "" }]);

  const [form, setForm] = useState({
    name: "",
    code: "",
    ratePercent: "",
    accountId: "",
    effectiveFrom: new Date().toISOString().split("T")[0],
  });

  // Liability-type accounts (where a tax-collected-on-behalf-of-government
  // levy typically belongs) sorted first as a visual hint - not a hard
  // filter, since a tenant may legitimately want to post to any account.
  const sortedAccounts = useMemo(() => {
    return [...accounts].sort((a, b) => {
      const aLiability = a.type === "Liability" ? 0 : 1;
      const bLiability = b.type === "Liability" ? 0 : 1;
      if (aLiability !== bLiability) return aLiability - bLiability;
      return a.code.localeCompare(b.code);
    });
  }, [accounts]);

  const accountLabelById = useMemo(() => {
    const map = new Map<string, string>();
    accounts.forEach((a) => map.set(a.id, `${a.code} - ${a.name}`));
    return map;
  }, [accounts]);

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

  const [complianceUpdate, setComplianceUpdate] = useState<ComplianceUpdate | null>(null);
  useEffect(() => {
    api
      .get("/compliance/last-update")
      .then((res) => setComplianceUpdate(res.data?.data || null))
      .catch(() => setComplianceUpdate(null));
  }, []);

  const componentsTotalPercent = componentRows.reduce((sum, r) => sum + (Number(r.ratePercent) || 0), 0);

  const applyGhanaPreset = () => {
    setIsLayered(true);
    setComponentRows(GHANA_VAT_PRESET);
    setForm({ ...form, name: form.name || "Ghana Standard VAT", code: form.code || "GH-VAT-STD" });
  };

  const addComponentRow = () => setComponentRows([...componentRows, { name: "", ratePercent: "", accountId: "" }]);
  const removeComponentRow = (idx: number) => setComponentRows(componentRows.filter((_, i) => i !== idx));
  const updateComponentRow = (idx: number, field: keyof ComponentRow, value: string) => {
    const next = [...componentRows];
    next[idx] = { ...next[idx], [field]: value };
    setComponentRows(next);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    const rate = isLayered ? componentsTotalPercent / 100 : Number(form.ratePercent) / 100;
    const components = isLayered
      ? componentRows
          .filter((r) => r.name.trim() && Number(r.ratePercent) > 0)
          .map((r) => ({
            name: r.name.trim(),
            rate: Number(r.ratePercent) / 100,
            ...(r.accountId ? { accountId: r.accountId } : {}),
          }))
      : undefined;

    try {
      await api.post("/tax-rates", {
        name: form.name,
        code: form.code,
        rate,
        effectiveFrom: form.effectiveFrom,
        ...(!isLayered && form.accountId ? { accountId: form.accountId } : {}),
        ...(components ? { components } : {}),
      });
      setForm({ name: "", code: "", ratePercent: "", accountId: "", effectiveFrom: new Date().toISOString().split("T")[0] });
      setIsLayered(false);
      setComponentRows([{ name: "", ratePercent: "", accountId: "" }]);
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

      {complianceUpdate && (
        <div className="flex items-start gap-2 p-3 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900 rounded-lg text-xs text-emerald-900 dark:text-emerald-300">
          <ShieldCheck className="h-4 w-4 mt-0.5 flex-shrink-0 text-emerald-600" />
          <div>
            <span className="font-semibold">
              Last compliance update: {new Date(complianceUpdate.verifiedAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
            </span>
            <span className="text-emerald-700 dark:text-emerald-400">
              {" "}
              - {complianceUpdate.area} verified against {complianceUpdate.source}.
            </span>
          </div>
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
                    <td className="py-2">
                      <div>{tr.name}</div>
                      {tr.components && tr.components.length > 0 ? (
                        <div className="text-secondary-400 mt-0.5 space-y-0.5">
                          {tr.components.map((c, i) => (
                            <div key={i}>
                              {c.name} {(c.rate * 100).toFixed(2)}%
                              {c.accountId && (
                                <span className="text-secondary-400"> &rarr; {accountLabelById.get(c.accountId) || "Unknown account"}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        tr.accountId && (
                          <div className="text-secondary-400 mt-0.5">
                            &rarr; {accountLabelById.get(tr.accountId) || "Unknown account"}
                          </div>
                        )
                      )}
                    </td>
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
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center">
                <PlusCircle className="mr-2 h-5 w-5 text-primary-600" />
                Add a Tax Rate
              </span>
              <Button type="button" variant="outline" size="sm" onClick={applyGhanaPreset} className="text-xs">
                <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                Use Ghana VAT Preset (20%)
              </Button>
            </CardTitle>
            <CardDescription>
              A simple rate is a single percentage. A layered rate breaks the total down into named levies (e.g.
              Ghana's VAT + NHIL + GETFund) so invoices can show what each one actually charged.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
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
                <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Effective From</label>
                <Input
                  type="date"
                  value={form.effectiveFrom}
                  onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })}
                  required
                />
              </div>
              {!isLayered && (
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
              )}
              {!isLayered && (
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">
                    Post collected tax to (optional)
                  </label>
                  <select
                    className="w-full h-9 rounded-md border border-secondary-200 dark:border-secondary-800 bg-white dark:bg-secondary-900 px-3 text-sm"
                    value={form.accountId}
                    onChange={(e) => setForm({ ...form, accountId: e.target.value })}
                  >
                    <option value="">No account (post to Revenue)</option>
                    {sortedAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} - {a.name} ({a.type})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setIsLayered(!isLayered)}
              className="flex items-center text-xs font-medium text-primary-600 hover:text-primary-700"
            >
              <Layers className="mr-1.5 h-3.5 w-3.5" />
              {isLayered ? "Switch to a simple single rate" : "Break this down into multiple levies (layered)"}
            </button>

            {isLayered && (
              <div className="space-y-2 p-3 bg-secondary-50 dark:bg-secondary-900 rounded-lg border border-secondary-200 dark:border-secondary-800">
                {componentRows.map((row, idx) => (
                  <div key={idx} className="flex gap-2 items-center">
                    <Input
                      className="flex-1"
                      placeholder="e.g. VAT"
                      value={row.name}
                      onChange={(e) => updateComponentRow(idx, "name", e.target.value)}
                    />
                    <div className="w-24 flex-shrink-0">
                      <Input
                        type="number"
                        step="0.01"
                        min="0.01"
                        placeholder="15"
                        value={row.ratePercent}
                        onChange={(e) => updateComponentRow(idx, "ratePercent", e.target.value)}
                      />
                    </div>
                    <span className="text-xs text-secondary-500">%</span>
                    <select
                      className="w-48 flex-shrink-0 h-9 rounded-md border border-secondary-200 dark:border-secondary-800 bg-white dark:bg-secondary-900 px-2 text-xs"
                      value={row.accountId}
                      onChange={(e) => updateComponentRow(idx, "accountId", e.target.value)}
                    >
                      <option value="">No account (post to Revenue)</option>
                      {sortedAccounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.code} - {a.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => removeComponentRow(idx)}
                      className="text-red-500 hover:text-red-700"
                      title="Remove"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                <div className="flex items-center justify-between pt-1">
                  <button
                    type="button"
                    onClick={addComponentRow}
                    className="text-xs font-medium text-primary-600 hover:text-primary-700"
                  >
                    + Add levy
                  </button>
                  <span className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">
                    Total: {componentsTotalPercent.toFixed(2)}%
                  </span>
                </div>
              </div>
            )}
          </CardContent>
          <CardFooter>
            <Button type="submit" variant="primary" disabled={isLayered && componentsTotalPercent <= 0}>
              Add Tax Rate
            </Button>
          </CardFooter>
        </Card>
      </form>
    </div>
  );
}
