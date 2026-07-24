import { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "../../components/ui/Table";
import { api } from "../../lib/api";
import { Flame, Clock, Lightbulb, Download, FileSpreadsheet, RefreshCw, ArrowRight } from "lucide-react";

interface FastSeller {
  id: string;
  sku: string;
  name: string;
  totalStock: number;
  unitOfMeasure: string;
  status: string;
}

interface SlowMoving {
  id: string;
  sku: string;
  name: string;
  totalStock: number;
  unitOfMeasure: string;
  status: string;
}

interface Suggestion {
  itemId: string;
  itemName: string;
  fromWarehouseName: string;
  toWarehouseName: string;
  suggestedQty: number;
  reason: string;
}

export function InventoryIntelligence() {
  const [fastSellers, setFastSellers] = useState<FastSeller[]>([]);
  const [slowMoving, setSlowMoving] = useState<SlowMoving[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchIntelligence = async () => {
    setIsLoading(true);
    try {
      const res = await api.get("/analytics/stock-intelligence");
      if (res.data.success) {
        setFastSellers(res.data.data.fastSellers);
        setSlowMoving(res.data.data.slowMoving);
        setSuggestions(res.data.data.suggestions);
      }
    } catch (err) {
      console.error("Failed to load inventory intelligence:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchIntelligence();
  }, []);

  const handleExportCSV = async () => {
    try {
      const res = await api.get("/analytics/export/csv?reportType=stock-intelligence", { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `Stock_Intelligence_Report_${Date.now()}.csv`);
      document.body.appendChild(link);
      link.click();
    } catch (err) {
      alert("Failed to export CSV dataset.");
    }
  };

  const handleExportPDF = () => {
    window.print();
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-secondary-900 dark:text-secondary-50">
            Inventory Decision Intelligence Tower
          </h2>
          <p className="text-secondary-500 dark:text-secondary-400 mt-1">
            Real-time analysis of fast-moving products, idle dead stock ("not going items"), and automated shop re-allocation.
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <Button variant="outline" onClick={fetchIntelligence} className="flex items-center">
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh Analysis
          </Button>
          <Button variant="outline" onClick={handleExportCSV} className="flex items-center">
            <FileSpreadsheet className="mr-2 h-4 w-4 text-emerald-600" />
            Export Excel / CSV
          </Button>
          <Button variant="primary" onClick={handleExportPDF} className="flex items-center">
            <Download className="mr-2 h-4 w-4" />
            Export PDF
          </Button>
        </div>
      </div>

      {/* Smart Stock Re-allocation Suggestions Banner */}
      <Card className="border-amber-200 bg-amber-50/50 dark:bg-amber-950/20 dark:border-amber-900/50 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold text-amber-900 dark:text-amber-300 flex items-center">
            <Lightbulb className="mr-2 h-5 w-5 text-amber-600" />
            Smart Stock Re-Allocation Recommendations ({suggestions.length})
          </CardTitle>
          <CardDescription className="text-amber-800/80 dark:text-amber-400/80 text-xs">
            Automated recommendations to balance inventory by transferring idle stock from slow shops to high-demand branches.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {suggestions.length === 0 ? (
            <div className="text-xs text-amber-800 dark:text-amber-400 italic">
              All shop inventory levels are currently balanced optimally.
            </div>
          ) : (
            <div className="space-y-3">
              {suggestions.map((sugg, idx) => (
                <div key={idx} className="p-3 bg-white dark:bg-secondary-900 rounded-lg border border-amber-200 dark:border-amber-900/40 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
                  <div>
                    <span className="font-bold text-secondary-900 dark:text-secondary-100">{sugg.itemName}</span>
                    <p className="text-secondary-500 mt-0.5">{sugg.reason}</p>
                  </div>
                  <div className="flex items-center space-x-2 flex-shrink-0">
                    <span className="px-2 py-1 bg-secondary-100 dark:bg-secondary-800 rounded font-medium">{sugg.fromWarehouseName}</span>
                    <ArrowRight className="h-4 w-4 text-amber-600" />
                    <span className="px-2 py-1 bg-secondary-100 dark:bg-secondary-800 rounded font-medium">{sugg.toWarehouseName}</span>
                    <span className="px-2.5 py-1 bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 font-bold rounded">
                      Move {sugg.suggestedQty} pcs
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Grid: Fast Sellers vs Slow Moving / Dead Stock */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Fast-Selling Products */}
        <Card className="border-none shadow-md">
          <CardHeader>
            <CardTitle className="text-emerald-700 dark:text-emerald-400 flex items-center">
              <Flame className="mr-2 h-5 w-5" />
              Fast-Selling Products ("Hot Items")
            </CardTitle>
            <CardDescription>High turnover products with rapid sales velocity.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="py-8 text-center text-secondary-500">Analyzing sales velocity...</div>
            ) : fastSellers.length === 0 ? (
              <div className="py-8 text-center text-secondary-400 text-xs">No fast-selling products identified yet.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Stock On Hand</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fastSellers.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-mono text-xs font-semibold text-primary-600">{item.sku}</TableCell>
                      <TableCell className="font-medium text-xs">{item.name}</TableCell>
                      <TableCell className="text-right">
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                          {item.totalStock} {item.unitOfMeasure}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Slow-Moving / Dead Stock */}
        <Card className="border-none shadow-md">
          <CardHeader>
            <CardTitle className="text-rose-700 dark:text-rose-400 flex items-center">
              <Clock className="mr-2 h-5 w-5" />
              Slow-Moving / Dead Stock ("Not Going Items")
            </CardTitle>
            <CardDescription>Idle products sitting in shops with zero or low movement.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="py-8 text-center text-secondary-500">Analyzing idle inventory...</div>
            ) : slowMoving.length === 0 ? (
              <div className="py-8 text-center text-secondary-400 text-xs">No slow-moving items detected.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Stock Idle</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {slowMoving.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-mono text-xs font-semibold text-rose-600">{item.sku}</TableCell>
                      <TableCell className="font-medium text-xs">{item.name}</TableCell>
                      <TableCell className="text-right">
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-400">
                          {item.totalStock} {item.unitOfMeasure}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
