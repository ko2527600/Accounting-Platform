import { useState, useEffect, useCallback } from "react";
import { RefreshCw, Ship, ChevronDown, ChevronRight } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "../../components/ui/Card";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "../../components/ui/Table";
import { Button } from "../../components/ui/Button";
import { useTenantSettings } from "../../hooks/useTenantSettings";
import { api } from "../../lib/api";

interface LandedCostLine {
  billId: string;
  billNumber: string;
  vendorName: string;
  amount: number;
  currency: string;
}

interface ItemBreakdown {
  itemId: string;
  itemName: string;
  itemSku: string;
  quantity: number;
  originalUnitCost: number;
  landedCostAllocation: number;
  totalLineCost: number;
  effectiveUnitCost: number;
}

interface ShipmentRow {
  billId: string;
  billNumber: string;
  billDate: string;
  vendorName: string;
  currency: string;
  goodsCost: number;
  landedCosts: LandedCostLine[];
  totalLandedCost: number;
  grandTotal: number;
  itemBreakdown: ItemBreakdown[];
}

export function LandedCostReport() {
  const { settings } = useTenantSettings();
  const [rows, setRows] = useState<ShipmentRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 3);
    return d.toISOString().split("T")[0];
  });
  const [to, setTo] = useState(() => new Date().toISOString().split("T")[0]);

  const formatBase = (amount: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: settings.baseCurrency }).format(amount);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.get("/reports/landed-costs", { params: { from, to } });
      if (res.data.success) setRows(res.data.data);
    } catch (err) {
      console.error("Failed to fetch landed cost report:", err);
    } finally {
      setIsLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const toggleRow = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const totalGoodsSum = rows.reduce((s, r) => s + r.goodsCost, 0);
  const totalLandedSum = rows.reduce((s, r) => s + r.totalLandedCost, 0);
  const totalGrandSum = rows.reduce((s, r) => s + r.grandTotal, 0);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-secondary-900 dark:text-secondary-50">
            Landed Cost Report
          </h2>
          <p className="text-secondary-500 dark:text-secondary-400 mt-1">
            Per-shipment breakdown of goods cost plus freight, duty, and customs — and the effective per-unit cost after allocation.
          </p>
        </div>
        <Button variant="outline" onClick={fetchData} className="flex items-center">
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* Date range filter */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <label className="block text-xs font-medium text-secondary-600 dark:text-secondary-400 mb-1">Bill Date From</label>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="border rounded px-3 py-1.5 text-sm bg-white dark:bg-secondary-800 dark:border-secondary-700 dark:text-secondary-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-secondary-600 dark:text-secondary-400 mb-1">Bill Date To</label>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="border rounded px-3 py-1.5 text-sm bg-white dark:bg-secondary-800 dark:border-secondary-700 dark:text-secondary-100"
              />
            </div>
            <Button variant="primary" onClick={fetchData} className="h-9">Apply</Button>
          </div>
        </CardContent>
      </Card>

      {/* Summary tiles */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold text-secondary-500">Total Goods Cost</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold text-secondary-900 dark:text-secondary-50">{formatBase(totalGoodsSum)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold text-secondary-500">Total Landed Costs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold text-orange-600 dark:text-orange-400">{formatBase(totalLandedSum)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold text-secondary-500">Total All-In Cost</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold text-primary-600 dark:text-primary-400">{formatBase(totalGrandSum)}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <Ship className="mr-2 h-5 w-5 text-primary-600 dark:text-primary-400" />
            Shipments
          </CardTitle>
          <CardDescription>
            Click a row to expand per-item cost allocation. Landed costs are spread proportionally by line total.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-8 text-center text-secondary-500">Loading...</div>
          ) : rows.length === 0 ? (
            <div className="py-12 text-center text-secondary-500 text-sm">
              No shipments with landed costs found in this date range.
            </div>
          ) : (
            <div className="space-y-2">
              {rows.map((row) => {
                const expanded = expandedIds.has(row.billId);
                return (
                  <div key={row.billId} className="border rounded-lg overflow-hidden dark:border-secondary-700">
                    {/* Shipment header row */}
                    <button
                      className="w-full flex items-center gap-4 p-4 text-left hover:bg-secondary-50 dark:hover:bg-secondary-800/50 transition-colors"
                      onClick={() => toggleRow(row.billId)}
                    >
                      <span className="text-secondary-400">
                        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </span>
                      <span className="font-semibold text-secondary-900 dark:text-secondary-50 w-28">{row.billNumber}</span>
                      <span className="text-secondary-600 dark:text-secondary-400 text-sm flex-1">{row.vendorName}</span>
                      <span className="text-xs text-secondary-500">{new Date(row.billDate).toLocaleDateString()}</span>
                      <span className="text-xs text-secondary-400 w-16 text-center">{row.currency}</span>
                      <span className="w-32 text-right text-sm">{formatBase(row.goodsCost)}</span>
                      <span className="w-32 text-right text-sm text-orange-600 dark:text-orange-400">+{formatBase(row.totalLandedCost)}</span>
                      <span className="w-36 text-right font-bold text-primary-600 dark:text-primary-400">{formatBase(row.grandTotal)}</span>
                    </button>

                    {/* Expanded: landed cost lines + item breakdown */}
                    {expanded && (
                      <div className="border-t dark:border-secondary-700 bg-secondary-50 dark:bg-secondary-900/30 p-4 space-y-4">
                        {/* Landed cost bills */}
                        <div>
                          <div className="text-xs font-semibold text-secondary-500 uppercase tracking-wide mb-2">Landed Cost Bills</div>
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Bill #</TableHead>
                                <TableHead>Vendor</TableHead>
                                <TableHead>Currency</TableHead>
                                <TableHead className="text-right">Amount ({settings.baseCurrency})</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {row.landedCosts.map((lc) => (
                                <TableRow key={lc.billId}>
                                  <TableCell className="text-sm font-medium">{lc.billNumber}</TableCell>
                                  <TableCell className="text-sm">{lc.vendorName}</TableCell>
                                  <TableCell className="text-xs text-secondary-500">{lc.currency}</TableCell>
                                  <TableCell className="text-right text-sm">{formatBase(lc.amount)}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>

                        {/* Item breakdown */}
                        {row.itemBreakdown.length > 0 && (
                          <div>
                            <div className="text-xs font-semibold text-secondary-500 uppercase tracking-wide mb-2">Per-Item Cost Allocation</div>
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Item</TableHead>
                                  <TableHead>SKU</TableHead>
                                  <TableHead className="text-right">Qty</TableHead>
                                  <TableHead className="text-right">Original Unit Cost</TableHead>
                                  <TableHead className="text-right">Landed Allocation</TableHead>
                                  <TableHead className="text-right">Total Line Cost</TableHead>
                                  <TableHead className="text-right">Effective Unit Cost</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {row.itemBreakdown.map((item) => (
                                  <TableRow key={item.itemId}>
                                    <TableCell className="text-sm font-medium">{item.itemName}</TableCell>
                                    <TableCell className="text-xs text-secondary-500">{item.itemSku}</TableCell>
                                    <TableCell className="text-right text-sm">{item.quantity}</TableCell>
                                    <TableCell className="text-right text-sm">{formatBase(item.originalUnitCost)}</TableCell>
                                    <TableCell className="text-right text-sm text-orange-600 dark:text-orange-400">+{formatBase(item.landedCostAllocation)}</TableCell>
                                    <TableCell className="text-right text-sm">{formatBase(item.totalLineCost)}</TableCell>
                                    <TableCell className="text-right font-semibold text-primary-600 dark:text-primary-400">{formatBase(item.effectiveUnitCost)}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
