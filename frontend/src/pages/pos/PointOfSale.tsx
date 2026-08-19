import { useState, useEffect, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Modal } from "../../components/ui/Modal";
import { api } from "../../lib/api";
import { formatMoney } from "../../lib/utils";
import { useToast } from "../../contexts/ToastContext";
import { useAuth } from "../../contexts/AuthContext";
import {
  saveCatalogSnapshot,
  getCatalogSnapshot,
  saveWarehousesSnapshot,
  getWarehousesSnapshot,
  saveTillSnapshot,
  getTillSnapshot,
  clearTillSnapshot,
  removePendingSale,
  type OfflinePendingSale,
} from "../../lib/offlineDb";
import { useSaleSyncQueue } from "../../lib/saleSyncQueue";
import { ShoppingCart, Lock, Unlock, Receipt, AlertTriangle, CheckCircle2, XCircle, Search, Plus, Minus, Trash2, Ban, ShieldAlert, WifiOff, RefreshCw } from "lucide-react";

const VOID_AUTHORIZER_ROLES = ["Admin", "Shop Manager", "Accountant"];

interface WarehouseOption {
  id: string;
  name: string;
}

interface InventoryItemOption {
  id: string;
  sku: string;
  name: string;
  sellingPrice: number;
  wholesalePrice: number | null;
  unitOfMeasure: string;
  stockQty: number;
}

interface CartLine {
  itemId: string;
  sku: string;
  name: string;
  unitOfMeasure: string;
  sellingPrice: number;
  wholesalePrice: number | null;
  stockQty: number;
  quantity: number;
}

interface CashSaleLine {
  id: string;
  itemId: string;
  itemName: string;
  itemSku: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

interface CashSale {
  id: string;
  receiptNo: string;
  amount: number;
  cashGiven: number;
  changeGiven: number;
  status: "COMPLETED" | "VOIDED";
  voidedByName?: string | null;
  voidReason?: string | null;
  createdAt: string;
  lines?: CashSaleLine[];
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

interface LastReceipt {
  receiptNo: string;
  amount: number;
  changeGiven: number;
  lines: { itemName: string; quantity: number }[];
}

export function PointOfSale() {
  const { showToast } = useToast();
  const { user } = useAuth();
  const canSelfAuthorizeVoid = user ? VOID_AUTHORIZER_ROLES.includes(user.role) : false;
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState("");
  const [till, setTill] = useState<CashTill | null>(null);
  const [items, setItems] = useState<InventoryItemOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // True whenever till/catalog were restored from the local offline cache
  // rather than a live server response - e.g. the page was reloaded during
  // a genuine connectivity outage, not just dropped mid-session.
  const [isOfflineData, setIsOfflineData] = useState(false);

  // Open Till Form
  const [openingCash, setOpeningCash] = useState("");
  const [isOpeningTill, setIsOpeningTill] = useState(false);

  // Cart
  const [itemSearch, setItemSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cashGiven, setCashGiven] = useState("");
  const [saleType, setSaleType] = useState<"RETAIL" | "WHOLESALE">("RETAIL");
  const [isRecordingSale, setIsRecordingSale] = useState(false);
  const [saleError, setSaleError] = useState<string | null>(null);
  const [lastReceipt, setLastReceipt] = useState<LastReceipt | null>(null);

  // Close Till Modal
  const [isCloseModalOpen, setIsCloseModalOpen] = useState(false);
  const [actualEndingCash, setActualEndingCash] = useState("");
  const [closeNotes, setCloseNotes] = useState("");
  const [isClosing, setIsClosing] = useState(false);
  const [closeoutResult, setCloseoutResult] = useState<any | null>(null);

  // Void Sale Modal
  const [saleToVoid, setSaleToVoid] = useState<CashSale | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [managerEmail, setManagerEmail] = useState("");
  const [managerPassword, setManagerPassword] = useState("");
  const [isVoiding, setIsVoiding] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);

  // Void Activity (manager/admin/accountant visibility into who voids sales
  // and how often - the anomaly-detection surface, not a per-void alert)
  const [voidStats, setVoidStats] = useState<
    { userId: string; name: string; totalSales: number; voidedSales: number; voidRatio: number; anomaly: boolean }[]
  >([]);

