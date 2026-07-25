import { useState, useEffect, useCallback } from "react";
import { CalendarClock, Lock, Unlock, PlusCircle } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../../components/ui/Card";
import { api } from "../../lib/api";

interface FiscalPeriod {
  id: string;
  name: string;
  fiscalYear: number;
  periodNumber: number;
  startDate: string;
  endDate: string;
  status: "OPEN" | "CLOSED" | "LOCKED";
}

const statusColor: Record<FiscalPeriod["status"], string> = {
  OPEN: "text-emerald-600",
  CLOSED: "text-amber-600",
  LOCKED: "text-red-600",
};

export function FiscalPeriods() {
  const [periods, setPeriods] = useState<FiscalPeriod[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: "",
    fiscalYear: new Date().getFullYear(),
    periodNumber: 1,
    startDate: "",
    endDate: "",
  });

  const fetchPeriods = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.get("/fiscal-periods");
      setPeriods(res.data?.data?.fiscalPeriods || []);
    } catch (err) {
      console.error("Failed to load fiscal periods:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPeriods();
  }, [fetchPeriods]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    try {
      await api.post("/fiscal-periods", form);
      setForm({ ...form, name: "", periodNumber: form.periodNumber + 1, startDate: "", endDate: "" });
      setMessage("✅ Fiscal period created.");
      fetchPeriods();
    } catch (err: any) {
      setMessage(`❌ ${err.response?.data?.error || "Failed to create fiscal period."}`);
    }
  };

  const handleClose = async (id: string) => {
    setMessage(null);
    try {
      await api.patch(`/fiscal-periods/${id}/close`);
      fetchPeriods();
    } catch (err: any) {
      setMessage(`❌ ${err.response?.data?.error || "Failed to close fiscal period."}`);
    }
  };

  const handleLock = async (id: string) => {
    setMessage(null);
    try {
      await api.patch(`/fiscal-periods/${id}/lock`);
      fetchPeriods();
    } catch (err: any) {
      setMessage(`❌ ${err.response?.data?.error || "Failed to lock fiscal period."}`);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-4xl mx-auto">
      <div>
        <h2 className="text-3xl font-bold tracking-tight text-secondary-900 dark:text-secondary-50">Fiscal Periods</h2>
        <p className="text-secondary-500 dark:text-secondary-400 mt-1">
          Close and lock accounting periods to prevent new postings once books are finalized.
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
            <CalendarClock className="mr-2 h-5 w-5 text-primary-600" />
            Periods
          </CardTitle>
          <CardDescription>
            Journal entries can only be posted to OPEN periods. CLOSED periods can still be re-locked; LOCKED periods are final.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-xs text-secondary-500 py-4 text-center">Loading fiscal periods...</div>
          ) : periods.length === 0 ? (
            <div className="text-xs text-secondary-500 py-4 text-center">
              No fiscal periods defined yet - postings are unrestricted by date until one is created.
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-secondary-500 border-b border-secondary-200 dark:border-secondary-800">
                  <th className="py-2">Name</th>
                  <th className="py-2">Year / Period</th>
                  <th className="py-2">Date Range</th>
                  <th className="py-2">Status</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {periods.map((p) => (
                  <tr key={p.id} className="border-b border-secondary-100 dark:border-secondary-800">
                    <td className="py-2">{p.name}</td>
                    <td className="py-2">{p.fiscalYear} / {p.periodNumber}</td>
                    <td className="py-2">
                      {new Date(p.startDate).toLocaleDateString()} - {new Date(p.endDate).toLocaleDateString()}
                    </td>
                    <td className={`py-2 font-semibold ${statusColor[p.status]}`}>{p.status}</td>
                    <td className="py-2 text-right space-x-2">
                      {p.status === "OPEN" && (
                        <button onClick={() => handleClose(p.id)} className="inline-flex items-center text-amber-600 hover:text-amber-800">
                          <Lock className="h-3.5 w-3.5 mr-1" /> Close
                        </button>
                      )}
                      {p.status === "CLOSED" && (
                        <button onClick={() => handleLock(p.id)} className="inline-flex items-center text-red-600 hover:text-red-800">
                          <Unlock className="h-3.5 w-3.5 mr-1" /> Lock
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

      <form onSubmit={handleCreate}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <PlusCircle className="mr-2 h-5 w-5 text-primary-600" />
              Add a Fiscal Period
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Name</label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="January 2026" required />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Fiscal Year</label>
              <Input type="number" value={form.fiscalYear} onChange={(e) => setForm({ ...form, fiscalYear: Number(e.target.value) })} required />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Period Number</label>
              <Input type="number" min="1" value={form.periodNumber} onChange={(e) => setForm({ ...form, periodNumber: Number(e.target.value) })} required />
            </div>
            <div />
            <div className="space-y-2">
              <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Start Date</label>
              <Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} required />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">End Date</label>
              <Input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} required />
            </div>
          </CardContent>
          <CardFooter>
            <Button type="submit" variant="primary">Add Period</Button>
          </CardFooter>
        </Card>
      </form>
    </div>
  );
}
