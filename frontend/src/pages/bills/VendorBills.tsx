import { useState, useEffect, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "../../components/ui/Table";
import { Modal } from "../../components/ui/Modal";
import { api } from "../../lib/api";
import { useToast } from "../../contexts/ToastContext";
import { useTenantSettings } from "../../hooks/useTenantSettings";
import { Plus, CheckCircle, Building2, CreditCard, AlertCircle, Package, Ship, Trash2, Undo2 } from "lucide-react";

interface Vendor {
  id: string;
  name: string;
  email: string;
  phone?: string;
}

interface VendorBillLine {
  id: string;
  itemId: string;
  quantity: number;
  unitCost: number;
  lineTotal: number;
  item?: { name: string; sku: string };
}

interface VendorBill {
  id: string;
  billNumber: string;
  vendor: Vendor;
  billDate: string;
  dueDate: string;
  amount: number;
  currency: string;
  status: string;
  billType: "STANDARD" | "LANDED_COST";
  landedCostForBillId?: string | null;
  warehouseId?: string | null;
  lines?: VendorBillLine[];
}

interface WarehouseOption {
  id: string;
  name: string;
}

interface InventoryItemOption {
  id: string;
  sku: string;
  name: string;
  costPrice: number;
}

interface PurchaseLine {
  itemId: string;
  quantity: string;
  unitCost: string;
}

interface FundOption {
  id: string;
  name: string;
  code: string;
}

interface DebitNote {
  id: string;
  debitNoteNumber: string;
  amount: number;
  reason: string;
  method: "BILL_REDUCTION" | "JOURNAL_REVERSAL";
  issueDate: string;
}

export function VendorBills() {
  const { showToast } = useToast();
  const { settings } = useTenantSettings();
  const [bills, setBills] = useState<VendorBill[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [items, setItems] = useState<InventoryItemOption[]>([]);
  const [funds, setFunds] = useState<FundOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Modals
  const [isBillOpen, setIsBillOpen] = useState(false);
  const [isVendorOpen, setIsVendorOpen] = useState(false);
  const [landedCostForBill, setLandedCostForBill] = useState<VendorBill | null>(null);

  // Vendor Form
  const [vendorName, setVendorName] = useState("");
  const [vendorEmail, setVendorEmail] = useState("");

  // Bill Form
  const [isItemized, setIsItemized] = useState(false);
  const [selectedVendor, setSelectedVendor] = useState("");
  const [billAmount, setBillAmount] = useState("450");
  const [currency, setCurrency] = useState("USD");
  const [selectedWarehouse, setSelectedWarehouse] = useState("");
  const [selectedFundId, setSelectedFundId] = useState("");
  const [purchaseLines, setPurchaseLines] = useState<PurchaseLine[]>([{ itemId: "", quantity: "", unitCost: "" }]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Landed Cost Form
  const [landedVendor, setLandedVendor] = useState("");
  const [landedAmount, setLandedAmount] = useState("");
  const [landedCurrency, setLandedCurrency] = useState("USD");
  const [landedDescription, setLandedDescription] = useState("");
  const [isSubmittingLanded, setIsSubmittingLanded] = useState(false);
  const [landedResult, setLandedResult] = useState<any | null>(null);

  // Debit Note modal
  const [debitNoteForBill, setDebitNoteForBill] = useState<VendorBill | null>(null);
  const [debitNotesHistory, setDebitNotesHistory] = useState<DebitNote[]>([]);
  const [debitAmount, setDebitAmount] = useState("");
  const [debitReason, setDebitReason] = useState("");
  const [isIssuingDebit, setIsIssuingDebit] = useState(false);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [billRes, venRes, whRes, itemsRes, fundsRes] = await Promise.all([
        api.get("/bills"),
        api.get("/bills/vendors"),
        api.get("/inventory/warehouses"),
        api.get("/inventory/items"),
        api.get("/funds"),
      ]);

      if (billRes.data.success) setBills(billRes.data.data.bills);
      if (venRes.data.success) setVendors(venRes.data.data.vendors);
      if (whRes.data.success) setWarehouses(whRes.data.data.warehouses.map((w: any) => ({ id: w.id, name: w.name })));
      if (itemsRes.data.success) {
        setItems(itemsRes.data.data.items.map((it: any) => ({ id: it.id, sku: it.sku, name: it.name, costPrice: Number(it.costPrice) })));
      }
      if (fundsRes.data.success) setFunds(fundsRes.data.data.funds.filter((f: any) => f.isActive));
    } catch (err) {
      console.error("Failed to load bills data:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleAddVendor = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await api.post("/bills/vendors", { name: vendorName, email: vendorEmail });
      if (res.data.success) {
        setVendorName("");
        setVendorEmail("");
        setIsVendorOpen(false);
        fetchData();
      }
    } catch (err: any) {
      showToast(err.response?.data?.error || "Failed to add vendor.", "error");
    }
  };

  const addPurchaseLine = () => setPurchaseLines((prev) => [...prev, { itemId: "", quantity: "", unitCost: "" }]);
  const removePurchaseLine = (idx: number) => setPurchaseLines((prev) => prev.filter((_, i) => i !== idx));
  const updatePurchaseLine = (idx: number, field: keyof PurchaseLine, value: string) => {
    setPurchaseLines((prev) => prev.map((l, i) => (i === idx ? { ...l, [field]: value } : l)));
  };

  const itemizedTotal = purchaseLines.reduce((sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.unitCost) || 0), 0);

  const resetBillForm = () => {
    setIsItemized(false);
    setSelectedVendor("");
    setBillAmount("450");
    setCurrency(settings.baseCurrency);
    setSelectedWarehouse("");
    setSelectedFundId("");
    setPurchaseLines([{ itemId: "", quantity: "", unitCost: "" }]);
  };

  const handleCreateBill = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVendor) {
      showToast("Please select a vendor.", "error");
      return;
    }

    if (isItemized) {
      const validLines = purchaseLines.filter((l) => l.itemId && Number(l.quantity) > 0 && Number(l.unitCost) >= 0);
      if (validLines.length === 0) {
        showToast("Add at least one item with a quantity and unit cost.", "error");
        return;
      }
      if (!selectedWarehouse) {
        showToast("Select which warehouse is receiving this stock.", "error");
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const payload = isItemized
        ? {
            vendorId: selectedVendor,
            currency,
            warehouseId: selectedWarehouse,
            items: purchaseLines
              .filter((l) => l.itemId && Number(l.quantity) > 0)
              .map((l) => ({ itemId: l.itemId, quantity: Number(l.quantity), unitCost: Number(l.unitCost) })),
            ...(selectedFundId ? { fundId: selectedFundId } : {}),
          }
        : { vendorId: selectedVendor, amount: Number(billAmount), currency, ...(selectedFundId ? { fundId: selectedFundId } : {}) };

      const res = await api.post("/bills", payload);

      if (res.data.success) {
        showToast(isItemized ? "Purchase recorded and stock received." : "Vendor bill recorded.", "success");
        setIsBillOpen(false);
        resetBillForm();
        fetchData();
      }
    } catch (err: any) {
      showToast(err.response?.data?.error || "Failed to create vendor bill.", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePayBill = async (id: string) => {
    try {
      const res = await api.post(`/bills/${id}/pay`);
      if (res.data.success) {
        fetchData();
      }
    } catch (err: any) {
      showToast(err.response?.data?.error || "Payment recording failed.", "error");
    }
  };

  const openDebitNoteModal = async (bill: VendorBill) => {
    setDebitNoteForBill(bill);
    setDebitAmount("");
    setDebitReason("");
    setDebitNotesHistory([]);
    try {
      const res = await api.get(`/bills/${bill.id}/debit-notes`);
      if (res.data.success) setDebitNotesHistory(res.data.data.debitNotes);
    } catch (err) {
      console.error("Failed to load debit note history:", err);
    }
  };

  const handleIssueDebitNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!debitNoteForBill) return;
    setIsIssuingDebit(true);
    try {
      const res = await api.post(`/bills/${debitNoteForBill.id}/debit-notes`, {
        amount: Number(debitAmount),
        reason: debitReason,
      });
      if (res.data.success) {
        showToast(`Debit note ${res.data.data.debitNote.debitNoteNumber} issued.`, "success");
        setDebitNoteForBill(null);
        fetchData();
      }
    } catch (err: any) {
      showToast(err.response?.data?.error || "Failed to issue debit note.", "error");
    } finally {
      setIsIssuingDebit(false);
    }
  };

  const openLandedCostModal = (bill: VendorBill) => {
    setLandedCostForBill(bill);
    setLandedVendor("");
    setLandedAmount("");
    setLandedCurrency(bill.currency || "USD");
    setLandedDescription("");
    setLandedResult(null);
  };

  const handleAddLandedCost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!landedCostForBill || !landedVendor || !landedAmount) {
      showToast("Vendor and amount are required.", "error");
      return;
    }
    setIsSubmittingLanded(true);
    try {
      const res = await api.post(`/bills/${landedCostForBill.id}/landed-cost`, {
        vendorId: landedVendor,
        amount: Number(landedAmount),
        currency: landedCurrency,
        description: landedDescription,
      });
      if (res.data.success) {
        setLandedResult(res.data.data);
        showToast("Landed cost allocated across the purchase.", "success");
        fetchData();
      }
    } catch (err: any) {
      showToast(err.response?.data?.error || "Failed to allocate landed cost.", "error");
    } finally {
      setIsSubmittingLanded(false);
    }
  };

  // Defaults to the tenant's real configured base currency (not a hardcoded
  // "USD") for aggregate figures like the AP/Paid summary tiles that don't
  // pass an explicit currency. Individual bill rows still pass `b.currency`
  // explicitly - that's the real per-bill native currency, correct as-is.
  const formatCurrency = (amt: number, curr = settings.baseCurrency) => {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: curr }).format(amt);
  };

  const totalAP = bills.reduce((acc, b) => acc + (b.status !== "PAID" ? Number(b.amount) : 0), 0);
  const totalPaid = bills.reduce((acc, b) => acc + (b.status === "PAID" ? Number(b.amount) : 0), 0);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-secondary-900 dark:text-secondary-50">
            Vendor Bills & Accounts Payable (AP)
          </h2>
          <p className="text-secondary-500 dark:text-secondary-400 mt-1">
            Track vendor payables, record bill payments, and auto-post AP expense ledger entries.
          </p>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setIsVendorOpen(true)} className="flex items-center">
            <Building2 className="mr-2 h-4 w-4" />
            Add Vendor
          </Button>
          <Button variant="primary" onClick={() => { resetBillForm(); setIsBillOpen(true); }} className="flex items-center">
            <Plus className="mr-2 h-4 w-4" />
            Add Vendor Bill
          </Button>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid gap-6 md:grid-cols-3">
        <Card className="border-rose-100 dark:border-rose-950">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-semibold text-secondary-600 dark:text-secondary-400">Total Unpaid Bills (AP)</CardTitle>
            <AlertCircle className="h-5 w-5 text-rose-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-rose-600 dark:text-rose-400">{formatCurrency(totalAP)}</div>
          </CardContent>
        </Card>

        <Card className="border-emerald-100 dark:border-emerald-950">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-semibold text-secondary-600 dark:text-secondary-400">Total Paid Bills</CardTitle>
            <CreditCard className="h-5 w-5 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(totalPaid)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-semibold text-secondary-600 dark:text-secondary-400">Total Vendors</CardTitle>
            <Building2 className="h-5 w-5 text-primary-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-secondary-900 dark:text-secondary-50">{vendors.length}</div>
          </CardContent>
        </Card>
      </div>

      {/* Bills List */}
      <Card>
        <CardHeader>
          <CardTitle>Vendor Bills ({bills.length})</CardTitle>
          <CardDescription>Manage incoming vendor invoices and schedule payments.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-8 text-center text-secondary-500">Loading vendor bills...</div>
          ) : bills.length === 0 ? (
            <div className="py-8 text-center text-secondary-500 text-sm">
              No vendor bills recorded yet. Click "Add Vendor Bill" to enter a payable.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bill #</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Bill Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bills.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-mono font-medium text-primary-600 dark:text-primary-400">
                      {b.billNumber}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-secondary-900 dark:text-secondary-50">{b.vendor?.name}</div>
                      <div className="text-xs text-secondary-500">{b.vendor?.email}</div>
                    </TableCell>
                    <TableCell className="text-xs text-secondary-500">
                      {new Date(b.billDate).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      {b.billType === "LANDED_COST" ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
                          <Ship className="mr-1 h-3 w-3" /> Landed Cost
                        </span>
                      ) : b.lines && b.lines.length > 0 ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400" title={b.lines.map((l) => `${l.quantity}× ${l.item?.name}`).join(", ")}>
                          <Package className="mr-1 h-3 w-3" /> {b.lines.length} item{b.lines.length === 1 ? "" : "s"}
                        </span>
                      ) : (
                        <span className="text-xs text-secondary-400">General</span>
                      )}
                    </TableCell>
                    <TableCell className="font-bold text-secondary-900 dark:text-secondary-50">
                      {formatCurrency(Number(b.amount), b.currency)}
                    </TableCell>
                    <TableCell>
                      {b.status === "PAID" ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">
                          <CheckCircle className="mr-1 h-3 w-3" /> Paid
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400">
                          Unpaid
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right space-x-2 whitespace-nowrap">
                      {b.billType === "STANDARD" && b.lines && b.lines.length > 0 && (
                        <Button variant="outline" size="sm" onClick={() => openLandedCostModal(b)} className="text-xs">
                          + Landed Cost
                        </Button>
                      )}
                      {b.status !== "PAID" && (
                        <Button variant="outline" size="sm" onClick={() => handlePayBill(b.id)} className="text-xs">
                          Pay Bill
                        </Button>
                      )}
                      <Button variant="outline" size="sm" onClick={() => openDebitNoteModal(b)} className="text-xs">
                        <Undo2 className="mr-1 h-3 w-3" />
                        Debit Note
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add Vendor Modal */}
      <Modal isOpen={isVendorOpen} onClose={() => setIsVendorOpen(false)} title="Add Vendor">
        <form onSubmit={handleAddVendor} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Vendor / Company Name</label>
            <Input required placeholder="AWS Cloud Services" value={vendorName} onChange={(e) => setVendorName(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Vendor Contact Email</label>
            <Input type="email" required placeholder="billing@aws.amazon.com" value={vendorEmail} onChange={(e) => setVendorEmail(e.target.value)} />
          </div>
          <div className="flex justify-end space-x-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setIsVendorOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary">Add Vendor</Button>
          </div>
        </form>
      </Modal>

      {/* Create Vendor Bill Modal */}
      <Modal isOpen={isBillOpen} onClose={() => setIsBillOpen(false)} title="Record Vendor Bill" className="max-w-2xl">
        <form onSubmit={handleCreateBill} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Select Vendor</label>
            <select
              required
              className="w-full h-10 px-3 rounded-md border border-secondary-300 bg-white dark:bg-secondary-800 text-secondary-900 dark:text-secondary-50"
              value={selectedVendor}
              onChange={(e) => setSelectedVendor(e.target.value)}
            >
              <option value="">-- Choose Vendor --</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>{v.name} ({v.email})</option>
              ))}
            </select>
          </div>

          <div className="flex rounded-md border border-secondary-200 dark:border-secondary-800 p-1 text-sm">
            <button
              type="button"
              onClick={() => setIsItemized(false)}
              className={`flex-1 py-1.5 rounded ${!isItemized ? "bg-primary-600 text-white" : "text-secondary-500"}`}
            >
              Simple Bill
            </button>
            <button
              type="button"
              onClick={() => setIsItemized(true)}
              className={`flex-1 py-1.5 rounded ${isItemized ? "bg-primary-600 text-white" : "text-secondary-500"}`}
            >
              Itemized Purchase (Receives Stock)
            </button>
          </div>

          {funds.length > 0 && (
            <div>
              <label className="block text-sm font-medium mb-1">Fund (optional)</label>
              <select
                className="w-full h-10 px-3 rounded-md border border-secondary-300 bg-white dark:bg-secondary-800 text-secondary-900 dark:text-secondary-50"
                value={selectedFundId}
                onChange={(e) => setSelectedFundId(e.target.value)}
              >
                <option value="">No fund</option>
                {funds.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} ({f.code})
                  </option>
                ))}
              </select>
            </div>
          )}

          {!isItemized ? (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Bill Amount</label>
                <Input
                  type="number"
                  required={!isItemized}
                  placeholder="450"
                  value={billAmount}
                  onChange={(e) => setBillAmount(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Currency</label>
                <select
                  className="w-full h-10 px-3 rounded-md border border-secondary-300 bg-white dark:bg-secondary-800 text-secondary-900 dark:text-secondary-50"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                >
                  <option value="USD">USD ($)</option>
                  <option value="EUR">EUR (€)</option>
                  <option value="GBP">GBP (£)</option>
                  <option value="GHS">GHS (GH₵)</option>
                  <option value="JPY">JPY (¥)</option>
                </select>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">Receiving Warehouse</label>
                <select
                  required
                  className="w-full h-10 px-3 rounded-md border border-secondary-300 bg-white dark:bg-secondary-800 text-secondary-900 dark:text-secondary-50"
                  value={selectedWarehouse}
                  onChange={(e) => setSelectedWarehouse(e.target.value)}
                >
                  <option value="">-- Choose Warehouse --</option>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-2 max-h-56 overflow-y-auto">
                {purchaseLines.map((line, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <select
                      className="flex-1 h-9 px-2 rounded-md border border-secondary-300 bg-white dark:bg-secondary-800 text-secondary-900 dark:text-secondary-50 text-xs"
                      value={line.itemId}
                      onChange={(e) => updatePurchaseLine(idx, "itemId", e.target.value)}
                    >
                      <option value="">-- Item --</option>
                      {items.map((it) => (
                        <option key={it.id} value={it.id}>{it.name} ({it.sku})</option>
                      ))}
                    </select>
                    <div className="w-20 flex-shrink-0">
                      <Input
                        type="number"
                        placeholder="Qty"
                        className="text-xs"
                        value={line.quantity}
                        onChange={(e) => updatePurchaseLine(idx, "quantity", e.target.value)}
                      />
                    </div>
                    <div className="w-28 flex-shrink-0">
                      <Input
                        type="number"
                        placeholder="Unit Cost"
                        className="text-xs"
                        value={line.unitCost}
                        onChange={(e) => updatePurchaseLine(idx, "unitCost", e.target.value)}
                      />
                    </div>
                    <button type="button" onClick={() => removePurchaseLine(idx)} className="text-secondary-400 hover:text-red-500 p-1">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              <Button type="button" variant="outline" size="sm" onClick={addPurchaseLine} className="text-xs">
                <Plus className="mr-1 h-3 w-3" /> Add Line
              </Button>

              <div className="flex items-center justify-between p-3 bg-secondary-50 dark:bg-secondary-900 rounded-md text-sm">
                <span className="text-secondary-500">Purchase Total</span>
                <span className="font-bold">{formatCurrency(itemizedTotal, currency)}</span>
              </div>
            </div>
          )}

          <div className="flex justify-end space-x-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setIsBillOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={isSubmitting}>
              {isSubmitting ? "Recording..." : isItemized ? "Record Purchase & Receive Stock" : "Record Bill"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Add Landed Cost Modal */}
      <Modal isOpen={!!landedCostForBill} onClose={() => setLandedCostForBill(null)} title="Add Landed Cost">
        <div className="space-y-4">
          {landedCostForBill && (
            <p className="text-sm text-secondary-500">
              Freight, customs, or duty for purchase <span className="font-mono font-medium text-secondary-900 dark:text-secondary-50">{landedCostForBill.billNumber}</span> will
              be spread across its {landedCostForBill.lines?.length || 0} item(s) proportional to their share of the purchase value.
            </p>
          )}

          {!landedResult ? (
            <form onSubmit={handleAddLandedCost} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Vendor (e.g. shipping/customs)</label>
                <select
                  required
                  className="w-full h-10 px-3 rounded-md border border-secondary-300 bg-white dark:bg-secondary-800 text-secondary-900 dark:text-secondary-50"
                  value={landedVendor}
                  onChange={(e) => setLandedVendor(e.target.value)}
                >
                  <option value="">-- Choose Vendor --</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>{v.name} ({v.email})</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Amount</label>
                  <Input type="number" required value={landedAmount} onChange={(e) => setLandedAmount(e.target.value)} placeholder="e.g. 120" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Currency</label>
                  <select
                    className="w-full h-10 px-3 rounded-md border border-secondary-300 bg-white dark:bg-secondary-800 text-secondary-900 dark:text-secondary-50"
                    value={landedCurrency}
                    onChange={(e) => setLandedCurrency(e.target.value)}
                  >
                    <option value="USD">USD ($)</option>
                    <option value="GHS">GHS (GH₵)</option>
                    <option value="EUR">EUR (€)</option>
                    <option value="GBP">GBP (£)</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Description (optional)</label>
                <Input value={landedDescription} onChange={(e) => setLandedDescription(e.target.value)} placeholder="e.g. Ocean freight + customs clearance" />
              </div>
              <div className="flex justify-end space-x-3 pt-2">
                <Button type="button" variant="outline" onClick={() => setLandedCostForBill(null)}>Cancel</Button>
                <Button type="submit" variant="primary" disabled={isSubmittingLanded}>
                  {isSubmittingLanded ? "Allocating..." : "Allocate Landed Cost"}
                </Button>
              </div>
            </form>
          ) : (
            <div className="space-y-3">
              <div className="p-3 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-md text-sm text-emerald-800 dark:text-emerald-300 flex items-center">
                <CheckCircle className="mr-2 h-4 w-4" /> Allocated across {landedResult.allocations.length} item(s).
              </div>
              <div className="space-y-1.5 max-h-56 overflow-y-auto">
                {landedResult.allocations.map((a: any) => {
                  const item = items.find((it) => it.id === a.itemId);
                  return (
                    <div key={a.itemId} className="flex items-center justify-between p-2 bg-secondary-50 dark:bg-secondary-900 rounded-md text-xs">
                      <span className="font-medium">{item?.name || a.itemId}</span>
                      {a.skippedReason ? (
                        <span className="text-amber-600">{a.skippedReason}</span>
                      ) : (
                        <span>
                          {formatCurrency(a.previousCostPrice)} → <span className="font-bold">{formatCurrency(a.newCostPrice)}</span> / unit
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-end pt-2">
                <Button type="button" variant="primary" onClick={() => setLandedCostForBill(null)}>Done</Button>
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* Debit Note Modal */}
      <Modal
        isOpen={!!debitNoteForBill}
        onClose={() => setDebitNoteForBill(null)}
        title={`Issue Debit Note - ${debitNoteForBill?.billNumber ?? ""}`}
        description={
          debitNoteForBill?.status === "PAID"
            ? "This bill is already paid, so the debit will post a real refund entry (Cash in, Expense reversed)."
            : "This bill is unpaid, so the debit simply reduces the amount that will be charged on payment."
        }
      >
        <form onSubmit={handleIssueDebitNote} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">
              Amount ({debitNoteForBill?.currency ?? "USD"})
            </label>
            <Input
              type="number"
              step="0.01"
              min="0.01"
              required
              placeholder="0.00"
              value={debitAmount}
              onChange={(e) => setDebitAmount(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Reason</label>
            <Input
              required
              placeholder="e.g. Returned defective supplies"
              value={debitReason}
              onChange={(e) => setDebitReason(e.target.value)}
            />
          </div>

          {debitNotesHistory.length > 0 && (
            <div>
              <label className="block text-sm font-medium mb-1">Previously Issued</label>
              <div className="space-y-1 max-h-32 overflow-y-auto text-xs">
                {debitNotesHistory.map((dn) => (
                  <div key={dn.id} className="flex justify-between border-b border-secondary-100 dark:border-secondary-800 py-1">
                    <span className="text-secondary-600 dark:text-secondary-400">
                      {dn.debitNoteNumber} - {dn.reason}
                    </span>
                    <span className="font-medium text-secondary-900 dark:text-secondary-50">
                      {formatCurrency(Number(dn.amount), debitNoteForBill?.currency)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end space-x-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setDebitNoteForBill(null)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={isIssuingDebit}>
              {isIssuingDebit ? "Issuing..." : "Issue Debit Note"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
