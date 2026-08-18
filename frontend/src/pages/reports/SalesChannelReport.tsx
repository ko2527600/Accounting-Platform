import { useState, useEffect, useCallback } from "react";
import { Store, RefreshCw } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "../../components/ui/Card";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "../../components/ui/Table";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { useTenantSettings } from "../../hooks/useTenantSettings";
import { api } from "../../lib/api";

interface ChannelSummary {
  totalAmount: number;
  count: number;
}

interface SalesChannelSummary {
  RETAIL: ChannelSummary;
  WHOLESALE: ChannelSummary;
  TOTAL: ChannelSummary;
}

interface SaleLine {
  id: string;
  receiptNo: string;
  saleType: "RETAIL" | "WHOLESALE";
  amount: number;
  createdAt: string;
}

export function SalesChannelReport() {
  const { settings } = useTenantSettings();
  const [summary, setSummary] = useState<SalesChannelSummary | null>(null);
  const [sales, setSales] = useState<SaleLine[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(thirtyDaysAgo);
  const [endDate, setEndDate] = useState(today);

  const formatCurrency = (amt: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: settings.baseCurrency }).format(amt);

  const fetchReport = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.get("/reports/sales-channel", {
        params: { startDate, endDate },
      });
      if (res.data.success) {
        setSummary(res.data.data.summary);
        setSales(res.data.data.sales);
      }
    } catch (err) {
      console.error("Failed to load sales channel report:", err);
    } finally {
      setIsLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const retailPct =
    summary && summary.TOTAL.totalAmount > 0
      ? ((summary.RETAIL.totalAmount / summary.TOTAL.totalAmount) * 100).toFixed(1)
      : "0.0";
  const wholesalePct =
    summary && summary.TOTAL.totalAmount > 0
      ? ((summary.WHOLESALE.totalAmount / summary.TOTAL.totalAmount) * 100).toFixed(1)
      : "0.0";

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-secondary-900 dark:text-secondary-50 flex items-center">
            <Store className="mr-2 h-7 w-7 text-primary-600" />
            Sales Channel Report
          </h2>
          <p className="text-secondary-500 dark:text-secondary-400 mt-1">
            Retail vs. wholesale revenue breakdown from cash till sales.
          </p>
        </div>
        <Button variant="outline" onClick={fetchReport} disabled={isLoading} className="flex items-center">
          <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          {isLoading ? "Loading..." : "Refresh"}
        </Button>
      </div>

      {/* Date Range Filter */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <label className="block text-sm font-medium mb-1">From</label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-40" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">To</label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-40" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Tiles */}
      {summary && (
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="border-blue-100 dark:border-blue-950">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-secondary-600 dark:text-secondary-400">
                Retail Revenue
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-700 dark:text-blue-400">
                {formatCurrency(summary.RETAIL.totalAmount)}
              </div>
              <div className="text-xs text-secondary-500 mt-1">
                {summary.RETAIL.count} sale{summary.RETAIL.count !== 1 ? "s" : ""} · {retailPct}% of total
              </div>
            </CardContent>
          </Card>

          <Card className="border-emerald-100 dark:border-emerald-950">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-secondary-600 dark:text-secondary-400">
                Wholesale Revenue
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">
                {formatCurrency(summary.WHOLESALE.totalAmount)}
              </div>
              <div className="text-xs text-secondary-500 mt-1">
                {summary.WHOLESALE.count} sale{summary.WHOLESALE.count !== 1 ? "s" : ""} · {wholesalePct}% of total
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-secondary-600 dark:text-secondary-400">
                Total Revenue
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-secondary-900 dark:text-secondary-50">
                {formatCurrency(summary.TOTAL.totalAmount)}
              </div>
              <div className="text-xs text-secondary-500 mt-1">
                {summary.TOTAL.count} sale{summary.TOTAL.count !== 1 ? "s" : ""} across both channels
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Split Bar */}
      {summary && summary.TOTAL.totalAmount > 0 && (
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex text-xs text-secondary-500 justify-between mb-1">
              <span>Retail {retailPct}%</span>
              <span>Wholesale {wholesalePct}%</span>
            </div>
            <div className="flex h-3 rounded-full overflow-hidden">
              <div
                className="bg-blue-500"
                style={{ width: `${retailPct}%` }}
                title={`Retail: ${formatCurrency(summary.RETAIL.totalAmount)}`}
              />
              <div
                className="bg-emerald-500 flex-1"
                title={`Wholesale: ${formatCurrency(summary.WHOLESALE.totalAmount)}`}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Sales Ledger */}
      <Card>
        <CardHeader>
          <CardTitle>Cash Sales Ledger ({sales.length})</CardTitle>
          <CardDescription>Individual POS sales tagged by channel for the selected period.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-8 text-center text-secondary-500">Loading...</div>
          ) : sales.length === 0 ? (
            <div className="py-8 text-center text-secondary-500 text-sm">
              No sales found for the selected date range.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Receipt #</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sales.map((sale) => (
                  <TableRow key={sale.id}>
                    <TableCell className="font-mono text-xs text-primary-600 dark:text-primary-400">
                      {sale.receiptNo}
                    </TableCell>
                    <TableCell>
                      {sale.saleType === "WHOLESALE" ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">
                          Wholesale
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
                          Retail
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-secondary-500">
                      {new Date(sale.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right font-semibold text-secondary-900 dark:text-secondary-50">
                      {formatCurrency(Number(sale.amount))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
