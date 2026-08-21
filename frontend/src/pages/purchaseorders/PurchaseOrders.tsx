import { useState, useEffect, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "../../components/ui/Table";
import { Modal } from "../../components/ui/Modal";
import { api } from "../../lib/api";
import { useToast } from "../../contexts/ToastContext";
import { Plus, FileSpreadsheet, Trash2, Send, XCircle, ReceiptText, AlertTriangle, RefreshCcw } from "lucide-react";

interface Vendor {
  id: string;
  name: string;
  email: string;
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

interface PoLine {
  itemId: string;
  quantity: string;
  unitCost: string;
}

interface PurchaseOrderLine {
  id: string;
  itemId: string;
  quantity: number;
  unitCost: number;
  item: { name: string; sku: string };
}

interface PurchaseOrder {
  id: string;
  poNumber: string;
  vendor: Vendor;
  warehouse: WarehouseOption | null;
  status: "DRAFT" | "SENT" | "BILLED" | "CANCELLED";
  currency: string;
  orderDate: string;
  expectedDate: string | null;
  notes: string | null;
  lines: PurchaseOrderLine[];
  bills: { id: string; billNumber: string }[];
}

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-secondary-100 text-secondary-700 dark:bg-secondary-800 dark:text-secondary-300",
  SENT: "bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  BILLED: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  CANCELLED: "bg-red-50 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

// Purchase Orders - a formal order sent to a vendor ahead of actually
// receiving/billing for goods. "Create Bill from PO" reuses the EXACT same
// itemized-purchase-bill machinery Vendor Bills already has (real stock
// receipt, moving-average cost) via a purchaseOrderId passthrough - see
// routes/bills.ts - rather than a separate receiving pipeline. Quantities
// and costs are editable at bill time (defaulting to what was ordered) so a
// genuinely partial or price-varied receipt is representable, which is what
// makes the resulting ordered-vs-billed variance check meaningful.
export function PurchaseOrders() {
  const { showToast } = useToast();
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [items, setItems] = useState<InventoryItemOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedVendor, setSelectedVendor] = useState("");
  const [selectedWarehouse, setSelectedWarehouse] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [poLines, setPoLines] = useState<PoLine[]>([{ itemId: "", quantity: "", unitCost: "" }]);

  const [billModalPo, setBillModalPo] = useState<PurchaseOrder | null>(null);
  const [billLines, setBillLines] = useState<PoLine[]>([]);
  const [poVariance, setPoVariance] = useState<any[] | null>(null);

  const [isReorderOpen, setIsReorderOpen] = useState(false);
  const [reorderWarehouseId, setReorderWarehouseId] = useState("");
  const [isGeneratingReorder, setIsGeneratingReorder] = useState(false);
  const [isCreatingPo, setIsCreatingPo] = useState(false);
  const [isCreatingBill, setIsCreatingBill] = useState(false);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [poRes, vendorRes, whRes, itemRes] = await Promise.all([
        api.get("/purchase-orders"),
        api.get("/bills/vendors"),
        api.get("/inventory/warehouses"),
        api.get("/inventory/items"),
      ]);
      if (poRes.data.success) setPurchaseOrders(poRes.data.data.purchaseOrders);
      if (vendorRes.data.success) setVendors(vendorRes.data.data.vendors);
      if (whRes.data.success) setWarehouses(whRes.data.data.warehouses);
      if (itemRes.data.success) setItems(itemRes.data.data.items);
    } catch (err) {
      console.error("Failed to fetch purchase orders:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const updatePoLine = (idx: number, field: keyof PoLine, value: string) => {
    setPoLines((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      if (field === "itemId") {
        const item = items.find((it) => it.id === value);
        if (item) next[idx].unitCost = String(item.costPrice);
      }
      return next;
    });
  };
  const addPoLine = () => setPoLines((prev) => [...prev, { itemId: "", quantity: "", unitCost: "" }]);
  const removePoLine = (idx: number) => setPoLines((prev) => prev.filter((_, i) => i !== idx));

  const handleCreatePo = async (e: React.FormEvent) => {
    e.preventDefault();
    const validLines = poLines.filter((l) => l.itemId && Number(l.quantity) > 0 && Number(l.unitCost) >= 0);
    if (!selectedVendor || validLines.length === 0) {
      showToast("Select a vendor and at least one valid line item.", "error");
      return;
    }
    setIsCreatingPo(true);
    try {
      const res = await api.post("/purchase-orders", {
        vendorId: selectedVendor,
        warehouseId: selectedWarehouse || undefined,
        expectedDate: expectedDate || undefined,
        lines: validLines.map((l) => ({ itemId: l.itemId, quantity: Number(l.quantity), unitCost: Number(l.unitCost) })),
      });
      if (res.data.success) {
        showToast("Purchase Order created.", "success");
        setIsCreateOpen(false);
        setSelectedVendor("");
        setSelectedWarehouse("");
        setExpectedDate("");
        setPoLines([{ itemId: "", quantity: "", unitCost: "" }]);
        fetchData();
      }
    } catch (err: any) {
      showToast(err.response?.data?.error || "Failed to create Purchase Order.", "error");
    } finally {
      setIsCreatingPo(false);
    }
  };

  const handleMarkSent = async (po: PurchaseOrder) => {
    try {
      await api.put(`/purchase-orders/${po.id}/status`, { status: "SENT" });
      showToast("Marked as sent to vendor.", "success");
      fetchData();
    } catch (err: any) {
      showToast(err.response?.data?.error || "Failed to update status.", "error");
    }
  };

  const handleCancel = async (po: PurchaseOrder) => {
    if (!window.confirm(`Cancel ${po.poNumber}?`)) return;
    try {
      await api.put(`/purchase-orders/${po.id}/status`, { status: "CANCELLED" });
      showToast("Purchase Order cancelled.", "success");
      fetchData();
    } catch (err: any) {
      showToast(err.response?.data?.error || "Failed to cancel.", "error");
    }
  };

  const openBillModal = (po: PurchaseOrder) => {
    setBillModalPo(po);
    setBillLines(po.lines.map((l) => ({ itemId: l.itemId, quantity: String(l.quantity), unitCost: String(l.unitCost) })));
    setPoVariance(null);
  };

  const handleCreateBillFromPo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!billModalPo) return;
    if (!billModalPo.warehouse) {
      showToast("This Purchase Order has no warehouse set - add one before billing (needed to receive stock).", "error");
      return;
    }
    const validLines = billLines.filter((l) => l.itemId && Number(l.quantity) > 0 && Number(l.unitCost) >= 0);
    setIsCreatingBill(true);
    try {
      const res = await api.post("/bills", {
        vendorId: billModalPo.vendor.id,
        warehouseId: billModalPo.warehouse.id,
        purchaseOrderId: billModalPo.id,
        items: validLines.map((l) => ({ itemId: l.itemId, quantity: Number(l.quantity), unitCost: Number(l.unitCost) })),
      });
      if (res.data.success) {
        if (res.data.data.poVariance?.some((v: any) => v.hasVariance)) {
          setPoVariance(res.data.data.poVariance);
          showToast("Bill created - some lines differ from what was ordered, see below.", "success");
        } else {
          showToast("Bill created and stock received.", "success");
          setBillModalPo(null);
        }
        fetchData();
      }
    } catch (err: any) {
      showToast(err.response?.data?.error || "Failed to create bill from Purchase Order.", "error");
    } finally {
      setIsCreatingBill(false);
    }
  };

  const handleGenerateReorderPos = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reorderWarehouseId) return;
    setIsGeneratingReorder(true);
    try {
      const res = await api.post("/purchase-orders/generate-for-reorder", { warehouseId: reorderWarehouseId });
      if (res.data.success) {
        showToast(res.data.message, "success");
        if (res.data.data.skippedNoVendor.length > 0) {
          showToast(
            `${res.data.data.skippedNoVendor.length} low-stock item(s) skipped - no preferred vendor set (${res.data.data.skippedNoVendor.map((s: any) => s.itemName).join(", ")}).`,
            "error"
          );
        }
        setIsReorderOpen(false);
        fetchData();
      }
    } catch (err: any) {
      showToast(err.response?.data?.error || "Failed to generate reorder purchase orders.", "error");
    } finally {
      setIsGeneratingReorder(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-secondary-900 dark:text-secondary-50">Purchase Orders</h2>
          <p className="text-secondary-500 dark:text-secondary-400 mt-1">
            Order goods from a vendor, then create a bill against it once received - flags any ordered-vs-billed variance.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setIsReorderOpen(true)} className="flex items-center">
            <RefreshCcw className="mr-2 h-4 w-4" />
            Generate Reorder POs
          </Button>
          <Button variant="primary" onClick={() => setIsCreateOpen(true)} className="flex items-center">
            <Plus className="mr-2 h-4 w-4" />
            New Purchase Order
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <FileSpreadsheet className="mr-2 h-5 w-5 text-primary-600 dark:text-primary-400" />
            All Purchase Orders
          </CardTitle>
          <CardDescription>DRAFT and SENT orders can be billed against; CANCELLED cannot.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-8 text-center text-secondary-500">Loading...</div>
          ) : purchaseOrders.length === 0 ? (
            <div className="py-12 text-center text-secondary-500 text-sm">No purchase orders yet.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PO #</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Lines</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Bill</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {purchaseOrders.map((po) => (
                  <TableRow key={po.id}>
                    <TableCell className="font-medium">{po.poNumber}</TableCell>
                    <TableCell>{po.vendor.name}</TableCell>
                    <TableCell className="text-xs text-secondary-500">
                      {po.lines.length} item{po.lines.length === 1 ? "" : "s"}
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLORS[po.status]}`}>
                        {po.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs">
                      {po.bills.length > 0 ? po.bills.map((b) => b.billNumber).join(", ") : "-"}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1.5">
                        {po.status === "DRAFT" && (
                          <Button size="sm" variant="outline" onClick={() => handleMarkSent(po)} title="Mark Sent">
                            <Send className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {(po.status === "DRAFT" || po.status === "SENT") && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => openBillModal(po)} title="Create Bill">
                              <ReceiptText className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => handleCancel(po)} title="Cancel">
                              <XCircle className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Modal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="New Purchase Order">
        <form onSubmit={handleCreatePo} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Vendor</label>
            <select required className="w-full h-9 rounded-md border border-secondary-300 bg-white px-3 text-sm dark:border-secondary-700 dark:bg-secondary-800" value={selectedVendor} onChange={(e) => setSelectedVendor(e.target.value)}>
              <option value="">-- Select Vendor --</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Receiving Warehouse (needed to bill this PO later)</label>
            <select className="w-full h-9 rounded-md border border-secondary-300 bg-white px-3 text-sm dark:border-secondary-700 dark:bg-secondary-800" value={selectedWarehouse} onChange={(e) => setSelectedWarehouse(e.target.value)}>
              <option value="">-- None --</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Expected Date (optional)</label>
            <Input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Line Items</label>
            <div className="space-y-2">
              {poLines.map((line, idx) => (
                <div key={idx} className="flex gap-2 items-center">
                  <select className="flex-1 h-9 rounded-md border border-secondary-300 bg-white px-2 text-xs dark:border-secondary-700 dark:bg-secondary-800" value={line.itemId} onChange={(e) => updatePoLine(idx, "itemId", e.target.value)}>
                    <option value="">-- Item --</option>
                    {items.map((it) => <option key={it.id} value={it.id}>{it.sku} - {it.name}</option>)}
                  </select>
                  <Input type="number" min="1" placeholder="Qty" className="w-20" value={line.quantity} onChange={(e) => updatePoLine(idx, "quantity", e.target.value)} />
                  <Input type="number" min="0" step="0.01" placeholder="Unit Cost" className="w-28" value={line.unitCost} onChange={(e) => updatePoLine(idx, "unitCost", e.target.value)} />
                  {poLines.length > 1 && (
                    <button type="button" onClick={() => removePoLine(idx)} className="text-secondary-400 hover:text-red-500">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <Button type="button" variant="outline" size="sm" className="mt-2" onClick={addPoLine}>
              <Plus className="mr-1 h-3 w-3" /> Add Line
            </Button>
          </div>
          <div className="flex justify-end space-x-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={isCreatingPo}>{isCreatingPo ? "Creating..." : "Create Purchase Order"}</Button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={!!billModalPo} onClose={() => setBillModalPo(null)} title={`Create Bill from ${billModalPo?.poNumber || ""}`}>
        {billModalPo && (
          <form onSubmit={handleCreateBillFromPo} className="space-y-4">
            <p className="text-xs text-secondary-500">
              Quantities/costs default to what was ordered - edit them to match what was actually received and billed.
            </p>
            <div className="space-y-2">
              {billLines.map((line, idx) => {
                const poLine = billModalPo.lines[idx];
                return (
                  <div key={idx} className="flex gap-2 items-center text-xs">
                    <span className="flex-1 truncate">{poLine?.item.name}</span>
                    <Input type="number" min="0" className="w-20" value={line.quantity} onChange={(e) => {
                      const next = [...billLines];
                      next[idx] = { ...next[idx], quantity: e.target.value };
                      setBillLines(next);
                    }} />
                    <Input type="number" min="0" step="0.01" className="w-24" value={line.unitCost} onChange={(e) => {
                      const next = [...billLines];
                      next[idx] = { ...next[idx], unitCost: e.target.value };
                      setBillLines(next);
                    }} />
                  </div>
                );
              })}
            </div>

            {poVariance && (
              <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-900 p-3 space-y-1">
                <div className="flex items-center gap-1 text-xs font-semibold text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5" /> Ordered vs. Billed Variance
                </div>
                {poVariance.filter((v) => v.hasVariance).map((v) => (
                  <p key={v.itemId} className="text-xs text-amber-700 dark:text-amber-400">
                    {v.itemName}: ordered {v.orderedQuantity} @ {v.orderedUnitCost}, billed {v.billedQuantity} @ {v.billedUnitCost}
                  </p>
                ))}
              </div>
            )}

            <div className="flex justify-end space-x-3 pt-2">
              <Button type="button" variant="outline" onClick={() => setBillModalPo(null)}>Close</Button>
              <Button type="submit" variant="primary" disabled={isCreatingBill}>{isCreatingBill ? "Creating..." : "Create Bill & Receive Stock"}</Button>
            </div>
          </form>
        )}
      </Modal>

      <Modal isOpen={isReorderOpen} onClose={() => setIsReorderOpen(false)} title="Generate Reorder Purchase Orders">
        <form onSubmit={handleGenerateReorderPos} className="space-y-4">
          <p className="text-xs text-secondary-500">
            Drafts one Purchase Order per vendor covering every item in the chosen warehouse whose stock has fallen
            to or below its reorder level - ordering enough to bring each back up to that level. Items with no
            preferred vendor set are skipped and reported.
          </p>
          <div>
            <label className="block text-sm font-medium mb-1">Warehouse</label>
            <select required className="w-full h-9 rounded-md border border-secondary-300 bg-white px-3 text-sm dark:border-secondary-700 dark:bg-secondary-800" value={reorderWarehouseId} onChange={(e) => setReorderWarehouseId(e.target.value)}>
              <option value="">-- Select Warehouse --</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div className="flex justify-end space-x-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setIsReorderOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={isGeneratingReorder}>
              {isGeneratingReorder ? "Generating..." : "Generate"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
