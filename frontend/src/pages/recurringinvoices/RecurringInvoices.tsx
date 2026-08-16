import { useState, useEffect, useCallback } from "react";
import { Repeat, PlusCircle, Trash2 } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../../components/ui/Card";
import { api } from "../../lib/api";

interface Customer {
  id: string;
  name: string;
  email: string;
}

interface TaxRate {
  id: string;
  name: string;
  code: string;
  rate: string;
}

interface RecurringInvoiceLine {
  description: string;
  quantity: number;
  unitPrice: number;
}

interface RecurringInvoice {
  id: string;
  name: string;
  frequency: string;
  startDate: string;
  endDate: string | null;
  nextRun: string;
  lastRun: string | null;
  isActive: boolean;
  currency: string;
  customer: Customer;
}

const emptyLine: RecurringInvoiceLine = { description: "", quantity: 1, unitPrice: 0 };

export function RecurringInvoices() {
  const [items, setItems] = useState<RecurringInvoice[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [taxRates, setTaxRates] = useState<TaxRate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const [form, setForm] = useState({
    customerId: "",
    name: "",
    frequency: "MONTHLY",
    startDate: new Date().toISOString().split("T")[0],
    endDate: "",
    currency: "USD",
    dueInDays: "14",
    taxRateId: "",
  });
  const [lines, setLines] = useState<RecurringInvoiceLine[]>([{ ...emptyLine }]);

  const fetchAll = useCallback(async () => {
    setIsLoading(true);
    try {
      const [recurRes, custRes, taxRes] = await Promise.all([
        api.get("/recurring-invoices"),
        api.get("/invoices/customers"),
        api.get("/tax-rates"),
      ]);
      setItems(recurRes.data?.data?.recurringInvoices || []);
      if (custRes.data.success) setCustomers(custRes.data.data.customers);
      if (taxRes.data.success) setTaxRates(taxRes.data.data.taxRates.filter((t: any) => t.isActive));
    } catch (err) {
      console.error("Failed to load recurring invoices:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const updateLine = (index: number, patch: Partial<RecurringInvoiceLine>) => {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  };

  const addLine = () => setLines((prev) => [...prev, { ...emptyLine }]);
  const removeLine = (index: number) => setLines((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    try {
      await api.post("/recurring-invoices", {
        customerId: form.customerId,
        name: form.name,
        frequency: form.frequency,
        startDate: form.startDate,
        endDate: form.endDate || undefined,
        currency: form.currency,
        dueInDays: Number(form.dueInDays),
        taxRateId: form.taxRateId || undefined,
        items: lines.map((l) => ({ description: l.description, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice) })),
      });
      setMessage("✅ Recurring invoice created.");
      setForm({ ...form, name: "", customerId: "", endDate: "", taxRateId: "" });
      setLines([{ ...emptyLine }]);
      fetchAll();
    } catch (err: any) {
      setMessage(`❌ ${err.response?.data?.error || "Failed to create recurring invoice."}`);
    }
  };

  const handleToggleActive = async (item: RecurringInvoice) => {
    setMessage(null);
    try {
      await api.put(`/recurring-invoices/${item.id}/active`, { isActive: !item.isActive });
      fetchAll();
    } catch (err: any) {
      setMessage(`❌ ${err.response?.data?.error || "Failed to update recurring invoice."}`);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-4xl mx-auto">
      <div>
        <h2 className="text-3xl font-bold tracking-tight text-secondary-900 dark:text-secondary-50">Recurring Invoices</h2>
        <p className="text-secondary-500 dark:text-secondary-400 mt-1">
          Automatically generate real customer invoices on a schedule (retainers, subscriptions, rent, etc.).
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
            Scheduled Invoices
          </CardTitle>
          <CardDescription>Checked daily - a due row automatically issues a real invoice to the customer.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-xs text-secondary-500 py-4 text-center">Loading...</div>
          ) : items.length === 0 ? (
            <div className="text-xs text-secondary-500 py-4 text-center">No recurring invoices set up yet.</div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-secondary-500 border-b border-secondary-200 dark:border-secondary-800">
                  <th className="py-2">Name</th>
                  <th className="py-2">Customer</th>
                  <th className="py-2">Frequency</th>
                  <th className="py-2">Next Run</th>
                  <th className="py-2">Last Run</th>
                  <th className="py-2">Status</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-b border-secondary-100 dark:border-secondary-800">
                    <td className="py-2">{item.name}</td>
                    <td className="py-2">{item.customer?.name}</td>
                    <td className="py-2">{item.frequency}</td>
                    <td className="py-2">{new Date(item.nextRun).toLocaleDateString()}</td>
                    <td className="py-2">{item.lastRun ? new Date(item.lastRun).toLocaleDateString() : "Never"}</td>
                    <td className="py-2">
                      <span className={item.isActive ? "text-green-600" : "text-secondary-400"}>
                        {item.isActive ? "Active" : "Paused"}
                      </span>
                    </td>
                    <td className="py-2 text-right">
                      <button
                        onClick={() => handleToggleActive(item)}
                        className="text-primary-600 hover:text-primary-800 text-xs font-semibold"
                      >
                        {item.isActive ? "Pause" : "Resume"}
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
              Add a Recurring Invoice
            </CardTitle>
            <CardDescription>Generates a Simple Invoice for the customer on each cycle, due {form.dueInDays} days after issue.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Name</label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Monthly Retainer" required />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Customer</label>
                <select
                  className="w-full h-10 px-3 rounded-md border border-secondary-300 bg-white dark:bg-secondary-800 text-secondary-900 dark:text-secondary-50 text-sm"
                  value={form.customerId}
                  onChange={(e) => setForm({ ...form, customerId: e.target.value })}
                  required
                >
                  <option value="">-- Choose Customer --</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
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
                <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Due In (days)</label>
                <Input type="number" min="0" value={form.dueInDays} onChange={(e) => setForm({ ...form, dueInDays: e.target.value })} required />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Start Date</label>
                <Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} required />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">End Date (optional)</label>
                <Input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Currency</label>
                <Input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} maxLength={3} required />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Tax Rate (optional)</label>
                <select
                  className="w-full h-10 px-3 rounded-md border border-secondary-300 bg-white dark:bg-secondary-800 text-secondary-900 dark:text-secondary-50 text-sm"
                  value={form.taxRateId}
                  onChange={(e) => setForm({ ...form, taxRateId: e.target.value })}
                >
                  <option value="">-- None --</option>
                  {taxRates.map((tr) => (
                    <option key={tr.id} value={tr.id}>{tr.name} ({tr.code})</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Line Items</label>
              {lines.map((line, index) => (
                <div key={index} className="grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-6">
                    <Input
                      placeholder="Description"
                      value={line.description}
                      onChange={(e) => updateLine(index, { description: e.target.value })}
                      required
                    />
                  </div>
                  <div className="col-span-2">
                    <Input
                      type="number"
                      min="1"
                      placeholder="Qty"
                      value={line.quantity}
                      onChange={(e) => updateLine(index, { quantity: Number(e.target.value) })}
                      required
                    />
                  </div>
                  <div className="col-span-3">
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="Unit Price"
                      value={line.unitPrice}
                      onChange={(e) => updateLine(index, { unitPrice: Number(e.target.value) })}
                      required
                    />
                  </div>
                  <div className="col-span-1 text-right">
                    <button type="button" onClick={() => removeLine(index)} className="text-red-500 hover:text-red-700" title="Remove line">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
              <Button type="button" variant="secondary" onClick={addLine}>+ Add Line</Button>
            </div>
          </CardContent>
          <CardFooter>
            <Button type="submit" variant="primary">Add Recurring Invoice</Button>
          </CardFooter>
        </Card>
      </form>
    </div>
  );
}
