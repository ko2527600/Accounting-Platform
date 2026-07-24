import { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "../../components/ui/Table";
import { api } from "../../lib/api";
import { formatMoney } from "../../lib/utils";
import { Calendar, Download, FileSpreadsheet, Store, CheckCircle, AlertTriangle, TrendingUp } from "lucide-react";

interface CloseoutReport {
  id: string;
  closedBy: string;
  openingCash: number;
  cashSales: number;
  expectedCash: number;
  actualCash: number;
  discrepancy: number;
  itemsSold: number;
  closedAt: string;
  warehouse?: { name: string; code: string };
}

interface ShopLeader {
  id: string;
  name: string;
  code: string;
  location?: string;
  totalRevenue: number;
}

export function ExecutiveReports() {
  const [activeTab, setActiveTab] = useState<"daily" | "monthly" | "yearly" | "closeouts">("daily");
  const [dailyTotal, setDailyTotal] = useState(0);
  const [monthlyTotal, setMonthlyTotal] = useState(0);
  const [yearlyTotal, setYearlyTotal] = useState(0);
  const [shopLeaderboard, setShopLeaderboard] = useState<ShopLeader[]>([]);
  const [closeouts, setCloseouts] = useState<CloseoutReport[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchReports = async () => {
    setIsLoading(true);
    try {
      const [sumRes, closeRes] = await Promise.all([
        api.get("/analytics/executive-summary"),
        api.get("/tills/closeouts"),
      ]);

      if (sumRes.data.success) {
        setDailyTotal(sumRes.data.data.dailyTotal);
        setMonthlyTotal(sumRes.data.data.monthlyTotal);
        setYearlyTotal(sumRes.data.data.yearlyTotal);
        setShopLeaderboard(sumRes.data.data.shopLeaderboard);
      }

      if (closeRes.data.success) {
        setCloseouts(closeRes.data.data.closeouts);
      }
    } catch (err) {
      console.error("Failed to fetch executive reports:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchReports();
  }, []);

  const handleExportCSV = async () => {
    try {
      const res = await api.get(`/analytics/export/csv?reportType=${activeTab}`, { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `AccountGo_${activeTab}_report_${Date.now()}.csv`);
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
            Executive Performance & Till Closeout Reports
          </h2>
          <p className="text-secondary-500 dark:text-secondary-400 mt-1">
            Daily, Monthly, and Yearly sales breakdowns, End-of-Day cash till reconciliation, and PDF/Excel downloads.
          </p>
        </div>

        <div className="flex items-center space-x-2">
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

      {/* KPI Cards: Daily, Monthly, Yearly Revenue */}
      <div className="grid gap-6 md:grid-cols-3">
        <Card className={`cursor-pointer transition-all ${activeTab === 'daily' ? 'border-primary-500 ring-2 ring-primary-500/20' : ''}`} onClick={() => setActiveTab('daily')}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-secondary-500">Today's Sales Revenue</CardTitle>
            <Calendar className="h-5 w-5 text-primary-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-secondary-900 dark:text-secondary-50">{formatMoney(dailyTotal)}</div>
            <p className="text-xs text-secondary-500 mt-1">Real-time daily cash sales across all shops</p>
          </CardContent>
        </Card>

        <Card className={`cursor-pointer transition-all ${activeTab === 'monthly' ? 'border-primary-500 ring-2 ring-primary-500/20' : ''}`} onClick={() => setActiveTab('monthly')}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-secondary-500">This Month's Revenue</CardTitle>
            <TrendingUp className="h-5 w-5 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-secondary-900 dark:text-secondary-50">{formatMoney(monthlyTotal)}</div>
            <p className="text-xs text-secondary-500 mt-1">Cumulative sales for current calendar month</p>
          </CardContent>
        </Card>

        <Card className={`cursor-pointer transition-all ${activeTab === 'yearly' ? 'border-primary-500 ring-2 ring-primary-500/20' : ''}`} onClick={() => setActiveTab('yearly')}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-secondary-500">Year-to-Date (YTD) Revenue</CardTitle>
            <Store className="h-5 w-5 text-indigo-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-secondary-900 dark:text-secondary-50">{formatMoney(yearlyTotal)}</div>
            <p className="text-xs text-secondary-500 mt-1">Total revenue recorded for {new Date().getFullYear()}</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs Switcher */}
      <div className="flex border-b border-secondary-200 dark:border-secondary-800 space-x-4">
        <button
          onClick={() => setActiveTab("daily")}
          className={`pb-3 text-sm font-medium transition-colors border-b-2 ${activeTab === "daily" ? "border-primary-600 text-primary-600" : "border-transparent text-secondary-500 hover:text-secondary-700"}`}
        >
          Daily Breakdown
        </button>
        <button
          onClick={() => setActiveTab("monthly")}
          className={`pb-3 text-sm font-medium transition-colors border-b-2 ${activeTab === "monthly" ? "border-primary-600 text-primary-600" : "border-transparent text-secondary-500 hover:text-secondary-700"}`}
        >
          Monthly Performance
        </button>
        <button
          onClick={() => setActiveTab("yearly")}
          className={`pb-3 text-sm font-medium transition-colors border-b-2 ${activeTab === "yearly" ? "border-primary-600 text-primary-600" : "border-transparent text-secondary-500 hover:text-secondary-700"}`}
        >
          Yearly Performance
        </button>
        <button
          onClick={() => setActiveTab("closeouts")}
          className={`pb-3 text-sm font-medium transition-colors border-b-2 ${activeTab === "closeouts" ? "border-primary-600 text-primary-600" : "border-transparent text-secondary-500 hover:text-secondary-700"}`}
        >
          End-of-Day Till Closeouts ({closeouts.length})
        </button>
      </div>

      {/* Main Content Area */}
      {isLoading ? (
        <div className="py-12 text-center text-secondary-500">Loading executive reports & till closeouts...</div>
      ) : activeTab === "closeouts" ? (
        <Card>
          <CardHeader>
            <CardTitle>Daily Cash Till Closeout Feed (Owner & Accountant View)</CardTitle>
            <CardDescription>
              End-of-day drawer balancing reports submitted by Shop Managers, including actual physical cash counted vs expected balances and over/short discrepancies.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {closeouts.length === 0 ? (
              <div className="py-8 text-center text-secondary-400 text-sm">No daily closeout reports submitted yet.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date / Time</TableHead>
                    <TableHead>Shop Location</TableHead>
                    <TableHead>Closed By</TableHead>
                    <TableHead>Opening Cash</TableHead>
                    <TableHead>Cash Sales</TableHead>
                    <TableHead>Expected Cash</TableHead>
                    <TableHead>Actual Cash Counted</TableHead>
                    <TableHead>Discrepancy</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {closeouts.map((c) => {
                    const disc = Number(c.discrepancy);
                    const isBalanced = disc === 0;
                    const isOver = disc > 0;

                    return (
                      <TableRow key={c.id}>
                        <TableCell className="text-xs font-mono">
                          {new Date(c.closedAt).toLocaleString()}
                        </TableCell>
                        <TableCell className="font-semibold text-xs text-secondary-900 dark:text-secondary-50">
                          {c.warehouse?.name || "Shop Location"}
                        </TableCell>
                        <TableCell className="text-xs">{c.closedBy}</TableCell>
                        <TableCell className="text-xs">{formatMoney(Number(c.openingCash))}</TableCell>
                        <TableCell className="text-xs font-bold text-emerald-600">{formatMoney(Number(c.cashSales))}</TableCell>
                        <TableCell className="text-xs">{formatMoney(Number(c.expectedCash))}</TableCell>
                        <TableCell className="text-xs font-bold">{formatMoney(Number(c.actualCash))}</TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${isBalanced ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : isOver ? 'bg-blue-100 text-blue-800' : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-400'}`}>
                            {isBalanced ? <CheckCircle className="mr-1 h-3 w-3" /> : <AlertTriangle className="mr-1 h-3 w-3" />}
                            {isBalanced ? "BALANCED" : isOver ? `+${formatMoney(disc)} (Over)` : `${formatMoney(disc)} (Short)`}
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
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {/* Shop Sales Leaderboard */}
          <Card className="border-none shadow-md">
            <CardHeader>
              <CardTitle className="flex items-center text-primary-700 dark:text-primary-400">
                <Store className="mr-2 h-5 w-5" />
                Top-Selling Shops Leaderboard
              </CardTitle>
              <CardDescription>Shop branch ranking based on total revenue generated.</CardDescription>
            </CardHeader>
            <CardContent>
              {shopLeaderboard.length === 0 ? (
                <div className="py-8 text-center text-secondary-400 text-xs">No shop sales recorded yet.</div>
              ) : (
                <div className="space-y-4">
                  {shopLeaderboard.map((shop, idx) => (
                    <div key={shop.id} className="flex items-center justify-between p-3 rounded-lg bg-secondary-50 dark:bg-secondary-900 border border-secondary-100 dark:border-secondary-800">
                      <div className="flex items-center space-x-3">
                        <span className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs ${idx === 0 ? 'bg-amber-400 text-amber-950' : idx === 1 ? 'bg-secondary-300 text-secondary-900' : 'bg-secondary-200 text-secondary-700'}`}>
                          #{idx + 1}
                        </span>
                        <div>
                          <div className="font-semibold text-sm text-secondary-900 dark:text-secondary-50">{shop.name}</div>
                          <div className="text-xs text-secondary-500">{shop.location || "Branch Store"} ({shop.code})</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-extrabold text-base text-emerald-600 dark:text-emerald-400">
                          {formatMoney(Number(shop.totalRevenue))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Timeframe Summary Card */}
          <Card className="border-none shadow-md">
            <CardHeader>
              <CardTitle className="capitalize">{activeTab} Business Analytics Summary</CardTitle>
              <CardDescription>Overview of sales metrics for the selected time horizon.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="p-4 rounded-xl bg-primary-50 dark:bg-primary-950/40 border border-primary-100 dark:border-primary-900">
                <div className="text-xs text-primary-700 dark:text-primary-300 font-medium">Total Period Sales Revenue</div>
                <div className="text-3xl font-extrabold text-primary-900 dark:text-primary-100 mt-1">
                  {formatMoney(activeTab === 'daily' ? dailyTotal : activeTab === 'monthly' ? monthlyTotal : yearlyTotal)}
                </div>
              </div>

              <div className="space-y-2 text-xs text-secondary-600 dark:text-secondary-400">
                <div className="flex justify-between py-2 border-b border-secondary-100 dark:border-secondary-800">
                  <span>Reporting Period:</span>
                  <strong className="text-secondary-900 dark:text-secondary-100 capitalize">{activeTab} View</strong>
                </div>
                <div className="flex justify-between py-2 border-b border-secondary-100 dark:border-secondary-800">
                  <span>Export Formats Available:</span>
                  <strong className="text-emerald-600">PDF & Excel / CSV</strong>
                </div>
                <div className="flex justify-between py-2">
                  <span>Till Reconciliation Status:</span>
                  <strong className="text-emerald-600">Active & Automated</strong>
                </div>
              </div>

              <div className="flex space-x-2 pt-2">
                <Button variant="outline" onClick={handleExportCSV} className="w-1/2 flex items-center justify-center">
                  <FileSpreadsheet className="mr-2 h-4 w-4 text-emerald-600" />
                  Download CSV
                </Button>
                <Button variant="primary" onClick={handleExportPDF} className="w-1/2 flex items-center justify-center">
                  <Download className="mr-2 h-4 w-4" />
                  Download PDF
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
