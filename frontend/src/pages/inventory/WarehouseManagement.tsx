import React, { useState, useEffect, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "../../components/ui/Table";
import { Modal } from "../../components/ui/Modal";
import { api } from "../../lib/api";
import { formatMoney } from "../../lib/utils";
import { Warehouse, Plus, ArrowRightLeft, AlertTriangle, Building, MapPin, Search, CheckCircle2, XCircle } from "lucide-react";

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

export function WarehouseManagement() {
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
  const [initialWarehouseId, setInitialWarehouseId] = useState("");
  const [initialQty, setInitialQty] = useState("50");

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
      const [whRes, itemRes] = await Promise.all([
        api.get("/inventory/warehouses"),
        api.get("/inventory/items"),
      ]);

      if (whRes.data.success) setWarehouses(whRes.data.data.warehouses);
      if (itemRes.data.success) setItems(itemRes.data.data.items);
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
      alert(err.response?.data?.error || "Failed to add warehouse.");
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
        initialWarehouseId,
        initialQty: Number(initialQty),
      });

      if (res.data.success) {
        setItemName("");
        setItemSku("");
        setIsItemModalOpen(false);
        fetchData();
      }
    } catch (err: any) {
      alert(err.response?.data?.error || "Failed to create item.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTransferStock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (fromWarehouseId === toWarehouseId) {
      alert("Source and destination warehouses must be different.");
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
      alert(err.response?.data?.error || "Transfer failed.");
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
          <Button variant="outline" onClick={() => setIsTransferModalOpen(true)} className="flex items-center">
            <ArrowRightLeft className="mr-2 h-4 w-4 text-primary-600" />
            Request Stock Transfer
          </Button>
          <Button variant="outline" onClick={() => setIsWarehouseModalOpen(true)} className="flex items-center">
            <Building className="mr-2 h-4 w-4" />
            Add Warehouse / Shop
          </Button>
          <Button variant="primary" onClick={() => setIsItemModalOpen(true)} className="flex items-center">
            <Plus className="mr-2 h-4 w-4" />
            Add Product / Item
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
                        <div className="font-bold text-secondary-900 dark:text-secondary-100">{formatMoney(Number(it.sellingPrice))} (Sell)</div>
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
            <Button type="submit" variant="primary" disabled={isSubmitting}>Create Location</Button>
          </div>
        </form>
      </Modal>

      {/* Add Inventory Item Modal */}
      <Modal isOpen={isItemModalOpen} onClose={() => setIsItemModalOpen(false)} title="Add Product / Inventory Item">
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
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Cost Price (GH₵)</label>
              <Input type="number" required value={costPrice} onChange={(e) => setCostPrice(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Selling Price (GH₵)</label>
              <Input type="number" required value={sellingPrice} onChange={(e) => setSellingPrice(e.target.value)} />
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
          <div className="flex justify-end space-x-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setIsItemModalOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={isSubmitting}>Save Product</Button>
          </div>
        </form>
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
