import { useState, useEffect, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Modal } from "../../components/ui/Modal";
import { api } from "../../lib/api";
import { formatMoney } from "../../lib/utils";
import { ShoppingCart, Lock, Unlock, Receipt, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";

interface WarehouseOption {
  id: string;
  name: string;
}

interface InventoryItemOption {
  id: string;
  sku: string;
  name: string;
  sellingPrice: number;
  unitOfMeasure: string;
  stockQty: number;
}

interface CashSale {
  id: string;
  receiptNo: string;
  amount: number;
  cashGiven: number;
  changeGiven: number;
  createdAt: string;
}

interface CashTill {
  id: string;
  warehouseId: string;
  openingCash: number;
  cashSalesTotal: number;
  status: string;
  openedAt: string;
  sales: CashSale[];
  warehouse?: { name: string };
}

export function PointOfSale() {
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState("");
  const [till, setTill] = useState<CashTill | null>(null);
  const [items, setItems] = useState<InventoryItemOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Open Till Form
  const [openingCash, setOpeningCash] = useState("");
  const [isOpeningTill, setIsOpeningTill] = useState(false);

  // Sale Form
  const [selectedItemId, setSelectedItemId] = useState("");
  const [saleQty, setSaleQty] = useState("1");
  const [cashGiven, setCashGiven] = useState("");
  const [isRecordingSale, setIsRecordingSale] = useState(false);
  const [saleError, setSaleError] = useState<string | null>(null);
  const [lastReceipt, setLastReceipt] = useState<{ receiptNo: string; amount: number; changeGiven: number; itemName: string; quantity: number } | null>(null);

  // Close Till Modal
  const [isCloseModalOpen, setIsCloseModalOpen] = useState(false);
  const [actualEndingCash, setActualEndingCash] = useState("");
  const [closeNotes, setCloseNotes] = useState("");
  const [isClosing, setIsClosing] = useState(false);
  const [closeoutResult, setCloseoutResult] = useState<any | null>(null);

  const fetchWarehouses = useCallback(async () => {
    try {
      const res = await api.get("/inventory/warehouses");
      if (res.data.success) {
        const whs = res.data.data.warehouses.map((w: any) => ({ id: w.id, name: w.name }));
        setWarehouses(whs);
        setSelectedWarehouseId((prev) => prev || (whs.length > 0 ? whs[0].id : ""));
      }
    } catch (err) {
      console.error("Failed to load warehouses:", err);
    }
  }, []);

  useEffect(() => {
    fetchWarehouses();
  }, [fetchWarehouses]);

  const fetchTillAndItems = useCallback(async () => {
    if (!selectedWarehouseId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const [tillRes, itemsRes] = await Promise.all([
        api.get("/tills/current", { params: { warehouseId: selectedWarehouseId } }),
        api.get("/inventory/items"),
      ]);

      setTill(tillRes.data.success ? tillRes.data.data.till : null);

      if (itemsRes.data.success) {
        const mapped: InventoryItemOption[] = itemsRes.data.data.items
          .map((it: any) => {
            const stock = it.warehouseStocks?.find((s: any) => s.warehouseId === selectedWarehouseId);
            return {
              id: it.id,
              sku: it.sku,
              name: it.name,
              sellingPrice: Number(it.sellingPrice),
              unitOfMeasure: it.unitOfMeasure,
              stockQty: stock ? stock.quantityOnHand : 0,
            };
          })
          .filter((it: InventoryItemOption) => it.stockQty > 0);
        setItems(mapped);
      }
    } catch (err) {
      console.error("Failed to load till/items:", err);
    } finally {
      setIsLoading(false);
    }
  }, [selectedWarehouseId]);

  useEffect(() => {
    fetchTillAndItems();
    setLastReceipt(null);
    setCloseoutResult(null);
  }, [fetchTillAndItems]);

  const handleOpenTill = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsOpeningTill(true);
    try {
      const res = await api.post("/tills/open", { warehouseId: selectedWarehouseId, openingCash: Number(openingCash) });
      if (res.data.success) {
        setOpeningCash("");
        fetchTillAndItems();
      }
    } catch (err: any) {
      alert(err.response?.data?.error || "Failed to open till.");
    } finally {
      setIsOpeningTill(false);
    }
  };

  const selectedItem = items.find((it) => it.id === selectedItemId);
  const saleTotal = selectedItem ? selectedItem.sellingPrice * Number(saleQty || 0) : 0;
  const changeDue = cashGiven ? Number(cashGiven) - saleTotal : 0;

  const handleRecordSale = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaleError(null);
    if (!till || !selectedItem) return;

    if (Number(saleQty) > selectedItem.stockQty) {
      setSaleError(`Only ${selectedItem.stockQty} ${selectedItem.unitOfMeasure} of ${selectedItem.name} in stock here.`);
      return;
    }
    if (Number(cashGiven) < saleTotal) {
      setSaleError(`Cash given must be at least ${formatMoney(saleTotal)}.`);
      return;
    }

    setIsRecordingSale(true);
    try {
      const res = await api.post("/tills/sales", {
        tillId: till.id,
        itemId: selectedItemId,
        quantity: Number(saleQty),
        cashGiven: Number(cashGiven),
      });

      if (res.data.success) {
        setLastReceipt({
          receiptNo: res.data.data.sale.receiptNo,
          amount: res.data.data.totalAmount,
          changeGiven: res.data.data.changeGiven,
          itemName: res.data.data.item.name,
          quantity: Number(saleQty),
        });
        setSelectedItemId("");
        setSaleQty("1");
        setCashGiven("");
        fetchTillAndItems();
      }
    } catch (err: any) {
      setSaleError(err.response?.data?.error || "Failed to record sale.");
    } finally {
      setIsRecordingSale(false);
    }
  };

  const openCloseModal = () => {
    setActualEndingCash("");
    setCloseNotes("");
    setIsCloseModalOpen(true);
  };

  const handleCloseTill = async () => {
    if (!till) return;
    setIsClosing(true);
    try {
      const res = await api.post("/tills/close", {
        tillId: till.id,
        actualEndingCash: Number(actualEndingCash),
        notes: closeNotes,
      });
      if (res.data.success) {
        setCloseoutResult(res.data.data.report);
        setIsCloseModalOpen(false);
        setTill(null);
      }
    } catch (err: any) {
      alert(err.response?.data?.error || "Failed to close till.");
    } finally {
      setIsClosing(false);
    }
  };

  const expectedCash = till ? Number(till.openingCash) + Number(till.cashSalesTotal) : 0;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-secondary-900 dark:text-secondary-50 flex items-center">
            <ShoppingCart className="mr-2 h-7 w-7 text-primary-600" />
            Point of Sale
          </h2>
          <p className="text-secondary-500 dark:text-secondary-400 mt-1">
            Open your shop's cash till, record real sales, and close out with an over/short reconciliation.
          </p>
        </div>

        {warehouses.length > 1 && (
          <select
            className="h-10 px-3 rounded-md border border-secondary-300 bg-white dark:bg-secondary-800 text-secondary-900 dark:text-secondary-50 text-sm"
            value={selectedWarehouseId}
            onChange={(e) => setSelectedWarehouseId(e.target.value)}
          >
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        )}
      </div>

      {warehouses.length === 0 && !isLoading && (
        <Card className="border-dashed">
          <CardContent className="py-8 text-center text-secondary-500">
            No shop/warehouse is available to you. Ask an admin to create one or grant you access under Team Management.
          </CardContent>
        </Card>
      )}

      {closeoutResult && (() => {
        // Prisma Decimal fields serialize to JSON as strings (e.g. "0.00"), so
        // this must be coerced to a real number before comparing - `"0.00" === 0`
        // is false in JS, which previously showed "Short by GH₵0.00" for an
        // exactly-balanced till instead of "Till Balanced".
        const discrepancy = Number(closeoutResult.discrepancy);
        return (
        <Card className={discrepancy === 0 ? "border-emerald-300" : discrepancy > 0 ? "border-blue-300" : "border-red-300"}>
          <CardContent className="py-5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-lg flex items-center">
                  {discrepancy === 0 ? (
                    <><CheckCircle2 className="mr-2 h-5 w-5 text-emerald-600" />Till Balanced</>
                  ) : discrepancy > 0 ? (
                    <><AlertTriangle className="mr-2 h-5 w-5 text-blue-600" />Over by {formatMoney(discrepancy)}</>
                  ) : (
                    <><XCircle className="mr-2 h-5 w-5 text-red-600" />Short by {formatMoney(Math.abs(discrepancy))}</>
                  )}
                </h3>
                <p className="text-sm text-secondary-500 mt-1">
                  Opening {formatMoney(closeoutResult.openingCash)} + Sales {formatMoney(closeoutResult.cashSales)} = Expected {formatMoney(closeoutResult.expectedCash)}, Counted {formatMoney(closeoutResult.actualCash)}.
                </p>
              </div>
              <Button variant="outline" onClick={() => setCloseoutResult(null)}>Dismiss</Button>
            </div>
          </CardContent>
        </Card>
        );
      })()}

      {selectedWarehouseId && !isLoading && !till && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Lock className="mr-2 h-5 w-5 text-amber-600" />
              Open Cash Till
            </CardTitle>
            <CardDescription>
              No till is currently open for {warehouses.find((w) => w.id === selectedWarehouseId)?.name}. Count the cash drawer and enter the starting float to begin selling.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleOpenTill} className="flex items-end gap-3 max-w-sm">
              <div className="flex-1">
                <label className="block text-sm font-medium mb-1">Opening Cash Float</label>
                <Input type="number" required min={0} step="0.01" value={openingCash} onChange={(e) => setOpeningCash(e.target.value)} placeholder="e.g. 200" />
              </div>
              <Button type="submit" variant="primary" disabled={isOpeningTill}>
                {isOpeningTill ? "Opening..." : "Open Till"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {till && (
        <>
          {/* Till Status Banner */}
          <div className="p-4 rounded-xl bg-gradient-to-r from-emerald-900 to-secondary-900 text-white shadow-md flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="grid grid-cols-3 gap-6">
              <div>
                <div className="text-xs text-emerald-300">Opened</div>
                <div className="font-bold">{new Date(till.openedAt).toLocaleTimeString()}</div>
              </div>
              <div>
                <div className="text-xs text-emerald-300">Cash Sales So Far</div>
                <div className="font-bold">{formatMoney(Number(till.cashSalesTotal))}</div>
              </div>
              <div>
                <div className="text-xs text-emerald-300">Expected Drawer Total</div>
                <div className="font-bold">{formatMoney(expectedCash)}</div>
              </div>
            </div>
            <Button variant="outline" onClick={openCloseModal} className="border-white/30 text-white hover:bg-white/10 flex items-center">
              <Unlock className="mr-2 h-4 w-4" />
              Close Till
            </Button>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            {/* Sale Form */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Record a Sale</CardTitle>
                <CardDescription>Select the product a customer is buying and enter cash received.</CardDescription>
              </CardHeader>
              <CardContent>
                {saleError && (
                  <div className="mb-4 p-3 text-sm bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-md border border-red-200 dark:border-red-800">
                    {saleError}
                  </div>
                )}
                <form onSubmit={handleRecordSale} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">Product</label>
                    <select
                      required
                      className="w-full h-10 px-3 rounded-md border border-secondary-300 bg-white dark:bg-secondary-800 text-secondary-900 dark:text-secondary-50 text-sm"
                      value={selectedItemId}
                      onChange={(e) => setSelectedItemId(e.target.value)}
                    >
                      <option value="">-- Select Product --</option>
                      {items.map((it) => (
                        <option key={it.id} value={it.id}>
                          {it.name} ({it.sku}) — {formatMoney(it.sellingPrice)} — {it.stockQty} {it.unitOfMeasure} in stock
                        </option>
                      ))}
                    </select>
                    {items.length === 0 && !isLoading && (
                      <p className="text-xs text-amber-600 mt-1">No products with stock at this shop yet.</p>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium mb-1">Quantity</label>
                      <Input type="number" required min={1} value={saleQty} onChange={(e) => setSaleQty(e.target.value)} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Cash Given</label>
                      <Input type="number" required min={0} step="0.01" value={cashGiven} onChange={(e) => setCashGiven(e.target.value)} />
                    </div>
                  </div>

                  <div className="p-4 bg-secondary-50 dark:bg-secondary-900 rounded-lg grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-xs text-secondary-500">Total Due</div>
                      <div className="text-xl font-bold">{formatMoney(saleTotal)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-secondary-500">Change Due</div>
                      <div className={`text-xl font-bold ${changeDue < 0 ? "text-red-500" : "text-emerald-600"}`}>
                        {formatMoney(Math.max(0, changeDue))}
                      </div>
                    </div>
                  </div>

                  <Button type="submit" variant="primary" className="w-full" disabled={isRecordingSale || !selectedItemId}>
                    {isRecordingSale ? "Recording..." : "Record Sale"}
                  </Button>
                </form>

                {lastReceipt && (
                  <div className="mt-4 p-4 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-lg">
                    <div className="flex items-center text-emerald-800 dark:text-emerald-300 font-bold text-sm mb-1">
                      <Receipt className="mr-1.5 h-4 w-4" />
                      Sale recorded — Receipt {lastReceipt.receiptNo}
                    </div>
                    <p className="text-xs text-emerald-700 dark:text-emerald-400">
                      {lastReceipt.quantity} × {lastReceipt.itemName} — Total {formatMoney(lastReceipt.amount)} — Change given {formatMoney(lastReceipt.changeGiven)}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Recent Sales This Session */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Today's Receipts ({till.sales?.length || 0})</CardTitle>
              </CardHeader>
              <CardContent>
                {(till.sales?.length || 0) === 0 ? (
                  <p className="text-sm text-secondary-500 text-center py-6">No sales recorded yet this session.</p>
                ) : (
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {[...till.sales].reverse().map((sale) => (
                      <div key={sale.id} className="flex items-center justify-between p-2 rounded-md bg-secondary-50 dark:bg-secondary-900 text-xs">
                        <div>
                          <div className="font-mono text-secondary-500">{sale.receiptNo}</div>
                          <div className="text-secondary-400">{new Date(sale.createdAt).toLocaleTimeString()}</div>
                        </div>
                        <div className="font-bold">{formatMoney(Number(sale.amount))}</div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {/* Close Till Modal */}
      <Modal isOpen={isCloseModalOpen} onClose={() => setIsCloseModalOpen(false)} title="Close Cash Till">
        <div className="space-y-4">
          <div className="p-3 bg-secondary-50 dark:bg-secondary-900 rounded-md text-sm">
            <div className="flex justify-between"><span className="text-secondary-500">Opening Cash</span><span>{formatMoney(till ? Number(till.openingCash) : 0)}</span></div>
            <div className="flex justify-between"><span className="text-secondary-500">Cash Sales</span><span>{formatMoney(till ? Number(till.cashSalesTotal) : 0)}</span></div>
            <div className="flex justify-between font-bold border-t border-secondary-200 dark:border-secondary-800 mt-1 pt-1"><span>Expected in Drawer</span><span>{formatMoney(expectedCash)}</span></div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Actual Cash Counted</label>
            <Input type="number" required min={0} step="0.01" value={actualEndingCash} onChange={(e) => setActualEndingCash(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Notes (optional)</label>
            <Input value={closeNotes} onChange={(e) => setCloseNotes(e.target.value)} placeholder="e.g. Torn note found in drawer" />
          </div>
          <div className="flex justify-end space-x-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setIsCloseModalOpen(false)}>Cancel</Button>
            <Button type="button" variant="primary" onClick={handleCloseTill} disabled={isClosing || !actualEndingCash}>
              {isClosing ? "Closing..." : "Close Till & Generate Report"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
