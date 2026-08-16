import { useState, useEffect, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Modal } from "../../components/ui/Modal";
import { api } from "../../lib/api";
import { useToast } from "../../contexts/ToastContext";
import { useAccounts } from "../../hooks/useAccounts";
import { Plus, Landmark } from "lucide-react";

interface DepreciationEntry {
  id: string;
  period: string;
  amount: string | number;
  netBookValueAfter: string | number;
  createdAt: string;
}

interface FixedAsset {
  id: string;
  name: string;
  category: string | null;
  serialNumber: string | null;
  acquisitionDate: string;
  cost: string | number;
  residualValue: string | number;
  depreciationMethod: "STRAIGHT_LINE" | "REDUCING_BALANCE";
  usefulLifeMonths: number | null;
  depreciationRatePercent: string | number | null;
  accumulatedDepreciation: string | number;
  status: "ACTIVE" | "FULLY_DEPRECIATED" | "DISPOSED";
  disposalDate: string | null;
  depreciationEntries?: DepreciationEntry[];
}

const emptyForm = {
  name: "",
  category: "",
  serialNumber: "",
  acquisitionDate: new Date().toISOString().split("T")[0],
  cost: "",
  residualValue: "0",
  depreciationMethod: "STRAIGHT_LINE" as "STRAIGHT_LINE" | "REDUCING_BALANCE",
  usefulLifeMonths: "36",
  depreciationRatePercent: "20",
  assetAccountId: "",
  paymentAccountId: "",
  notes: "",
};

