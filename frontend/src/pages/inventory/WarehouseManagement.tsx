import React, { useState, useEffect, useCallback, useRef } from "react";
import Papa from "papaparse";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "../../components/ui/Table";
import { Modal } from "../../components/ui/Modal";
import { api } from "../../lib/api";
import { formatMoney } from "../../lib/utils";
import { useToast } from "../../contexts/ToastContext";
import { useAuth } from "../../contexts/AuthContext";
import { Warehouse, Plus, ArrowRightLeft, AlertTriangle, Building, MapPin, Search, CheckCircle2, XCircle, Layers, Trash2, Download, SlidersHorizontal, History, Printer, ClipboardCheck } from "lucide-react";

interface StockAdjustment {
  id: string;
  mode: "add" | "remove" | "set";
  previousQty: number;
  newQty: number;
  delta: number;
  reason: string;
  adjustedByName?: string;
  createdAt: string;
  item?: { name: string; unitOfMeasure: string };
  warehouse?: { name: string };
}

interface StockTakeRow {
  itemId: string;
  sku: string;
  name: string;
  unitOfMeasure: string;
  systemQty: number;
  countedQty: string;
}

interface BulkRow {
  name: string;
  sku: string;
  category: string;
  unitOfMeasure: string;
  costPrice: string;
  sellingPrice: string;
  warehouseName: string;
  initialQty: string;
}

const EMPTY_BULK_ROW: BulkRow = {
  name: "",
  sku: "",
  category: "General",
  unitOfMeasure: "pcs",
  costPrice: "",
  sellingPrice: "",
  warehouseName: "",
  initialQty: "",
};

const CSV_TEMPLATE_HEADERS = ["name", "sku", "category", "unitOfMeasure", "costPrice", "sellingPrice", "warehouseName", "initialQty"];
const CSV_TEMPLATE_EXAMPLE_ROW = ["Samsung 24 Inch LED Monitor", "MON-001", "Electronics", "pcs", "150", "250", "Shop A (Downtown Branch)", "50"];

interface WarehouseStock {
  id: string;
  warehouseId: string;
  itemId: string;
  quantityOnHand: number;
  warehouse?: { name: string; code: string };
}

interface InventoryItem {
  id: string;
  sku: string;
  name: string;
  category: string;
  unitOfMeasure: string;
  costPrice: number;
  sellingPrice: number;
  wholesalePrice?: number | null;
  reorderLevel: number;
  warehouseStocks: WarehouseStock[];
}

interface WarehouseData {
  id: string;
  name: string;
  code: string;
  location?: string;
  managerName?: string;
  isPrimary: boolean;
  stocks: WarehouseStock[];
}

// Creating a new warehouse/shop is a business-setup action, not a
// day-to-day shop task - kept Accountant/Admin-only on the backend even
// though Shop Manager/Cashier are otherwise fully operational on this page
// (stock adjustments, transfers, stock-take, adding products). Mirrors that
// restriction here so the button doesn't render a false promise.
const WAREHOUSE_CREATE_RESTRICTED_ROLES = new Set(["shop manager", "cashier"]);

