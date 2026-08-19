import { useState, useEffect, useCallback } from "react";
import { GitBranch, RefreshCw, TrendingUp, Package, ArrowLeftRight } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "../../components/ui/Card";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "../../components/ui/Table";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { useTenantSettings } from "../../hooks/useTenantSettings";
import { api } from "../../lib/api";

interface BranchRow {
  id: string;
  name: string;
  location: string | null;
  revenue: number;
  saleCount: number;
  stockValue: number;
  transfersIn: number;
  transfersOut: number;
}

export function BranchComparisonReport() {
  const { settings } = useTenantSettings();
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const today = new Date().toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(thirtyDaysAgo);
  const [endDate, setEndDate] = useState(today);

  const fmt = (amt: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: settings.baseCurrency }).format(amt);

  const fetchReport = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.get("/reports/branch-comparison", { params: { startDate, endDate } });
      if (res.data.success) setBranches(res.data.data.branches);
    } catch (err) {
      console.error("Failed to load branch comparison report:", err);
    } finally {
      setIsLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const totalRevenue = branches.reduce((s, b) => s + b.revenue, 0);
  const topBranch = branches.length > 0 ? branches.reduce((a, b) => (b.revenue > a.revenue ? b : a)) : null;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-secondary-900 dark:text-secondary-50 flex items-center">
            <GitBranch className="mr-2 h-7 w-7 text-primary-600" />
            Branch Comparison
          </h2>
          <p className="text-secondary-500 dark:text-secondary-400 mt-1">
            Revenue, stock value, and stock movements across all branches.
          </p>
        </div>
        <Button variant="outline" onClick={fetchReport} disabled={isLoading} className="flex items-center">
          <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          {isLoading ? "Loading..." : "Refresh"}
        </Button>
      </div>

      {/* Date range */}
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

      {/* Summary tiles */}
      {branches.length > 0 && (
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-secondary-600 dark:text-secondary-400 flex items-center">
                <TrendingUp className="mr-1 h-4 w-4" /> Total Revenue
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-primary-600 dark:text-primary-400">{fmt(totalRevenue)}</div>
              <div className="text-xs text-secondary-500 mt-1">across {branches.length} branch{branches.length !== 1 ? "es" : ""}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-secondary-600 dark:text-secondary-400">
                Top Branch
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-secondary-900 dark:text-secondary-50">
                {topBranch?.name ?? "—"}
              </div>
              <div className="text-xs text-secondary-500 mt-1">
                {topBranch ? fmt(topBranch.revenue) : "No sales yet"}
                {topBranch && totalRevenue > 0
                  ? ` · ${((topBranch.revenue / totalRevenue) * 100).toFixed(1)}% of total`
                  : ""}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-secondary-600 dark:text-secondary-400 flex items-center">
                <Package className="mr-1 h-4 w-4" /> Total Stock Value
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-secondary-900 dark:text-secondary-50">
                {fmt(branches.reduce((s, b) => s + b.stockValue, 0))}
              </div>
              <div className="text-xs text-secondary-500 mt-1">at cost across all branches</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Revenue bar */}
      {totalRevenue > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-secondary-600 dark:text-secondary-400">
              Revenue Split
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-3">
            <div className="flex h-4 rounded-full overflow-hidden gap-0.5">
              {branches
                .filter((b) => b.revenue > 0)
                .map((b, i) => {
                  const colors = [
                    "bg-primary-500",
                    "bg-blue-500",
                    "bg-emerald-500",
                    "bg-amber-500",
                    "bg-purple-500",
                    "bg-rose-500",
                  ];
                  const pct = (b.revenue / totalRevenue) * 100;
                  return (
                    <div
                      key={b.id}
                      className={`${colors[i % colors.length]}`}
                      style={{ width: `${pct}%` }}
                      title={`${b.name}: ${fmt(b.revenue)} (${pct.toFixed(1)}%)`}
                    />
                  );
                })}
            </div>
            <div className="flex flex-wrap gap-3 mt-2">
              {branches
                .filter((b) => b.revenue > 0)
                .map((b, i) => {
                  const colors = [
                    "bg-primary-500",
                    "bg-blue-500",
                    "bg-emerald-500",
                    "bg-amber-500",
                    "bg-purple-500",
                    "bg-rose-500",
                  ];
                  return (
                    <span key={b.id} className="flex items-center gap-1 text-xs text-secondary-600 dark:text-secondary-400">
                      <span className={`inline-block w-2.5 h-2.5 rounded-sm ${colors[i % colors.length]}`} />
                      {b.name}
                    </span>
                  );
                })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Branch table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <ArrowLeftRight className="mr-2 h-5 w-5 text-primary-600 dark:text-primary-400" />
            Branch Detail
          </CardTitle>
          <CardDescription>
            Cash sales revenue, current stock value at cost, and inter-branch transfer counts for the selected period.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-8 text-center text-secondary-500">Loading...</div>
          ) : branches.length === 0 ? (
            <div className="py-12 text-center text-secondary-500 text-sm">No branches found.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Branch</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Sales</TableHead>
                  <TableHead className="text-right">Stock Value</TableHead>
                  <TableHead className="text-right">Transfers In</TableHead>
                  <TableHead className="text-right">Transfers Out</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {branches.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium text-secondary-900 dark:text-secondary-50">{b.name}</TableCell>
                    <TableCell className="text-xs text-secondary-500">{b.location ?? "—"}</TableCell>
                    <TableCell className="text-right font-semibold text-primary-600 dark:text-primary-400">
                      {fmt(b.revenue)}
                    </TableCell>
                    <TableCell className="text-right text-secondary-700 dark:text-secondary-300">
                      {b.saleCount}
                    </TableCell>
                    <TableCell className="text-right text-secondary-700 dark:text-secondary-300">
                      {fmt(b.stockValue)}
                    </TableCell>
                    <TableCell className="text-right text-emerald-700 dark:text-emerald-400">
                      {b.transfersIn > 0 ? `+${b.transfersIn}` : "—"}
                    </TableCell>
                    <TableCell className="text-right text-amber-700 dark:text-amber-400">
                      {b.transfersOut > 0 ? `-${b.transfersOut}` : "—"}
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