function statusBadge(status: FixedAsset["status"]) {
  const map: Record<FixedAsset["status"], string> = {
    ACTIVE: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
    FULLY_DEPRECIATED: "bg-secondary-100 text-secondary-700 dark:bg-secondary-800 dark:text-secondary-300",
    DISPOSED: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  };
  const label: Record<FixedAsset["status"], string> = {
    ACTIVE: "Active",
    FULLY_DEPRECIATED: "Fully Depreciated",
    DISPOSED: "Disposed",
  };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${map[status]}`}>{label[status]}</span>;
}

export function FixedAssets() {
  const { showToast } = useToast();
  const { accounts } = useAccounts();
  const [assets, setAssets] = useState<FixedAsset[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [detailAsset, setDetailAsset] = useState<FixedAsset | null>(null);
  const [disposeAsset, setDisposeAsset] = useState<FixedAsset | null>(null);
  const [disposalDate, setDisposalDate] = useState(new Date().toISOString().split("T")[0]);
  const [disposalNotes, setDisposalNotes] = useState("");
  const [isDisposing, setIsDisposing] = useState(false);

  const fetchAssets = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.get("/fixed-assets");
      setAssets(res.data?.data?.assets || []);
    } catch (err) {
      console.error("Failed to load fixed assets:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAssets();
  }, [fetchAssets]);

  const openDetail = async (asset: FixedAsset) => {
    try {
      const res = await api.get(`/fixed-assets/${asset.id}`);
      setDetailAsset(res.data.data.asset);
    } catch (err) {
      showToast("Failed to load depreciation schedule.", "error");
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await api.post("/fixed-assets", {
        name: form.name,
        category: form.category || undefined,
        serialNumber: form.serialNumber || undefined,
        acquisitionDate: form.acquisitionDate,
        cost: Number(form.cost),
        residualValue: Number(form.residualValue),
        depreciationMethod: form.depreciationMethod,
        usefulLifeMonths: form.depreciationMethod === "STRAIGHT_LINE" ? Number(form.usefulLifeMonths) : undefined,
        depreciationRatePercent: form.depreciationMethod === "REDUCING_BALANCE" ? Number(form.depreciationRatePercent) : undefined,
        assetAccountId: form.assetAccountId,
        paymentAccountId: form.paymentAccountId,
        notes: form.notes || undefined,
      });
      showToast("Fixed asset created and acquisition posted.", "success");
      setIsAddOpen(false);
      setForm(emptyForm);
      fetchAssets();
    } catch (err: any) {
      showToast(err.response?.data?.error || "Failed to create fixed asset.", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDispose = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!disposeAsset) return;
    setIsDisposing(true);
    try {
      await api.put(`/fixed-assets/${disposeAsset.id}/dispose`, { disposalDate, notes: disposalNotes });
      showToast("Fixed asset marked disposed.", "success");
      setDisposeAsset(null);
      setDisposalNotes("");
      fetchAssets();
    } catch (err: any) {
      showToast(err.response?.data?.error || "Failed to dispose fixed asset.", "error");
    } finally {
      setIsDisposing(false);
    }
  };

  const netBookValue = (a: FixedAsset) => Number(a.cost) - Number(a.accumulatedDepreciation);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-secondary-900 dark:text-secondary-50">Fixed Assets</h2>
          <p className="text-secondary-500 dark:text-secondary-400 mt-1">
            Register long-lived assets (vehicles, equipment, furniture) and post real monthly depreciation automatically.
          </p>
        </div>
        <Button variant="primary" onClick={() => setIsAddOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Fixed Asset
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <Landmark className="mr-2 h-5 w-5 text-primary-600" />
            Asset Register
          </CardTitle>
          <CardDescription>Depreciation posts automatically each month a due asset is checked (daily sweep).</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-xs text-secondary-500 py-4 text-center">Loading...</div>
          ) : assets.length === 0 ? (
            <div className="text-xs text-secondary-500 py-4 text-center">No fixed assets registered yet.</div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-secondary-500 border-b border-secondary-200 dark:border-secondary-800">
                  <th className="py-2">Name</th>
                  <th className="py-2">Category</th>
                  <th className="py-2">Cost</th>
                  <th className="py-2">Accum. Depreciation</th>
                  <th className="py-2">Net Book Value</th>
                  <th className="py-2">Method</th>
                  <th className="py-2">Status</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {assets.map((a) => (
                  <tr key={a.id} className="border-b border-secondary-100 dark:border-secondary-800">
                    <td className="py-2">
                      <button className="text-primary-600 hover:underline" onClick={() => openDetail(a)}>{a.name}</button>
                    </td>
                    <td className="py-2">{a.category || "-"}</td>
                    <td className="py-2">{Number(a.cost).toFixed(2)}</td>
                    <td className="py-2">{Number(a.accumulatedDepreciation).toFixed(2)}</td>
                    <td className="py-2">{netBookValue(a).toFixed(2)}</td>
                    <td className="py-2">{a.depreciationMethod === "STRAIGHT_LINE" ? "Straight-Line" : "Reducing Balance"}</td>
                    <td className="py-2">{statusBadge(a.status)}</td>
                    <td className="py-2 text-right">
                      {a.status !== "DISPOSED" && (
                        <button
                          onClick={() => setDisposeAsset(a)}
                          className="text-red-500 hover:text-red-700 text-xs font-semibold"
                        >
                          Dispose
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Add Fixed Asset Modal */}
      <Modal isOpen={isAddOpen} onClose={() => setIsAddOpen(false)} title="Add Fixed Asset" description="Posts the acquisition journal entry immediately (Debit the asset account, Credit the payment account for the full cost).">
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Name</label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Toyota Hilux" required />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Category (optional)</label>
              <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Vehicles" />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Serial / Registration No. (optional)</label>
              <Input value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })} />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Acquisition Date</label>
              <Input type="date" value={form.acquisitionDate} onChange={(e) => setForm({ ...form, acquisitionDate: e.target.value })} required />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Cost</label>
              <Input type="number" step="0.01" min="0.01" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} required />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Residual Value</label>
              <Input type="number" step="0.01" min="0" value={form.residualValue} onChange={(e) => setForm({ ...form, residualValue: e.target.value })} required />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Depreciation Method</label>
              <select
                className="w-full h-10 px-3 rounded-md border border-secondary-300 bg-white dark:bg-secondary-800 text-secondary-900 dark:text-secondary-50 text-sm"
                value={form.depreciationMethod}
                onChange={(e) => setForm({ ...form, depreciationMethod: e.target.value as "STRAIGHT_LINE" | "REDUCING_BALANCE" })}
              >
                <option value="STRAIGHT_LINE">Straight-Line</option>
                <option value="REDUCING_BALANCE">Reducing Balance</option>
              </select>
            </div>
            {form.depreciationMethod === "STRAIGHT_LINE" ? (
              <div className="space-y-2">
                <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Useful Life (months)</label>
                <Input type="number" min="1" value={form.usefulLifeMonths} onChange={(e) => setForm({ ...form, usefulLifeMonths: e.target.value })} required />
              </div>
            ) : (
              <div className="space-y-2">
                <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Annual Depreciation Rate (%)</label>
                <Input type="number" min="0.01" max="100" step="0.01" value={form.depreciationRatePercent} onChange={(e) => setForm({ ...form, depreciationRatePercent: e.target.value })} required />
              </div>
            )}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Asset Account (at cost)</label>
              <select
                className="w-full h-10 px-3 rounded-md border border-secondary-300 bg-white dark:bg-secondary-800 text-secondary-900 dark:text-secondary-50 text-sm"
                value={form.assetAccountId}
                onChange={(e) => setForm({ ...form, assetAccountId: e.target.value })}
                required
              >
                <option value="">-- Choose Account --</option>
                {accounts.filter((a: any) => a.type === "Asset").map((a: any) => (
                  <option key={a.id} value={a.id}>{a.code} - {a.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Payment Account (Cash/Bank)</label>
              <select
                className="w-full h-10 px-3 rounded-md border border-secondary-300 bg-white dark:bg-secondary-800 text-secondary-900 dark:text-secondary-50 text-sm"
                value={form.paymentAccountId}
                onChange={(e) => setForm({ ...form, paymentAccountId: e.target.value })}
                required
              >
                <option value="">-- Choose Account --</option>
                {accounts.map((a: any) => (
                  <option key={a.id} value={a.id}>{a.code} - {a.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Notes (optional)</label>
            <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          <div className="flex justify-end space-x-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setIsAddOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={isSubmitting}>{isSubmitting ? "Creating..." : "Create Fixed Asset"}</Button>
          </div>
        </form>
      </Modal>

      {/* Asset Detail / Depreciation Schedule Modal */}
      <Modal isOpen={!!detailAsset} onClose={() => setDetailAsset(null)} title={detailAsset?.name || ""} description="Depreciation schedule - one row per month actually posted.">
        {detailAsset && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3 text-xs">
              <div><div className="text-secondary-500">Cost</div><div className="font-semibold">{Number(detailAsset.cost).toFixed(2)}</div></div>
              <div><div className="text-secondary-500">Accumulated Depreciation</div><div className="font-semibold">{Number(detailAsset.accumulatedDepreciation).toFixed(2)}</div></div>
              <div><div className="text-secondary-500">Net Book Value</div><div className="font-semibold">{netBookValue(detailAsset).toFixed(2)}</div></div>
            </div>
            {detailAsset.depreciationEntries && detailAsset.depreciationEntries.length > 0 ? (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-secondary-500 border-b border-secondary-200 dark:border-secondary-800">
                    <th className="py-2">Period</th>
                    <th className="py-2">Amount</th>
                    <th className="py-2">Net Book Value After</th>
                  </tr>
                </thead>
                <tbody>
                  {detailAsset.depreciationEntries.map((e) => (
                    <tr key={e.id} className="border-b border-secondary-100 dark:border-secondary-800">
                      <td className="py-2">{e.period}</td>
                      <td className="py-2">{Number(e.amount).toFixed(2)}</td>
                      <td className="py-2">{Number(e.netBookValueAfter).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="text-xs text-secondary-500 py-4 text-center">No depreciation posted yet.</div>
            )}
          </div>
        )}
      </Modal>

      {/* Dispose Modal */}
      <Modal isOpen={!!disposeAsset} onClose={() => setDisposeAsset(null)} title={`Dispose - ${disposeAsset?.name ?? ""}`} description="Stops all further depreciation. No write-off/gain-loss journal entry is posted in this pass.">
        <form onSubmit={handleDispose} className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Disposal Date</label>
            <Input type="date" value={disposalDate} onChange={(e) => setDisposalDate(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Notes (optional)</label>
            <Input value={disposalNotes} onChange={(e) => setDisposalNotes(e.target.value)} />
          </div>
          <div className="flex justify-end space-x-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setDisposeAsset(null)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={isDisposing}>{isDisposing ? "Saving..." : "Mark Disposed"}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