export function WarehouseManagement() {
  const { showToast } = useToast();
  const { user } = useAuth();
  const canCreateWarehouse = !WAREHOUSE_CREATE_RESTRICTED_ROLES.has((user?.role || "").toLowerCase().trim());
  const [warehouses, setWarehouses] = useState<WarehouseData[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState("");
  const [filterLowStockOnly, setFilterLowStockOnly] = useState(false);

  // Modals
  const [isWarehouseModalOpen, setIsWarehouseModalOpen] = useState(false);
  const [isItemModalOpen, setIsItemModalOpen] = useState(false);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [isAdjustModalOpen, setIsAdjustModalOpen] = useState(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [isStockTakeModalOpen, setIsStockTakeModalOpen] = useState(false);
  const [printingStockSheetId, setPrintingStockSheetId] = useState<string | null>(null);

  // Stock Adjustment Form State
  const [adjustItemId, setAdjustItemId] = useState("");
  const [adjustWarehouseId, setAdjustWarehouseId] = useState("");
  const [adjustMode, setAdjustMode] = useState<"add" | "remove" | "set">("add");
  const [adjustQty, setAdjustQty] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [isAdjusting, setIsAdjusting] = useState(false);

  // Adjustment History State
  const [adjustmentHistory, setAdjustmentHistory] = useState<StockAdjustment[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);

  // Stock Take State
  const [stockTakeWarehouseId, setStockTakeWarehouseId] = useState("");
  const [stockTakeWarehouseName, setStockTakeWarehouseName] = useState("");
  const [stockTakeStep, setStockTakeStep] = useState<"entry" | "preview">("entry");
  const [stockTakeTab, setStockTakeTab] = useState<"table" | "csv">("table");
  const [stockTakeRows, setStockTakeRows] = useState<StockTakeRow[]>([]);
  const [isStockTakeSubmitting, setIsStockTakeSubmitting] = useState(false);
  const [stockTakeResult, setStockTakeResult] = useState<{ applied: number; unchanged: number; notFound: number } | null>(null);
  const stockTakeCsvFileInputRef = useRef<HTMLInputElement>(null);

  // Bulk Add State
  const [bulkTab, setBulkTab] = useState<"table" | "csv">("table");
  const [bulkRows, setBulkRows] = useState<BulkRow[]>([{ ...EMPTY_BULK_ROW }, { ...EMPTY_BULK_ROW }, { ...EMPTY_BULK_ROW }]);
  const [bulkResult, setBulkResult] = useState<{ created: number; failed: { index: number; name?: string; error: string }[] } | null>(null);
  const [isBulkSubmitting, setIsBulkSubmitting] = useState(false);
  const csvFileInputRef = useRef<HTMLInputElement>(null);

  // Warehouse Form State
  const [whName, setWhName] = useState("");
  const [whLocation, setWhLocation] = useState("");
  const [whManager, setWhManager] = useState("");

  // Item Form State
  const [itemName, setItemName] = useState("");
  const [itemSku, setItemSku] = useState("");
  const [category, setCategory] = useState("General");
  const [unitOfMeasure, setUnitOfMeasure] = useState("pcs");
  const [costPrice, setCostPrice] = useState("150");
  const [sellingPrice, setSellingPrice] = useState("250");
  const [wholesalePrice, setWholesalePrice] = useState("");
  const [initialWarehouseId, setInitialWarehouseId] = useState("");
  const [initialQty, setInitialQty] = useState("50");
  const [preferredVendorId, setPreferredVendorId] = useState("");
  const [vendors, setVendors] = useState<{ id: string; name: string }[]>([]);

  // Transfer Form State
  const [fromWarehouseId, setFromWarehouseId] = useState("");
  const [toWarehouseId, setToWarehouseId] = useState("");
  const [selectedItemId, setSelectedItemId] = useState("");
  const [transferQty, setTransferQty] = useState("10");
  const [transferNotes, setTransferNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [whRes, itemRes, vendorRes] = await Promise.all([
        api.get("/inventory/warehouses"),
        api.get("/inventory/items"),
        api.get("/bills/vendors"),
      ]);

      if (whRes.data.success) setWarehouses(whRes.data.data.warehouses);
      if (itemRes.data.success) setItems(itemRes.data.data.items);
      if (vendorRes.data.success) setVendors(vendorRes.data.data.vendors);
    } catch (err) {
      console.error("Failed to load inventory data:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleAddWarehouse = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const res = await api.post("/inventory/warehouses", {
        name: whName,
        location: whLocation,
        managerName: whManager,
      });

      if (res.data.success) {
        setWhName("");
        setWhLocation("");
        setWhManager("");
        setIsWarehouseModalOpen(false);
        fetchData();
      }
    } catch (err: any) {
      showToast(err.response?.data?.error || "Failed to add warehouse.", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const res = await api.post("/inventory/items", {
        name: itemName,
        sku: itemSku,
        category,
        unitOfMeasure,
        costPrice: Number(costPrice),
        sellingPrice: Number(sellingPrice),
        wholesalePrice: wholesalePrice !== "" ? Number(wholesalePrice) : undefined,
        initialWarehouseId,
        initialQty: Number(initialQty),
        preferredVendorId: preferredVendorId || undefined,
      });

      if (res.data.success) {
        setItemName("");
        setItemSku("");
        setPreferredVendorId("");
        setIsItemModalOpen(false);
        fetchData();
      }
    } catch (err: any) {
      showToast(err.response?.data?.error || "Failed to create item.", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTransferStock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (fromWarehouseId === toWarehouseId) {
      showToast("Source and destination warehouses must be different.", "error");
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await api.post("/inventory/transfers", {
        fromWarehouseId,
        toWarehouseId,
        itemId: selectedItemId,
        quantity: Number(transferQty),
        notes: transferNotes,
      });

      if (res.data.success) {
        setIsTransferModalOpen(false);
        fetchData();
      }
    } catch (err: any) {
      showToast(err.response?.data?.error || "Transfer failed.", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const openQuickTransferModal = (itemId: string, originWarehouseId: string) => {
    setSelectedItemId(itemId);
    setFromWarehouseId(originWarehouseId);
    // Find first destination warehouse different from origin
    const dest = warehouses.find(w => w.id !== originWarehouseId);
    if (dest) setToWarehouseId(dest.id);
    setIsTransferModalOpen(true);
  };

  const openAdjustModal = (itemId?: string, warehouseId?: string) => {
    setAdjustItemId(itemId || "");
    setAdjustWarehouseId(warehouseId || "");
    setAdjustMode("add");
    setAdjustQty("");
    setAdjustReason("");
    setIsAdjustModalOpen(true);
  };

  const handleAdjustSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustItemId || !adjustWarehouseId) {
      showToast("Select both a product and a warehouse.", "error");
      return;
    }
    if (!adjustReason.trim()) {
      showToast("A reason is required for every stock adjustment.", "error");
      return;
    }
    setIsAdjusting(true);
    try {
      const res = await api.post("/inventory/adjustments", {
        warehouseId: adjustWarehouseId,
        itemId: adjustItemId,
        mode: adjustMode,
        quantity: Number(adjustQty),
        reason: adjustReason.trim(),
      });

      if (res.data.success) {
        setIsAdjustModalOpen(false);
        fetchData();
      }
    } catch (err: any) {
      showToast(err.response?.data?.error || "Failed to adjust stock.", "error");
    } finally {
      setIsAdjusting(false);
    }
  };

  const openHistoryModal = async () => {
    setIsHistoryModalOpen(true);
    setIsHistoryLoading(true);
    try {
      const res = await api.get("/inventory/adjustments", { params: { limit: 50 } });
      if (res.data.success) setAdjustmentHistory(res.data.data.adjustments);
    } catch (err) {
      console.error("Failed to load adjustment history:", err);
    } finally {
      setIsHistoryLoading(false);
    }
  };

  const handlePrintStockSheet = async (warehouseId: string, warehouseName: string) => {
    setPrintingStockSheetId(warehouseId);
    try {
      const res = await api.get(`/inventory/warehouses/${warehouseId}/stock-sheet.pdf`, { responseType: "blob" });
      const blob = new Blob([res.data], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `Stock-Sheet-${warehouseName.replace(/[^a-zA-Z0-9-]+/g, "-")}.pdf`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to generate stock sheet PDF:", err);
      showToast("Failed to generate stock sheet PDF.", "error");
    } finally {
      setPrintingStockSheetId(null);
    }
  };

  const openStockTakeModal = (warehouseId: string, warehouseName: string) => {
    const rows: StockTakeRow[] = items
      .filter((it) => it.warehouseStocks?.some((s) => s.warehouseId === warehouseId))
      .map((it) => {
        const stock = it.warehouseStocks.find((s) => s.warehouseId === warehouseId);
        return {
          itemId: it.id,
          sku: it.sku,
          name: it.name,
          unitOfMeasure: it.unitOfMeasure,
          systemQty: stock?.quantityOnHand || 0,
          countedQty: "",
        };
      })
      .sort((a, b) => a.sku.localeCompare(b.sku));

    setStockTakeWarehouseId(warehouseId);
    setStockTakeWarehouseName(warehouseName);
    setStockTakeStep("entry");
    setStockTakeTab("table");
    setStockTakeRows(rows);
    setStockTakeResult(null);
    setIsStockTakeModalOpen(true);
  };

  const updateStockTakeCount = (itemId: string, value: string) => {
    setStockTakeRows((rows) => rows.map((r) => (r.itemId === itemId ? { ...r, countedQty: value } : r)));
  };

  const downloadStockTakeCsvTemplate = () => {
    const csv = Papa.unparse([
      ["sku", "name", "unitOfMeasure", "countedQty"],
      ...stockTakeRows.map((r) => [r.sku, r.name, r.unitOfMeasure, ""]),
    ]);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `stock_take_count_sheet_${stockTakeWarehouseName.replace(/[^a-zA-Z0-9-]+/g, "-")}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleStockTakeCsvFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const countsBySku = new Map<string, string>();
        results.data.forEach((row) => {
          if (row.sku && row.sku.trim()) countsBySku.set(row.sku.trim(), (row.countedQty ?? "").trim());
        });

        if (countsBySku.size === 0) {
          showToast("No valid rows found in that CSV. Make sure it has a header row with sku and countedQty columns.", "error");
          return;
        }

        setStockTakeRows((rows) => rows.map((r) => (countsBySku.has(r.sku) ? { ...r, countedQty: countsBySku.get(r.sku)! } : r)));
      },
      error: (err) => {
        showToast(`Failed to parse CSV: ${err.message}`, "error");
      },
    });

    if (stockTakeCsvFileInputRef.current) stockTakeCsvFileInputRef.current.value = "";
  };

  const proceedToStockTakePreview = () => {
    const missing = stockTakeRows.filter((r) => r.countedQty.trim() === "");
    if (missing.length > 0) {
      showToast(`Enter a counted quantity for every item before continuing (${missing.length} missing).`, "error");
      return;
    }
    const invalid = stockTakeRows.filter((r) => !Number.isInteger(Number(r.countedQty)) || Number(r.countedQty) < 0);
    if (invalid.length > 0) {
      showToast("Counted quantities must be whole numbers, zero or greater.", "error");
      return;
    }
    setStockTakeStep("preview");
  };

  const handleStockTakeSubmit = async () => {
    setIsStockTakeSubmitting(true);
    try {
      const res = await api.post("/inventory/stock-take", {
        warehouseId: stockTakeWarehouseId,
        counts: stockTakeRows.map((r) => ({ itemId: r.itemId, countedQty: Number(r.countedQty) })),
      });

      if (res.data.success) {
        setStockTakeResult({
          applied: res.data.data.applied.length,
          unchanged: res.data.data.unchanged.length,
          notFound: res.data.data.notFound.length,
        });
        fetchData();
      }
    } catch (err: any) {
      showToast(err.response?.data?.error || "Failed to reconcile stock take.", "error");
    } finally {
      setIsStockTakeSubmitting(false);
    }
  };

  const openBulkModal = () => {
    setBulkTab("table");
    setBulkRows([{ ...EMPTY_BULK_ROW }, { ...EMPTY_BULK_ROW }, { ...EMPTY_BULK_ROW }]);
    setBulkResult(null);
    setIsBulkModalOpen(true);
  };

  const updateBulkRow = (index: number, field: keyof BulkRow, value: string) => {
    setBulkRows((rows) => rows.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  };

  const addBulkRow = () => setBulkRows((rows) => [...rows, { ...EMPTY_BULK_ROW }]);

  const removeBulkRow = (index: number) => setBulkRows((rows) => rows.filter((_, i) => i !== index));

  const downloadCsvTemplate = () => {
    const csv = Papa.unparse([CSV_TEMPLATE_HEADERS, CSV_TEMPLATE_EXAMPLE_ROW]);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", "ledgio_inventory_import_template.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleCsvFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const parsedRows: BulkRow[] = results.data
          .filter((row) => row.name && row.name.trim())
          .map((row) => ({
            name: row.name?.trim() || "",
            sku: row.sku?.trim() || "",
            category: row.category?.trim() || "General",
            unitOfMeasure: row.unitOfMeasure?.trim() || "pcs",
            costPrice: row.costPrice?.trim() || "",
            sellingPrice: row.sellingPrice?.trim() || "",
            warehouseName: row.warehouseName?.trim() || "",
            initialQty: row.initialQty?.trim() || "",
          }));

        if (parsedRows.length === 0) {
          showToast("No valid rows found in that CSV. Make sure it has a header row and at least one product name.", "error");
          return;
        }

        setBulkRows(parsedRows);
        setBulkResult(null);
      },
      error: (err) => {
        showToast(`Failed to parse CSV: ${err.message}`, "error");
      },
    });

    // Allow re-selecting the same file later (e.g. after fixing it) by clearing the input value.
    if (csvFileInputRef.current) csvFileInputRef.current.value = "";
  };

  const resolveWarehouseIdByName = (name: string): string | undefined => {
    if (!name.trim()) return undefined;
    const match = warehouses.find((w) => w.name.trim().toLowerCase() === name.trim().toLowerCase());
    return match?.id;
  };

  const handleBulkSubmit = async () => {
    const rowsToSubmit = bulkRows.filter((row) => row.name.trim());
    if (rowsToSubmit.length === 0) {
      showToast("Add at least one product with a name before submitting.", "error");
      return;
    }

    setIsBulkSubmitting(true);
    setBulkResult(null);
    try {
      const payload = {
        items: rowsToSubmit.map((row) => ({
          name: row.name.trim(),
          sku: row.sku.trim() || undefined,
          category: row.category.trim() || "General",
          unitOfMeasure: row.unitOfMeasure.trim() || "pcs",
          costPrice: row.costPrice ? Number(row.costPrice) : undefined,
          sellingPrice: row.sellingPrice ? Number(row.sellingPrice) : undefined,
          initialWarehouseId: resolveWarehouseIdByName(row.warehouseName),
          initialQty: row.initialQty ? Number(row.initialQty) : 0,
        })),
      };

      const res = await api.post("/inventory/items/bulk", payload);
      if (res.data.success || res.data.data) {
        setBulkResult({ created: res.data.data.created.length, failed: res.data.data.failed });
        if (res.data.data.failed.length === 0) {
          fetchData();
        } else {
          // Keep only the failed rows in the editor so the user can fix and resubmit
          // without having to retype everything that already succeeded.
          const failedIndexes = new Set(res.data.data.failed.map((f: { index: number }) => f.index));
          setBulkRows(rowsToSubmit.filter((_, i) => failedIndexes.has(i)));
          fetchData();
        }
      }
    } catch (err: any) {
      showToast(err.response?.data?.error || "Bulk import failed.", "error");
    } finally {
      setIsBulkSubmitting(false);
    }
  };

  const calculateTotalStock = (item: InventoryItem) => {
    return item.warehouseStocks?.reduce((sum, s) => sum + s.quantityOnHand, 0) || 0;
  };

  // Filter items by search query and low stock filter
  const filteredItems = items.filter((it) => {
    const matchesSearch =
      it.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      it.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
      it.category.toLowerCase().includes(searchQuery.toLowerCase());

    const totalQty = calculateTotalStock(it);
    const matchesLowStock = !filterLowStockOnly || totalQty <= it.reorderLevel;

    return matchesSearch && matchesLowStock;
  });

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-secondary-900 dark:text-secondary-50">
            Multi-Warehouse & Shop Inventory Logistics ("Godowns")
          </h2>
          <p className="text-secondary-500 dark:text-secondary-400 mt-1">
            Search stock across all shops, track low-stock items, and request instant inter-shop stock transfers.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => openAdjustModal()} className="flex items-center">
            <SlidersHorizontal className="mr-2 h-4 w-4 text-primary-600" />
            Restock / Adjust Stock
          </Button>
          <Button variant="outline" onClick={openHistoryModal} className="flex items-center">
            <History className="mr-2 h-4 w-4 text-primary-600" />
            Adjustment History
          </Button>
          <Button variant="outline" onClick={() => setIsTransferModalOpen(true)} className="flex items-center">
            <ArrowRightLeft className="mr-2 h-4 w-4 text-primary-600" />
            Request Stock Transfer
          </Button>
          {canCreateWarehouse && (
            <Button variant="outline" onClick={() => setIsWarehouseModalOpen(true)} className="flex items-center">
              <Building className="mr-2 h-4 w-4" />
              Add Warehouse / Shop
            </Button>
          )}
          <Button variant="primary" onClick={() => setIsItemModalOpen(true)} className="flex items-center">
            <Plus className="mr-2 h-4 w-4" />
            Add Product / Item
          </Button>
          <Button variant="primary" onClick={openBulkModal} className="flex items-center bg-blue-600 hover:bg-blue-700">
            <Layers className="mr-2 h-4 w-4" />
            Bulk Add Products
          </Button>
        </div>
      </div>

      {/* Inter-Shop Stock Visibility & Communication Banner */}
      <div className="p-4 rounded-xl bg-gradient-to-r from-primary-900 to-secondary-900 text-white shadow-md flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="space-y-1">
          <h4 className="font-bold text-base flex items-center text-primary-200">
            <ArrowRightLeft className="mr-2 h-5 w-5 text-primary-400" />
            Real-Time Inter-Shop Stock Search & Transfer System
          </h4>
          <p className="text-xs text-secondary-300 max-w-3xl">
            When a product is out of stock in <strong>Shop B</strong>, shop managers can search for the item below to see which shop (e.g. <strong>Shop A</strong>) has available units and click <strong>"Request Transfer"</strong> instantly!
          </p>
        </div>
      </div>

      {/* Warehouse Cards Grid */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {warehouses.map((wh) => {
          const totalStockCount = wh.stocks?.reduce((acc, s) => acc + s.quantityOnHand, 0) || 0;
          return (
            <Card key={wh.id} className="border-primary-100 dark:border-primary-950 shadow-sm hover:shadow-md transition-shadow">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div>
                  <CardTitle className="text-base font-semibold text-secondary-900 dark:text-secondary-50">{wh.name}</CardTitle>
                  <div className="text-xs text-secondary-500 flex items-center mt-0.5">
                    <MapPin className="mr-1 h-3.5 w-3.5 text-secondary-400" />
                    {wh.location || "Central Depot"} ({wh.code})
                  </div>
                </div>
                <Warehouse className="h-6 w-6 text-primary-600 dark:text-primary-400" />
              </CardHeader>
              <CardContent>
                <div className="mt-2 flex justify-between items-baseline">
                  <span className="text-xs text-secondary-500 font-medium">Total Items On Hand:</span>
                  <span className="text-xl font-extrabold text-primary-600 dark:text-primary-400">
                    {totalStockCount} pcs
                  </span>
                </div>
                {wh.managerName && (
                  <div className="text-xs text-secondary-500 mt-2 flex items-center">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block mr-1.5"></span>
                    Manager in charge: <strong className="ml-1 text-secondary-700 dark:text-secondary-300">{wh.managerName}</strong>
                  </div>
                )}
                <div className="mt-3 pt-3 border-t border-secondary-100 dark:border-secondary-800 flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1 text-xs h-8"
                    disabled={printingStockSheetId === wh.id}
                    onClick={() => handlePrintStockSheet(wh.id, wh.name)}
                  >
                    <Printer className="mr-1.5 h-3.5 w-3.5" />
                    {printingStockSheetId === wh.id ? "Preparing..." : "Print Stock Sheet"}
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1 text-xs h-8"
                    onClick={() => openStockTakeModal(wh.id, wh.name)}
                  >
                    <ClipboardCheck className="mr-1.5 h-3.5 w-3.5" />
                    Stock Take
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}

        {warehouses.length === 0 && !isLoading && (
          <Card className="md:col-span-3 border-dashed">
            <CardContent className="py-8 text-center text-secondary-500">
              <Warehouse className="mx-auto h-8 w-8 text-secondary-400 mb-2" />
              No shops or warehouses created yet. Click "Add Warehouse / Shop" to set up your first store location.
            </CardContent>
          </Card>
        )}
      </div>

      {/* Search & Live Inter-Shop Availability Matrix */}
      <Card className="border-none shadow-md">
        <CardHeader className="pb-3">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <CardTitle>Global Product Search & Multi-Shop Availability Matrix ({filteredItems.length})</CardTitle>
              <CardDescription>
                Search any product to see live stock in each shop. Request stock transfers directly from shops with available items.
              </CardDescription>
            </div>
            
            {/* Search Input & Low Stock Checkbox */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <div className="relative min-w-[260px]">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-secondary-400" />
                <Input
                  type="text"
                  placeholder="Search item, SKU, category..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 text-xs h-9"
                />
              </div>
              <label className="flex items-center space-x-2 text-xs font-medium text-secondary-700 dark:text-secondary-300 bg-secondary-50 dark:bg-secondary-900 px-3 py-2 rounded-md border border-secondary-200 dark:border-secondary-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filterLowStockOnly}
                  onChange={(e) => setFilterLowStockOnly(e.target.checked)}
                  className="rounded border-secondary-300 text-primary-600 focus:ring-primary-500 h-4 w-4"
                />
                <span>Low / Out-of-Stock Only</span>
              </label>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-12 text-center text-secondary-500">Loading shop inventory matrix...</div>
          ) : filteredItems.length === 0 ? (
            <div className="py-12 text-center text-secondary-500 text-sm">
              No matching inventory items found. Try clearing your search filter or click "Add Product / Item".
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-secondary-50/50 dark:bg-secondary-900/50">
                  <TableHead className="w-[100px]">SKU</TableHead>
                  <TableHead>Product Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Cost / Selling</TableHead>
                  <TableHead className="min-w-[320px]">Live Shop-by-Shop Stock Breakdown</TableHead>
                  <TableHead className="text-right">Total System Stock</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredItems.map((it) => {
                  const totalQty = calculateTotalStock(it);
                  const isLowStock = totalQty <= it.reorderLevel;

                  return (
                    <TableRow key={it.id} className="hover:bg-secondary-50/60 dark:hover:bg-secondary-900/40">
                      <TableCell className="font-mono text-xs font-semibold text-primary-600 dark:text-primary-400">
                        {it.sku}
                      </TableCell>
                      <TableCell className="font-medium text-secondary-900 dark:text-secondary-50">
                        {it.name}
                      </TableCell>
                      <TableCell className="text-xs">{it.category}</TableCell>
                      <TableCell className="text-xs">
                        <div className="font-medium text-secondary-500">{formatMoney(Number(it.costPrice))} (Cost)</div>
                        <div className="font-bold text-secondary-900 dark:text-secondary-100">{formatMoney(Number(it.sellingPrice))} (Retail)</div>
                        {it.wholesalePrice != null && (
                          <div className="text-xs text-primary-600 dark:text-primary-400">{formatMoney(Number(it.wholesalePrice))} (Wholesale)</div>
                        )}
                      </TableCell>

                      {/* Shop Availability Badges */}
                      <TableCell>
                        <div className="flex flex-wrap gap-2 py-1">
                          {warehouses.map((wh) => {
                            const stockObj = it.warehouseStocks?.find(s => s.warehouseId === wh.id);
                            const qty = stockObj ? stockObj.quantityOnHand : 0;
                            const hasStock = qty > 0;

                            return (
                              <div
                                key={wh.id}
                                className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium border ${
                                  hasStock
                                    ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800"
                                    : "bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800 opacity-80"
                                }`}
                              >
                                {hasStock ? (
                                  <CheckCircle2 className="mr-1 h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                                ) : (
                                  <XCircle className="mr-1 h-3.5 w-3.5 text-red-500" />
                                )}
                                <span>
                                  <strong>{wh.name}</strong>: {qty} {it.unitOfMeasure}
                                </span>
                                {hasStock && (
                                  <button
                                    type="button"
                                    onClick={() => openQuickTransferModal(it.id, wh.id)}
                                    title={`Request transfer from ${wh.name}`}
                                    className="ml-2 px-1.5 py-0.5 text-[10px] font-bold rounded bg-emerald-600 text-white hover:bg-emerald-700 transition-colors shadow-xs"
                                  >
                                    Transfer
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => openAdjustModal(it.id, wh.id)}
                                  title={`Restock or correct ${it.name} at ${wh.name}`}
                                  className="ml-2 px-1.5 py-0.5 text-[10px] font-bold rounded bg-blue-600 text-white hover:bg-blue-700 transition-colors shadow-xs"
                                >
                                  Adjust
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </TableCell>

                      <TableCell className="text-right">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold ${isLowStock ? 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-400 border border-rose-300' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'}`}>
                          {isLowStock && <AlertTriangle className="mr-1 h-3.5 w-3.5" />}
                          {totalQty} {it.unitOfMeasure}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add Warehouse / Shop Modal */}
      <Modal isOpen={isWarehouseModalOpen} onClose={() => setIsWarehouseModalOpen(false)} title="Add Warehouse / Shop Location">
        <form onSubmit={handleAddWarehouse} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Warehouse / Shop Name</label>
            <Input required placeholder="e.g. Shop A (Downtown Branch) or Central Warehouse" value={whName} onChange={(e) => setWhName(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Location / Address</label>
            <Input placeholder="e.g. Osu Oxford Street, Accra" value={whLocation} onChange={(e) => setWhLocation(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Shop Manager Name</label>
            <Input placeholder="e.g. Kwame Mensah" value={whManager} onChange={(e) => setWhManager(e.target.value)} />
          </div>
          <div className="flex justify-end space-x-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setIsWarehouseModalOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={isSubmitting}>{isSubmitting ? "Creating..." : "Create Location"}</Button>
          </div>
        </form>
      </Modal>

      {/* Add Inventory Item Modal */}
      <Modal isOpen={isItemModalOpen} onClose={() => setIsItemModalOpen(false)} title="Add Product / Inventory Item" className="max-w-2xl">
        <form onSubmit={handleAddItem} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Product Name</label>
            <Input required placeholder="e.g. Samsung 24 Inch LED Monitor" value={itemName} onChange={(e) => setItemName(e.target.value)} />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">SKU / Barcode</label>
              <Input placeholder="MON-001" value={itemSku} onChange={(e) => setItemSku(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Category</label>
              <Input placeholder="Electronics" value={category} onChange={(e) => setCategory(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Unit of Measure</label>
              <Input placeholder="pcs, kg, boxes" value={unitOfMeasure} onChange={(e) => setUnitOfMeasure(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Cost Price (GH₵)</label>
              <Input type="number" required value={costPrice} onChange={(e) => setCostPrice(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Retail Price (GH₵)</label>
              <Input type="number" required value={sellingPrice} onChange={(e) => setSellingPrice(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Wholesale Price (GH₵) <span className="text-secondary-400 font-normal">optional</span></label>
              <Input type="number" placeholder="Leave blank if same as retail" value={wholesalePrice} onChange={(e) => setWholesalePrice(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Initial Storage Shop/Warehouse</label>
              <select
                className="w-full h-10 px-3 rounded-md border border-secondary-300 bg-white dark:bg-secondary-800 text-secondary-900 dark:text-secondary-50 text-sm"
                value={initialWarehouseId}
                onChange={(e) => setInitialWarehouseId(e.target.value)}
              >
                <option value="">-- Select Shop --</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Initial Quantity</label>
              <Input type="number" value={initialQty} onChange={(e) => setInitialQty(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Preferred Vendor (optional)</label>
            <select
              className="w-full h-10 px-3 rounded-md border border-secondary-300 bg-white dark:bg-secondary-800 text-secondary-900 dark:text-secondary-50 text-sm"
              value={preferredVendorId}
              onChange={(e) => setPreferredVendorId(e.target.value)}
            >
              <option value="">-- None --</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
            <p className="text-xs text-secondary-500 mt-1">
              Who to auto-draft a reorder Purchase Order to once stock falls to the reorder level.
            </p>
          </div>
          <div className="flex justify-end space-x-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setIsItemModalOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={isSubmitting}>{isSubmitting ? "Saving..." : "Save Product"}</Button>
          </div>
        </form>
      </Modal>

      {/* Bulk Add Products Modal */}
      <Modal isOpen={isBulkModalOpen} onClose={() => setIsBulkModalOpen(false)} title="Bulk Add Products" className="max-w-5xl">
        <div className="space-y-4">
          <div className="flex space-x-4 border-b border-secondary-200 dark:border-secondary-800">
            <button
              type="button"
              onClick={() => setBulkTab("table")}
              className={`pb-2 text-sm font-semibold transition-colors border-b-2 ${bulkTab === "table" ? "border-primary-500 text-primary-600 dark:text-primary-400" : "border-transparent text-secondary-500 hover:text-secondary-800 dark:hover:text-secondary-200"}`}
            >
              Quick-Add Table
            </button>
            <button
              type="button"
              onClick={() => setBulkTab("csv")}
              className={`pb-2 text-sm font-semibold transition-colors border-b-2 ${bulkTab === "csv" ? "border-primary-500 text-primary-600 dark:text-primary-400" : "border-transparent text-secondary-500 hover:text-secondary-800 dark:hover:text-secondary-200"}`}
            >
              Import CSV
            </button>
          </div>

          {bulkTab === "csv" && (
            <div className="p-4 bg-secondary-50 dark:bg-secondary-900 rounded-lg border border-secondary-200 dark:border-secondary-800 space-y-3">
              <p className="text-xs text-secondary-500">
                Upload a CSV with columns: <code className="font-mono">{CSV_TEMPLATE_HEADERS.join(", ")}</code>.
                The <code className="font-mono">warehouseName</code> must exactly match an existing shop/warehouse name (leave blank to create the product without initial stock).
                Excel files: use "Save As" &gt; CSV before uploading.
              </p>
              <div className="flex items-center gap-3">
                <input
                  ref={csvFileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleCsvFileChange}
                  className="text-xs text-secondary-600 dark:text-secondary-300 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100"
                />
                <Button type="button" variant="outline" onClick={downloadCsvTemplate} className="flex items-center text-xs">
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  Download Template
                </Button>
              </div>
            </div>
          )}

          <div className="max-h-[40vh] overflow-y-auto border border-secondary-200 dark:border-secondary-800 rounded-lg">
            <table className="w-full text-xs">
              <thead className="bg-secondary-50 dark:bg-secondary-900 sticky top-0">
                <tr>
                  <th className="text-left p-2 font-medium">Name</th>
                  <th className="text-left p-2 font-medium">SKU</th>
                  <th className="text-left p-2 font-medium">Category</th>
                  <th className="text-left p-2 font-medium">Unit</th>
                  <th className="text-left p-2 font-medium">Cost</th>
                  <th className="text-left p-2 font-medium">Sell</th>
                  <th className="text-left p-2 font-medium">Warehouse</th>
                  <th className="text-left p-2 font-medium">Qty</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {bulkRows.map((row, i) => (
                  <tr key={i} className="border-t border-secondary-100 dark:border-secondary-800">
                    <td className="p-1"><Input className="h-8 text-xs" placeholder="Product name" value={row.name} onChange={(e) => updateBulkRow(i, "name", e.target.value)} /></td>
                    <td className="p-1"><Input className="h-8 text-xs w-24" placeholder="auto" value={row.sku} onChange={(e) => updateBulkRow(i, "sku", e.target.value)} /></td>
                    <td className="p-1"><Input className="h-8 text-xs w-24" value={row.category} onChange={(e) => updateBulkRow(i, "category", e.target.value)} /></td>
                    <td className="p-1"><Input className="h-8 text-xs w-16" value={row.unitOfMeasure} onChange={(e) => updateBulkRow(i, "unitOfMeasure", e.target.value)} /></td>
                    <td className="p-1"><Input type="number" className="h-8 text-xs w-20" value={row.costPrice} onChange={(e) => updateBulkRow(i, "costPrice", e.target.value)} /></td>
                    <td className="p-1"><Input type="number" className="h-8 text-xs w-20" value={row.sellingPrice} onChange={(e) => updateBulkRow(i, "sellingPrice", e.target.value)} /></td>
                    <td className="p-1">
                      <select
                        className="h-8 text-xs w-40 rounded-md border border-secondary-300 bg-white dark:bg-secondary-800 text-secondary-900 dark:text-secondary-50"
                        value={row.warehouseName}
                        onChange={(e) => updateBulkRow(i, "warehouseName", e.target.value)}
                      >
                        <option value="">-- none --</option>
                        {warehouses.map((w) => (
                          <option key={w.id} value={w.name}>{w.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="p-1"><Input type="number" className="h-8 text-xs w-16" value={row.initialQty} onChange={(e) => updateBulkRow(i, "initialQty", e.target.value)} /></td>
                    <td className="p-1">
                      <button type="button" onClick={() => removeBulkRow(i)} className="text-secondary-400 hover:text-red-500 p-1" title="Remove row">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Button type="button" variant="outline" onClick={addBulkRow} className="text-xs flex items-center">
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add Row
          </Button>

          {bulkResult && (
            <div className={`p-3 rounded-lg text-xs ${bulkResult.failed.length === 0 ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800" : "bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800"}`}>
              <div className="font-semibold">
                {bulkResult.created} product{bulkResult.created === 1 ? "" : "s"} created successfully.
                {bulkResult.failed.length > 0 && ` ${bulkResult.failed.length} failed - fix the row(s) below and submit again.`}
              </div>
              {bulkResult.failed.length > 0 && (
                <ul className="mt-1.5 space-y-0.5 list-disc list-inside">
                  {bulkResult.failed.map((f, i) => (
                    <li key={i}>{f.name || `Row ${f.index + 1}`}: {f.error}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="flex justify-end space-x-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setIsBulkModalOpen(false)}>Close</Button>
            <Button type="button" variant="primary" onClick={handleBulkSubmit} disabled={isBulkSubmitting}>
              {isBulkSubmitting ? "Creating..." : `Create ${bulkRows.filter(r => r.name.trim()).length || ""} Product${bulkRows.filter(r => r.name.trim()).length === 1 ? "" : "s"}`}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Restock / Adjust Stock Modal */}
      <Modal isOpen={isAdjustModalOpen} onClose={() => setIsAdjustModalOpen(false)} title="Restock or Correct Stock">
        <form onSubmit={handleAdjustSubmit} className="space-y-4">
          <p className="text-xs text-secondary-500">
            Use <strong>Add</strong> when new stock arrives (e.g. a supplier delivery). Use <strong>Remove</strong> or <strong>Set Exact Count</strong> to fix a mistaken entry or reconcile against a physical count. Every adjustment is recorded with your name and the reason you give.
          </p>
          <div>
            <label className="block text-sm font-medium mb-1">Product</label>
            <select
              required
              className="w-full h-10 px-3 rounded-md border border-secondary-300 bg-white dark:bg-secondary-800 text-secondary-900 dark:text-secondary-50 text-sm"
              value={adjustItemId}
              onChange={(e) => setAdjustItemId(e.target.value)}
            >
              <option value="">-- Select Product --</option>
              {items.map((it) => (
                <option key={it.id} value={it.id}>{it.name} ({it.sku})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Warehouse / Shop</label>
            <select
              required
              className="w-full h-10 px-3 rounded-md border border-secondary-300 bg-white dark:bg-secondary-800 text-secondary-900 dark:text-secondary-50 text-sm"
              value={adjustWarehouseId}
              onChange={(e) => setAdjustWarehouseId(e.target.value)}
            >
              <option value="">-- Select Warehouse --</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>
          {adjustItemId && adjustWarehouseId && (
            <p className="text-xs text-secondary-500">
              Currently on hand: <strong>
                {items.find(it => it.id === adjustItemId)?.warehouseStocks?.find(s => s.warehouseId === adjustWarehouseId)?.quantityOnHand || 0}
              </strong>
            </p>
          )}
          <div>
            <label className="block text-sm font-medium mb-1">Action</label>
            <div className="grid grid-cols-3 gap-2">
              {(["add", "remove", "set"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setAdjustMode(m)}
                  className={`py-2 px-2 rounded-md text-xs font-semibold border transition-colors ${
                    adjustMode === m
                      ? "bg-primary-600 text-white border-primary-600"
                      : "bg-white dark:bg-secondary-800 text-secondary-700 dark:text-secondary-300 border-secondary-300 dark:border-secondary-700"
                  }`}
                >
                  {m === "add" ? "Add Stock" : m === "remove" ? "Remove Stock" : "Set Exact Count"}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">
              {adjustMode === "set" ? "New Total Quantity" : "Quantity"}
            </label>
            <Input type="number" required min={adjustMode === "set" ? 0 : 1} value={adjustQty} onChange={(e) => setAdjustQty(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Reason (required)</label>
            <Input required placeholder="e.g. Received delivery from supplier / Correcting mistaken entry / Physical stock count" value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} />
          </div>
          <div className="flex justify-end space-x-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setIsAdjustModalOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={isAdjusting}>
              {isAdjusting ? "Saving..." : "Save Adjustment"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Adjustment History Modal */}
      <Modal isOpen={isHistoryModalOpen} onClose={() => setIsHistoryModalOpen(false)} title="Stock Adjustment History" className="max-w-3xl">
        <div className="max-h-[60vh] overflow-y-auto">
          {isHistoryLoading ? (
            <div className="py-8 text-center text-secondary-500 text-sm">Loading history...</div>
          ) : adjustmentHistory.length === 0 ? (
            <div className="py-8 text-center text-secondary-500 text-sm">No stock adjustments recorded yet.</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-secondary-50 dark:bg-secondary-900 sticky top-0">
                <tr>
                  <th className="text-left p-2 font-medium">When</th>
                  <th className="text-left p-2 font-medium">Product</th>
                  <th className="text-left p-2 font-medium">Warehouse</th>
                  <th className="text-left p-2 font-medium">Change</th>
                  <th className="text-left p-2 font-medium">Reason</th>
                  <th className="text-left p-2 font-medium">By</th>
                </tr>
              </thead>
              <tbody>
                {adjustmentHistory.map((adj) => (
                  <tr key={adj.id} className="border-t border-secondary-100 dark:border-secondary-800">
                    <td className="p-2 whitespace-nowrap text-secondary-500">{new Date(adj.createdAt).toLocaleString()}</td>
                    <td className="p-2 font-medium">{adj.item?.name}</td>
                    <td className="p-2">{adj.warehouse?.name}</td>
                    <td className="p-2">
                      <span className={`font-bold ${adj.delta > 0 ? "text-emerald-600" : adj.delta < 0 ? "text-red-600" : "text-secondary-500"}`}>
                        {adj.delta > 0 ? "+" : ""}{adj.delta}
                      </span>
                      <span className="text-secondary-400"> ({adj.previousQty} → {adj.newQty})</span>
                    </td>
                    <td className="p-2 text-secondary-600 dark:text-secondary-300">{adj.reason}</td>
                    <td className="p-2 text-secondary-500">{adj.adjustedByName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="flex justify-end pt-4 border-t border-secondary-200 dark:border-secondary-800 mt-4">
          <Button variant="outline" onClick={() => setIsHistoryModalOpen(false)}>Close</Button>
        </div>
      </Modal>

      {/* Stock Take Modal */}
      <Modal isOpen={isStockTakeModalOpen} onClose={() => setIsStockTakeModalOpen(false)} title={`Stock Take: ${stockTakeWarehouseName}`} className="max-w-3xl">
        <div className="space-y-4">
          {stockTakeResult ? (
            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 text-sm">
                <div className="font-semibold">Stock take reconciled.</div>
                <div className="mt-1 text-xs">
                  {stockTakeResult.applied} item{stockTakeResult.applied === 1 ? "" : "s"} adjusted, {stockTakeResult.unchanged} unchanged
                  {stockTakeResult.notFound > 0 ? `, ${stockTakeResult.notFound} not found` : ""}.
                </div>
              </div>
              <div className="flex justify-end">
                <Button variant="outline" onClick={() => setIsStockTakeModalOpen(false)}>Close</Button>
              </div>
            </div>
          ) : stockTakeStep === "entry" ? (
            <>
              <p className="text-xs text-secondary-500">
                Print a blind count sheet first, count physically, then enter the counted quantities below - either directly in the table or by uploading a filled-in CSV. System quantities stay hidden until the review step, to keep the count honest.
              </p>

              <div className="flex space-x-4 border-b border-secondary-200 dark:border-secondary-800">
                <button
                  type="button"
                  onClick={() => setStockTakeTab("table")}
                  className={`pb-2 text-sm font-semibold transition-colors border-b-2 ${stockTakeTab === "table" ? "border-primary-500 text-primary-600 dark:text-primary-400" : "border-transparent text-secondary-500 hover:text-secondary-800 dark:hover:text-secondary-200"}`}
                >
                  On-Screen Table
                </button>
                <button
                  type="button"
                  onClick={() => setStockTakeTab("csv")}
                  className={`pb-2 text-sm font-semibold transition-colors border-b-2 ${stockTakeTab === "csv" ? "border-primary-500 text-primary-600 dark:text-primary-400" : "border-transparent text-secondary-500 hover:text-secondary-800 dark:hover:text-secondary-200"}`}
                >
                  Upload CSV
                </button>
              </div>

              {stockTakeTab === "csv" && (
                <div className="p-4 bg-secondary-50 dark:bg-secondary-900 rounded-lg border border-secondary-200 dark:border-secondary-800 space-y-3">
                  <p className="text-xs text-secondary-500">
                    Download the counting template, fill in the <code className="font-mono">countedQty</code> column, then upload it here. Rows are matched back by <code className="font-mono">sku</code>.
                  </p>
                  <div className="flex items-center gap-3">
                    <input
                      ref={stockTakeCsvFileInputRef}
                      type="file"
                      accept=".csv,text/csv"
                      onChange={handleStockTakeCsvFileChange}
                      className="text-xs text-secondary-600 dark:text-secondary-300 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100"
                    />
                    <Button type="button" variant="outline" onClick={downloadStockTakeCsvTemplate} className="flex items-center text-xs">
                      <Download className="mr-1.5 h-3.5 w-3.5" />
                      Download Counting Template
                    </Button>
                  </div>
                </div>
              )}

              <div className="max-h-[45vh] overflow-y-auto border border-secondary-200 dark:border-secondary-800 rounded-lg">
                <table className="w-full text-xs">
                  <thead className="bg-secondary-50 dark:bg-secondary-900 sticky top-0">
                    <tr>
                      <th className="text-left p-2 font-medium">SKU</th>
                      <th className="text-left p-2 font-medium">Item Name</th>
                      <th className="text-left p-2 font-medium">Unit</th>
                      <th className="text-left p-2 font-medium">Counted Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stockTakeRows.map((r) => (
                      <tr key={r.itemId} className="border-t border-secondary-100 dark:border-secondary-800">
                        <td className="p-2 font-mono">{r.sku}</td>
                        <td className="p-2">{r.name}</td>
                        <td className="p-2">{r.unitOfMeasure}</td>
                        <td className="p-1">
                          <Input
                            type="number"
                            min={0}
                            className="h-8 text-xs w-24"
                            value={r.countedQty}
                            onChange={(e) => updateStockTakeCount(r.itemId, e.target.value)}
                            placeholder="—"
                          />
                        </td>
                      </tr>
                    ))}
                    {stockTakeRows.length === 0 && (
                      <tr>
                        <td colSpan={4} className="p-4 text-center text-secondary-500">
                          No items stocked in this warehouse yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end space-x-3 pt-2">
                <Button type="button" variant="outline" onClick={() => setIsStockTakeModalOpen(false)}>Cancel</Button>
                <Button type="button" variant="primary" onClick={proceedToStockTakePreview} disabled={stockTakeRows.length === 0}>
                  Review Variance
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-secondary-500">
                Review the variance between counted and system quantities below before confirming. Confirming records a stock adjustment for every item that differs; matching items are left untouched.
              </p>
              <div className="max-h-[45vh] overflow-y-auto border border-secondary-200 dark:border-secondary-800 rounded-lg">
                <table className="w-full text-xs">
                  <thead className="bg-secondary-50 dark:bg-secondary-900 sticky top-0">
                    <tr>
                      <th className="text-left p-2 font-medium">Item</th>
                      <th className="text-right p-2 font-medium">System Qty</th>
                      <th className="text-right p-2 font-medium">Counted Qty</th>
                      <th className="text-right p-2 font-medium">Variance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stockTakeRows.map((r) => {
                      const counted = Number(r.countedQty);
                      const variance = counted - r.systemQty;
                      return (
                        <tr
                          key={r.itemId}
                          className={`border-t border-secondary-100 dark:border-secondary-800 ${variance !== 0 ? "bg-amber-50/60 dark:bg-amber-950/20" : ""}`}
                        >
                          <td className="p-2">
                            <div className="font-medium text-secondary-900 dark:text-secondary-100">{r.name}</div>
                            <div className="font-mono text-secondary-400">{r.sku}</div>
                          </td>
                          <td className="p-2 text-right">{r.systemQty} {r.unitOfMeasure}</td>
                          <td className="p-2 text-right font-semibold">{counted} {r.unitOfMeasure}</td>
                          <td className="p-2 text-right">
                            <span className={`font-bold ${variance > 0 ? "text-emerald-600" : variance < 0 ? "text-red-600" : "text-secondary-400"}`}>
                              {variance > 0 ? "+" : ""}{variance}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-between pt-2">
                <Button type="button" variant="outline" onClick={() => setStockTakeStep("entry")}>Back to Edit</Button>
                <div className="flex space-x-3">
                  <Button type="button" variant="outline" onClick={() => setIsStockTakeModalOpen(false)}>Cancel</Button>
                  <Button type="button" variant="primary" onClick={handleStockTakeSubmit} disabled={isStockTakeSubmitting}>
                    {isStockTakeSubmitting ? "Applying..." : "Confirm & Apply"}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </Modal>

      {/* Stock Transfer Modal */}
      <Modal isOpen={isTransferModalOpen} onClose={() => setIsTransferModalOpen(false)} title="Inter-Shop Stock Transfer Request">
        <form onSubmit={handleTransferStock} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Select Product to Transfer</label>
            <select
              required
              className="w-full h-10 px-3 rounded-md border border-secondary-300 bg-white dark:bg-secondary-800 text-secondary-900 dark:text-secondary-50 text-sm"
              value={selectedItemId}
              onChange={(e) => setSelectedItemId(e.target.value)}
            >
              <option value="">-- Select Product --</option>
              {items.map((it) => (
                <option key={it.id} value={it.id}>{it.name} ({it.sku})</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">From Shop (Origin with Stock)</label>
              <select
                required
                className="w-full h-10 px-3 rounded-md border border-secondary-300 bg-white dark:bg-secondary-800 text-secondary-900 dark:text-secondary-50 text-sm"
                value={fromWarehouseId}
                onChange={(e) => setFromWarehouseId(e.target.value)}
              >
                <option value="">-- Select Origin --</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">To Shop (Destination)</label>
              <select
                required
                className="w-full h-10 px-3 rounded-md border border-secondary-300 bg-white dark:bg-secondary-800 text-secondary-900 dark:text-secondary-50 text-sm"
                value={toWarehouseId}
                onChange={(e) => setToWarehouseId(e.target.value)}
              >
                <option value="">-- Select Destination --</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Transfer Quantity</label>
            <Input type="number" required value={transferQty} onChange={(e) => setTransferQty(e.target.value)} />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Transfer Notes / Reason</label>
            <Input placeholder="e.g. Restocking Shop B due to customer demand" value={transferNotes} onChange={(e) => setTransferNotes(e.target.value)} />
          </div>

          <div className="flex justify-end space-x-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setIsTransferModalOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={isSubmitting}>
              {isSubmitting ? "Transferring..." : "Execute Stock Transfer"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