  const fetchWarehouses = useCallback(async () => {
    try {
      const res = await api.get("/inventory/warehouses");
      if (res.data.success) {
        const whs = res.data.data.warehouses.map((w: any) => ({ id: w.id, name: w.name }));
        setWarehouses(whs);
        setSelectedWarehouseId((prev) => prev || (whs.length > 0 ? whs[0].id : ""));
        saveWarehousesSnapshot(whs).catch(() => {});
      }
    } catch (err: any) {
      console.error("Failed to load warehouses:", err);
      if (!err.response) {
        // Genuinely offline (no response at all) - a fresh page load during
        // an outage would otherwise have no warehouse to even select, since
        // this only ever lived in React state before. Restore the last-known
        // roster so the rest of the offline flow (till/catalog restore) has
        // a warehouseId to key off.
        const cached = await getWarehousesSnapshot();
        if (cached.length > 0) {
          setWarehouses(cached);
          setSelectedWarehouseId((prev) => prev || cached[0].id);
        }
      }
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

      const liveTill = tillRes.data.success ? tillRes.data.data.till : null;
      setTill(liveTill);
      setIsOfflineData(false);
      if (liveTill) {
        saveTillSnapshot(selectedWarehouseId, liveTill).catch(() => {});
      } else {
        clearTillSnapshot(selectedWarehouseId).catch(() => {});
      }

      if (itemsRes.data.success) {
        const mapped: InventoryItemOption[] = itemsRes.data.data.items
          .map((it: any) => {
            const stock = it.warehouseStocks?.find((s: any) => s.warehouseId === selectedWarehouseId);
            return {
              id: it.id,
              sku: it.sku,
              name: it.name,
              sellingPrice: Number(it.sellingPrice),
              wholesalePrice: it.wholesalePrice != null ? Number(it.wholesalePrice) : null,
              unitOfMeasure: it.unitOfMeasure,
              stockQty: stock ? stock.quantityOnHand : 0,
            };
          })
          .filter((it: InventoryItemOption) => it.stockQty > 0);
        setItems(mapped);
        // Opportunistic offline-catalog refresh - the only way a cashier can
        // still search/add products to a cart once connectivity drops.
        saveCatalogSnapshot(selectedWarehouseId, mapped).catch(() => {});
      }
    } catch (err: any) {
      console.error("Failed to load till/items:", err);
      if (!err.response) {
        // Genuinely offline - restore the last-known till/catalog for this
        // warehouse so a page reload/reopen *during* an outage doesn't
        // strand the cashier on the "Open Till" screen (till state would
        // otherwise reset to null on every cold load) or with an empty,
        // unsearchable catalog. Flagged as cached (not live) via
        // isOfflineData rather than presented as confirmed current truth -
        // stock counts here reflect a moment-in-time snapshot; unavailableQtyFor
        // (below) layers this device's own still-unsynced sales on top so at
        // least this session can't oversell the same unit twice, but another
        // device selling from the same warehouse isn't visible until sync.
        const [cachedTill, cachedItems] = await Promise.all([
          getTillSnapshot(selectedWarehouseId),
          getCatalogSnapshot(selectedWarehouseId),
        ]);
        if (cachedTill) {
          setTill(cachedTill as CashTill);
          setIsOfflineData(true);
        }
        if (cachedItems.length > 0) {
          setItems(cachedItems);
        }
      }
    } finally {
      setIsLoading(false);
    }
  }, [selectedWarehouseId]);

  // Hybrid-offline sale queue for the current till - a sale rung up while
  // offline gets queued locally and replayed automatically once connectivity
  // returns (or on demand via "Sync Now"). Till open/close and voids stay
  // online-only; only cart -> submit-sale is offline-capable.
  const { pendingSales, needsAttention, pendingTotal, isSyncing, syncNow, queueSale, refreshPending } = useSaleSyncQueue(
    till?.id ?? null,
    fetchTillAndItems
  );

  const cancelPendingSale = async (clientTxnId: string) => {
    await removePendingSale(clientTxnId);
    await refreshPending();
  };

  useEffect(() => {
    fetchTillAndItems();
    setLastReceipt(null);
    setCloseoutResult(null);
    setCart([]);
    setItemSearch("");
  }, [fetchTillAndItems]);

  // Once connectivity genuinely returns, refresh with live data - the sync
  // queue's own "online" handler only re-fetches when it actually synced a
  // pending sale (via onSynced), so a session that was showing offline-cached
  // till/catalog data with nothing queued (e.g. just browsing, or every sale
  // already synced) would otherwise stay stale indefinitely.
  useEffect(() => {
    const handleBackOnline = () => {
      fetchWarehouses();
      fetchTillAndItems();
    };
    window.addEventListener("online", handleBackOnline);
    return () => window.removeEventListener("online", handleBackOnline);
  }, [fetchWarehouses, fetchTillAndItems]);

  const fetchVoidStats = useCallback(async () => {
    if (!canSelfAuthorizeVoid) return;
    try {
      const res = await api.get("/tills/void-stats");
      if (res.data.success) setVoidStats(res.data.data);
    } catch (err) {
      console.error("Failed to load void statistics:", err);
    }
  }, [canSelfAuthorizeVoid]);

  useEffect(() => {
    fetchVoidStats();
  }, [fetchVoidStats, till]);

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
      showToast(err.response?.data?.error || "Failed to open till.", "error");
    } finally {
      setIsOpeningTill(false);
    }
  };

  // Cart helpers - the search list shows "stock remaining to add" (physical
  // stock minus what's already sitting in the cart), so a cashier can never
  // build a cart that the backend would reject for exceeding stock.
  const cartQtyFor = (itemId: string) => cart.find((l) => l.itemId === itemId)?.quantity || 0;

  // Stock already claimed by this device's own still-unsynced sales for this
  // till - without this, a cashier could sell the same last unit twice across
  // two separate carts within one offline outage before either sale actually
  // reaches the server (there is still no server-side offline stock
  // reservation - the backend only enforces this at sync time, per line).
  // Only "pending"/"syncing" sales reserve stock - a "failed" sale was
  // explicitly rejected by the server (often *because* of a real stock
  // conflict), so its items are no longer assumed reserved once failed.
  const pendingReservedByItemId = new Map<string, number>();
  for (const sale of pendingSales) {
    if (sale.status === "failed") continue;
    for (const line of sale.lines) {
      pendingReservedByItemId.set(line.itemId, (pendingReservedByItemId.get(line.itemId) || 0) + line.quantity);
    }
  }
  const unavailableQtyFor = (itemId: string) => cartQtyFor(itemId) + (pendingReservedByItemId.get(itemId) || 0);

  const filteredItems = items.filter((it) => {
    const q = itemSearch.trim().toLowerCase();
    if (!q) return true;
    return it.name.toLowerCase().includes(q) || it.sku.toLowerCase().includes(q);
  });

  const addToCart = (item: InventoryItemOption) => {
    const remaining = item.stockQty - unavailableQtyFor(item.id);
    if (remaining <= 0) return;
    setCart((prev) => {
      const existing = prev.find((l) => l.itemId === item.id);
      if (existing) {
        return prev.map((l) => (l.itemId === item.id ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [
        ...prev,
        {
          itemId: item.id,
          sku: item.sku,
          name: item.name,
          unitOfMeasure: item.unitOfMeasure,
          sellingPrice: item.sellingPrice,
          wholesalePrice: item.wholesalePrice,
          stockQty: item.stockQty,
          quantity: 1,
        },
      ];
    });
  };

  // Effective price for a cart line based on current saleType
  const effectivePriceFor = (l: CartLine) =>
    saleType === "WHOLESALE" && l.wholesalePrice != null ? l.wholesalePrice : l.sellingPrice;

  const adjustCartQty = (itemId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((l) => {
          if (l.itemId !== itemId) return l;
          const maxAllowed = l.stockQty - (pendingReservedByItemId.get(itemId) || 0);
          return { ...l, quantity: Math.min(maxAllowed, l.quantity + delta) };
        })
        .filter((l) => l.quantity > 0)
    );
  };

  const removeFromCart = (itemId: string) => setCart((prev) => prev.filter((l) => l.itemId !== itemId));

  const cartTotal = cart.reduce((sum, l) => sum + effectivePriceFor(l) * l.quantity, 0);
  const changeDue = cashGiven ? Number(cashGiven) - cartTotal : 0;

  const handleRecordSale = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaleError(null);
    if (!till || cart.length === 0) return;

    if (Number(cashGiven) < cartTotal) {
      setSaleError(`Cash given must be at least ${formatMoney(cartTotal)}.`);
      return;
    }

    setIsRecordingSale(true);
    // Generated even for an online sale (not just an offline bolt-on) - this
    // makes POST /tills/sales retry-safe in general, e.g. a double-tap submit
    // or a request that times out client-side but actually succeeded
    // server-side, not only the offline-queue case below.
    const clientTxnId = crypto.randomUUID();
    const clientOccurredAt = new Date().toISOString();
    try {
      const res = await api.post("/tills/sales", {
        tillId: till.id,
        items: cart.map((l) => ({ itemId: l.itemId, quantity: l.quantity })),
        cashGiven: Number(cashGiven),
        saleType,
        clientTxnId,
        clientOccurredAt,
      });

      if (res.data.success) {
        setLastReceipt({
          receiptNo: res.data.data.sale.receiptNo,
          amount: res.data.data.totalAmount,
          changeGiven: res.data.data.changeGiven,
          lines: res.data.data.lines.map((l: any) => ({ itemName: l.itemName, quantity: l.quantity })),
        });
        setCart([]);
        setItemSearch("");
        setCashGiven("");
        fetchTillAndItems();
      }
    } catch (err: any) {
      if (!err.response) {
        // No response at all - genuinely offline (or a transient network
        // blip), as opposed to a real rejection from the server (insufficient
        // stock, till not open, etc). Queue it locally instead of losing the
        // sale - the cashier keeps working, the sync loop replays it once
        // connectivity returns.
        const queuedSale: OfflinePendingSale = {
          clientTxnId,
          tillId: till.id,
          warehouseId: till.warehouseId,
          lines: cart.map((l) => ({ itemId: l.itemId, quantity: l.quantity, itemName: l.name, itemSku: l.sku, unitPrice: effectivePriceFor(l) })),
          cashGiven: Number(cashGiven),
          saleType,
          clientOccurredAt,
          queuedAt: Date.now(),
          status: "pending",
        };
        await queueSale(queuedSale);
        showToast(`Sale queued (offline) - will sync automatically once back online.`, "info");
        setCart([]);
        setItemSearch("");
        setCashGiven("");
      } else {
        setSaleError(err.response?.data?.error || "Failed to record sale.");
      }
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
    if (pendingSales.length > 0) {
      showToast(`${pendingSales.length} sale${pendingSales.length === 1 ? "" : "s"} still pending sync - reconnect and sync before closing the till.`, "error");
      return;
    }
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
        clearTillSnapshot(till.warehouseId).catch(() => {});
      }
    } catch (err: any) {
      showToast(err.response?.data?.error || "Failed to close till.", "error");
    } finally {
      setIsClosing(false);
    }
  };

  const openVoidModal = (sale: CashSale) => {
    setSaleToVoid(sale);
    setVoidReason("");
    setManagerEmail("");
    setManagerPassword("");
    setVoidError(null);
  };

  const handleVoidSale = async () => {
    if (!saleToVoid) return;
    if (!voidReason.trim()) {
      setVoidError("Please enter a reason for voiding this sale.");
      return;
    }
    if (!canSelfAuthorizeVoid && (!managerEmail.trim() || !managerPassword)) {
      setVoidError("A manager must confirm this void with their email and password.");
      return;
    }

    setIsVoiding(true);
    setVoidError(null);
    try {
      const res = await api.post(`/tills/sales/${saleToVoid.id}/void`, {
        reason: voidReason.trim(),
        ...(canSelfAuthorizeVoid ? {} : { managerEmail: managerEmail.trim(), managerPassword }),
      });
      if (res.data.success) {
        showToast(`Sale ${saleToVoid.receiptNo} voided.`, "success");
        setSaleToVoid(null);
        fetchTillAndItems();
      }
    } catch (err: any) {
      setVoidError(err.response?.data?.error || "Failed to void sale.");
    } finally {
      setIsVoiding(false);
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
                <div className="font-bold">
                  {formatMoney(Number(till.cashSalesTotal))}
                  {pendingTotal > 0 && (
                    <span className="ml-1.5 text-xs font-normal text-amber-300">(+ {formatMoney(pendingTotal)} pending sync)</span>
                  )}
                </div>
              </div>
              <div>
                <div className="text-xs text-emerald-300">Expected Drawer Total</div>
                <div className="font-bold">{formatMoney(expectedCash + pendingTotal)}</div>
              </div>
            </div>
            <Button variant="outline" onClick={openCloseModal} className="border-white/30 text-white hover:bg-white/10 flex items-center">
              <Unlock className="mr-2 h-4 w-4" />
              Close Till
            </Button>
          </div>

          {isOfflineData && (
            <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 flex items-center text-blue-800 dark:text-blue-300 text-sm">
              <WifiOff className="h-4 w-4 mr-2 flex-shrink-0" />
              <span>
                Showing till and catalog data saved from before this outage - stock counts and today's totals may be out of date. Reconnect to confirm.
              </span>
            </div>
          )}

          {pendingSales.length > 0 && (
            <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center text-amber-800 dark:text-amber-300 text-sm">
                <WifiOff className="h-4 w-4 mr-2 flex-shrink-0" />
                <span>
                  <strong>{pendingSales.length}</strong> sale{pendingSales.length === 1 ? "" : "s"} queued offline, not yet synced
                  {needsAttention.length > 0 && (
                    <span className="text-red-600 dark:text-red-400"> — {needsAttention.length} need{needsAttention.length === 1 ? "s" : ""} attention</span>
                  )}
                  . The till stays open until these sync.
                </span>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => syncNow()} disabled={isSyncing} className="flex items-center text-xs flex-shrink-0">
                <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${isSyncing ? "animate-spin" : ""}`} />
                {isSyncing ? "Syncing..." : "Sync Now"}
              </Button>
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-3">
            {/* Cart / Sale Form */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Record a Sale</CardTitle>
                <CardDescription>Search for products, add them to the basket, then check out the whole basket at once.</CardDescription>
              </CardHeader>
              <CardContent>
                {saleError && (
                  <div className="mb-4 p-3 text-sm bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-md border border-red-200 dark:border-red-800">
                    {saleError}
                  </div>
                )}

                {/* Sale Type Toggle */}
                <div className="flex rounded-md border border-secondary-200 dark:border-secondary-800 p-1 text-sm mb-4">
                  <button
                    type="button"
                    onClick={() => setSaleType("RETAIL")}
                    className={`flex-1 py-1.5 rounded text-xs font-medium ${saleType === "RETAIL" ? "bg-primary-600 text-white" : "text-secondary-500"}`}
                  >
                    Retail Sale
                  </button>
                  <button
                    type="button"
                    onClick={() => setSaleType("WHOLESALE")}
                    className={`flex-1 py-1.5 rounded text-xs font-medium ${saleType === "WHOLESALE" ? "bg-blue-600 text-white" : "text-secondary-500"}`}
                  >
                    Wholesale Sale
                  </button>
                </div>

                {/* Product Search */}
                <div className="relative mb-3">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-secondary-400" />
                  <Input
                    type="text"
                    placeholder="Search product by name or SKU..."
                    value={itemSearch}
                    onChange={(e) => setItemSearch(e.target.value)}
                    className="pl-9"
                  />
                </div>

                {items.length === 0 && !isLoading ? (
                  <p className="text-xs text-amber-600 mb-4">No products with stock at this shop yet.</p>
                ) : (
                  <div className="max-h-48 overflow-y-auto border border-secondary-200 dark:border-secondary-800 rounded-lg mb-4 divide-y divide-secondary-100 dark:divide-secondary-800">
                    {filteredItems.length === 0 ? (
                      <div className="p-3 text-xs text-secondary-500 text-center">No products match "{itemSearch}".</div>
                    ) : (
                      filteredItems.map((it) => {
                        const reserved = pendingReservedByItemId.get(it.id) || 0;
                        const remaining = it.stockQty - unavailableQtyFor(it.id);
                        return (
                          <button
                            type="button"
                            key={it.id}
                            onClick={() => addToCart(it)}
                            disabled={remaining <= 0}
                            className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-secondary-50 dark:hover:bg-secondary-900 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                          >
                            <div>
                              <div className="text-sm font-medium text-secondary-900 dark:text-secondary-50">{it.name}</div>
                              <div className="text-xs text-secondary-500">
                                {it.sku} — {formatMoney(saleType === "WHOLESALE" && it.wholesalePrice != null ? it.wholesalePrice : it.sellingPrice)}
                                {saleType === "WHOLESALE" && it.wholesalePrice != null && (
                                  <span className="text-blue-600 dark:text-blue-400"> (wholesale)</span>
                                )}
                                {" "}— {remaining} {it.unitOfMeasure} left
                                {reserved > 0 && (
                                  <span className="text-amber-600 dark:text-amber-400"> ({reserved} held by pending offline sale{reserved === 1 ? "" : "s"})</span>
                                )}
                              </div>
                            </div>
                            <Plus className="h-4 w-4 text-primary-600 flex-shrink-0 ml-2" />
                          </button>
                        );
                      })
                    )}
                  </div>
                )}

                {/* Cart */}
                <div className="border border-secondary-200 dark:border-secondary-800 rounded-lg overflow-hidden mb-4">
                  {cart.length === 0 ? (
                    <div className="p-6 text-center text-sm text-secondary-500">
                      Basket is empty. Search above and click a product to add it.
                    </div>
                  ) : (
                    <table className="w-full text-sm">
                      <tbody>
                        {cart.map((l) => (
                          <tr key={l.itemId} className="border-t border-secondary-100 dark:border-secondary-800 first:border-t-0">
                            <td className="p-2">
                              <div className="font-medium text-secondary-900 dark:text-secondary-50">{l.name}</div>
                              <div className="text-xs text-secondary-500">
                                {formatMoney(effectivePriceFor(l))} / {l.unitOfMeasure}
                                {saleType === "WHOLESALE" && l.wholesalePrice != null && (
                                  <span className="text-blue-600 dark:text-blue-400 ml-1">(wholesale)</span>
                                )}
                              </div>
                            </td>
                            <td className="p-2">
                              <div className="flex items-center gap-1.5">
                                <button type="button" onClick={() => adjustCartQty(l.itemId, -1)} className="h-6 w-6 flex items-center justify-center rounded bg-secondary-100 dark:bg-secondary-800 hover:bg-secondary-200 dark:hover:bg-secondary-700">
                                  <Minus className="h-3 w-3" />
                                </button>
                                <span className="w-8 text-center font-medium">{l.quantity}</span>
                                <button
                                  type="button"
                                  onClick={() => adjustCartQty(l.itemId, 1)}
                                  disabled={l.quantity >= l.stockQty}
                                  className="h-6 w-6 flex items-center justify-center rounded bg-secondary-100 dark:bg-secondary-800 hover:bg-secondary-200 dark:hover:bg-secondary-700 disabled:opacity-40"
                                >
                                  <Plus className="h-3 w-3" />
                                </button>
                              </div>
                            </td>
                            <td className="p-2 text-right font-semibold whitespace-nowrap">{formatMoney(effectivePriceFor(l) * l.quantity)}</td>
                            <td className="p-2">
                              <button type="button" onClick={() => removeFromCart(l.itemId)} className="text-secondary-400 hover:text-red-500 p-1">
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                <form onSubmit={handleRecordSale} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-xs text-secondary-500">Basket Total</div>
                      <div className="text-xl font-bold">{formatMoney(cartTotal)}</div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Cash Given</label>
                      <Input type="number" required min={0} step="0.01" value={cashGiven} onChange={(e) => setCashGiven(e.target.value)} disabled={cart.length === 0} />
                    </div>
                  </div>

                  <div className="p-4 bg-secondary-50 dark:bg-secondary-900 rounded-lg">
                    <div className="text-xs text-secondary-500">Change Due</div>
                    <div className={`text-xl font-bold ${changeDue < 0 ? "text-red-500" : "text-emerald-600"}`}>
                      {formatMoney(Math.max(0, changeDue))}
                    </div>
                  </div>

                  <Button type="submit" variant="primary" className="w-full" disabled={isRecordingSale || cart.length === 0 || !cashGiven}>
                    {isRecordingSale ? "Recording..." : `Record Sale${cart.length > 0 ? ` (${cart.length} item${cart.length === 1 ? "" : "s"})` : ""}`}
                  </Button>
                </form>

                {lastReceipt && (
                  <div className="mt-4 p-4 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-lg">
                    <div className="flex items-center text-emerald-800 dark:text-emerald-300 font-bold text-sm mb-1">
                      <Receipt className="mr-1.5 h-4 w-4" />
                      Sale recorded — Receipt {lastReceipt.receiptNo}
                    </div>
                    <p className="text-xs text-emerald-700 dark:text-emerald-400">
                      {lastReceipt.lines.map((l) => `${l.quantity} × ${l.itemName}`).join(", ")} — Total {formatMoney(lastReceipt.amount)} — Change given {formatMoney(lastReceipt.changeGiven)}
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
                {pendingSales.length > 0 && (
                  <div className="space-y-2 mb-3 pb-3 border-b border-secondary-200 dark:border-secondary-800">
                    {pendingSales.map((sale) => {
                      const amount = sale.lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
                      const isFailed = sale.status === "failed";
                      return (
                        <div
                          key={sale.clientTxnId}
                          className={`p-2 rounded-md text-xs ${isFailed ? "bg-red-50 dark:bg-red-950/20" : "bg-amber-50 dark:bg-amber-950/20"}`}
                        >
                          <div className="flex items-center justify-between">
                            <div className={`flex items-center font-medium ${isFailed ? "text-red-700 dark:text-red-400" : "text-amber-700 dark:text-amber-400"}`}>
                              <WifiOff className="h-3 w-3 mr-1" />
                              {isFailed ? "Needs Attention" : "Pending Sync"}
                            </div>
                            <div className="font-bold">{formatMoney(amount)}</div>
                          </div>
                          <div className="text-secondary-400 flex items-center justify-between mt-0.5">
                            <span className="truncate max-w-[60%]" title={sale.lines.map((l) => `${l.quantity}× ${l.itemName}`).join(", ")}>
                              {sale.lines.map((l) => `${l.quantity}× ${l.itemName}`).join(", ")}
                            </span>
                            <span>{new Date(sale.clientOccurredAt).toLocaleTimeString()}</span>
                          </div>
                          {isFailed && sale.failureReason && (
                            <div className="mt-1 text-red-600 dark:text-red-400">{sale.failureReason}</div>
                          )}
                          <button
                            type="button"
                            onClick={() => cancelPendingSale(sale.clientTxnId)}
                            className="mt-1 flex items-center text-secondary-400 hover:text-red-500 font-medium"
                          >
                            <Ban className="h-3 w-3 mr-1" />
                            Cancel (never synced)
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
                {(till.sales?.length || 0) === 0 ? (
                  <p className="text-sm text-secondary-500 text-center py-6">No sales recorded yet this session.</p>
                ) : (
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {[...till.sales].reverse().map((sale) => (
                      <div
                        key={sale.id}
                        className={`p-2 rounded-md text-xs ${sale.status === "VOIDED" ? "bg-red-50 dark:bg-red-950/20 opacity-70" : "bg-secondary-50 dark:bg-secondary-900"}`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="font-mono text-secondary-500">{sale.receiptNo}</div>
                          <div className={`font-bold ${sale.status === "VOIDED" ? "line-through text-red-500" : ""}`}>
                            {formatMoney(Number(sale.amount))}
                          </div>
                        </div>
                        <div className="text-secondary-400 flex items-center justify-between mt-0.5">
                          <span className="truncate max-w-[60%]" title={sale.lines?.map((l) => `${l.quantity}× ${l.itemName}`).join(", ")}>
                            {sale.lines?.map((l) => `${l.quantity}× ${l.itemName}`).join(", ") || "—"}
                          </span>
                          <span>{new Date(sale.createdAt).toLocaleTimeString()}</span>
                        </div>
                        {sale.status === "VOIDED" ? (
                          <div className="mt-1 flex items-center text-red-600 dark:text-red-400 font-medium">
                            <Ban className="h-3 w-3 mr-1" />
                            Voided by {sale.voidedByName}{sale.voidReason ? ` — ${sale.voidReason}` : ""}
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => openVoidModal(sale)}
                            className="mt-1 flex items-center text-secondary-400 hover:text-red-500 font-medium"
                          >
                            <Ban className="h-3 w-3 mr-1" />
                            Void this sale
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {canSelfAuthorizeVoid && voidStats.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center">
                  <ShieldAlert className="mr-2 h-4 w-4 text-amber-600" />
                  Void Activity by Cashier
                </CardTitle>
                <CardDescription>
                  Cash sales voided per staff member across this shop. A high void ratio is worth a conversation, not automatically fraud - use judgment.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-secondary-500 border-b border-secondary-200 dark:border-secondary-800">
                        <th className="pb-2 pr-4">Staff Member</th>
                        <th className="pb-2 pr-4 text-right">Total Sales</th>
                        <th className="pb-2 pr-4 text-right">Voided</th>
                        <th className="pb-2 text-right">Void Ratio</th>
                      </tr>
                    </thead>
                    <tbody>
                      {voidStats.map((row) => (
                        <tr key={row.userId} className="border-b border-secondary-100 dark:border-secondary-800 last:border-0">
                          <td className="py-2 pr-4">
                            <div className="flex items-center">
                              {row.anomaly && <AlertTriangle className="h-3.5 w-3.5 text-red-500 mr-1.5" />}
                              <span className={row.anomaly ? "font-bold text-red-600 dark:text-red-400" : ""}>{row.name}</span>
                            </div>
                          </td>
                          <td className="py-2 pr-4 text-right">{row.totalSales}</td>
                          <td className="py-2 pr-4 text-right">{row.voidedSales}</td>
                          <td className={`py-2 text-right font-semibold ${row.anomaly ? "text-red-600 dark:text-red-400" : ""}`}>
                            {(row.voidRatio * 100).toFixed(1)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
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
          {pendingSales.length > 0 && (
            <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md text-xs text-amber-800 dark:text-amber-300 flex items-center">
              <WifiOff className="h-4 w-4 mr-2 flex-shrink-0" />
              {pendingSales.length} sale{pendingSales.length === 1 ? "" : "s"} still pending sync - reconnect and sync before closing the till.
            </div>
          )}
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
            <Button type="button" variant="primary" onClick={handleCloseTill} disabled={isClosing || !actualEndingCash || pendingSales.length > 0}>
              {isClosing ? "Closing..." : "Close Till & Generate Report"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Void Sale Modal */}
      <Modal isOpen={!!saleToVoid} onClose={() => setSaleToVoid(null)} title="Void Sale">
        <div className="space-y-4">
          {saleToVoid && (
            <div className="p-3 bg-secondary-50 dark:bg-secondary-900 rounded-md text-sm">
              <div className="flex justify-between"><span className="text-secondary-500">Receipt</span><span className="font-mono">{saleToVoid.receiptNo}</span></div>
              <div className="flex justify-between font-bold"><span>Amount</span><span>{formatMoney(Number(saleToVoid.amount))}</span></div>
            </div>
          )}

          {voidError && (
            <div className="p-3 text-sm bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-md border border-red-200 dark:border-red-800">
              {voidError}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1">Reason for voiding</label>
            <Input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="e.g. Wrong item scanned, customer changed their mind" />
          </div>

          {!canSelfAuthorizeVoid && (
            <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md space-y-3">
              <div className="flex items-center text-amber-800 dark:text-amber-300 text-xs font-bold">
                <ShieldAlert className="h-4 w-4 mr-1.5" />
                A manager must confirm this void
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Manager Email</label>
                <Input type="email" value={managerEmail} onChange={(e) => setManagerEmail(e.target.value)} placeholder="manager@business.com" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Manager Password</label>
                <Input type="password" value={managerPassword} onChange={(e) => setManagerPassword(e.target.value)} placeholder="Manager's own password" />
              </div>
            </div>
          )}

          <div className="flex justify-end space-x-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setSaleToVoid(null)}>Cancel</Button>
            <Button type="button" variant="danger" onClick={handleVoidSale} disabled={isVoiding || !voidReason.trim()}>
              {isVoiding ? "Voiding..." : "Void Sale"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
