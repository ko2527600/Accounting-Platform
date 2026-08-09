import { Download, Printer, TrendingUp, TrendingDown, Percent, Scale, Wallet, PieChart, AlertTriangle, Layers } from "lucide-react";
import { useKpiDashboard } from "../../hooks/useKpiDashboard";
import { useTenantSettings } from "../../hooks/useTenantSettings";
import { Button } from "../../components/ui/Button";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "../../components/ui/Card";
import { exportToCsv } from "../../lib/exportCsv";

function formatPct(value: number | null): string {
  return value === null ? "N/A" : `${value.toFixed(1)}%`;
}

function formatRatio(value: number | null): string {
  return value === null ? "N/A" : value.toFixed(2);
}

export function KpiDashboard() {
  const { settings } = useTenantSettings();
  const {
    netIncome,
    totalRevenue,
    totalCostOfSales,
    totalAssets,
    totalLiabilities,
    totalEquity,
    totalCashEquivalents,
    netProfitMarginPct,
    grossProfitMarginPct,
    returnOnAssetsPct,
    debtToEquityRatio,
    cashRatio,
    equityRatioPct,
  } = useKpiDashboard();

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: settings.baseCurrency,
    }).format(amount);
  };

  const handleExport = () => {
    exportToCsv(`kpi_dashboard_${new Date().toISOString().split('T')[0]}`, [
      { Metric: 'Net Profit Margin %', Value: netProfitMarginPct },
      { Metric: 'Gross Profit Margin %', Value: grossProfitMarginPct },
      { Metric: 'Return on Assets %', Value: returnOnAssetsPct },
      { Metric: 'Debt-to-Equity Ratio', Value: debtToEquityRatio },
      { Metric: 'Cash Ratio', Value: cashRatio },
      { Metric: 'Equity Ratio %', Value: equityRatioPct },
      { Metric: 'Net Income', Value: netIncome },
      { Metric: 'Total Revenue', Value: totalRevenue },
      { Metric: 'Total Assets', Value: totalAssets },
      { Metric: 'Total Liabilities', Value: totalLiabilities },
      { Metric: 'Total Equity', Value: totalEquity },
      { Metric: 'Total Cash & Equivalents', Value: totalCashEquivalents },
    ]);
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 print:space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 print:hidden">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-secondary-900 dark:text-secondary-50">
            KPI & Financial Ratio Dashboard
          </h2>
          <p className="text-secondary-500 dark:text-secondary-400 mt-1">
            Quick-glance profitability and financial health signals, since inception to today.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="mr-2 h-4 w-4" />
            Print
          </Button>
          <Button variant="primary" onClick={handleExport}>
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <Card className={netIncome >= 0 ? "border-emerald-100 dark:border-emerald-950" : "border-red-100 dark:border-red-950"}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-semibold text-secondary-600 dark:text-secondary-400">Net Profit Margin</CardTitle>
            {netIncome >= 0 ? <TrendingUp className="h-5 w-5 text-emerald-500" /> : <TrendingDown className="h-5 w-5 text-red-500" />}
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${netIncome >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
              {formatPct(netProfitMarginPct)}
            </div>
            <p className="text-xs text-secondary-500 mt-1">
              Net Income {formatCurrency(netIncome)} / Revenue {formatCurrency(totalRevenue)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-semibold text-secondary-600 dark:text-secondary-400">Gross Profit Margin</CardTitle>
            <Layers className="h-5 w-5 text-primary-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-secondary-900 dark:text-secondary-50">{formatPct(grossProfitMarginPct)}</div>
            {totalCostOfSales > 0 ? (
              <p className="text-xs text-secondary-500 mt-1">
                Revenue {formatCurrency(totalRevenue)} - Cost of Sales {formatCurrency(totalCostOfSales)}
              </p>
            ) : (
              <p className="text-xs text-secondary-500 mt-1">Post to a "Cost of Sales" account to see a real margin here.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-semibold text-secondary-600 dark:text-secondary-400">Return on Assets</CardTitle>
            <PieChart className="h-5 w-5 text-primary-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-secondary-900 dark:text-secondary-50">{formatPct(returnOnAssetsPct)}</div>
            <p className="text-xs text-secondary-500 mt-1">How much profit each {settings.baseCurrency} of assets generates.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-semibold text-secondary-600 dark:text-secondary-400">Equity Ratio</CardTitle>
            <Scale className="h-5 w-5 text-primary-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-secondary-900 dark:text-secondary-50">{formatPct(equityRatioPct)}</div>
            <p className="text-xs text-secondary-500 mt-1">Share of assets owned outright vs. financed by liabilities.</p>
          </CardContent>
        </Card>

        <Card className={debtToEquityRatio !== null && debtToEquityRatio < 0 ? "border-amber-100 dark:border-amber-950" : undefined}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-semibold text-secondary-600 dark:text-secondary-400">Debt-to-Equity Ratio</CardTitle>
            <Scale className="h-5 w-5 text-primary-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-secondary-900 dark:text-secondary-50">{formatRatio(debtToEquityRatio)}</div>
            {debtToEquityRatio !== null && debtToEquityRatio < 0 ? (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Negative equity - liabilities exceed assets.
              </p>
            ) : (
              <p className="text-xs text-secondary-500 mt-1">Liabilities {formatCurrency(totalLiabilities)} / Equity {formatCurrency(totalEquity)}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-semibold text-secondary-600 dark:text-secondary-400">Cash Ratio</CardTitle>
            <Wallet className="h-5 w-5 text-primary-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-secondary-900 dark:text-secondary-50">{formatRatio(cashRatio)}</div>
            <p className="text-xs text-secondary-500 mt-1">
              Cash & Bank {formatCurrency(totalCashEquivalents)} / Liabilities {formatCurrency(totalLiabilities)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-semibold text-secondary-600 dark:text-secondary-400">Net Income</CardTitle>
            <Percent className="h-5 w-5 text-primary-500" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${netIncome >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
              {formatCurrency(netIncome)}
            </div>
            <p className="text-xs text-secondary-500 mt-1">Since inception to today.</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>About These Numbers</CardTitle>
          <CardDescription>What's included, and what's deliberately left out.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-secondary-600 dark:text-secondary-400 space-y-2">
          <p>
            These ratios are computed directly from your Chart of Accounts and posted ledger entries - the same
            numbers behind your Balance Sheet and Profit &amp; Loss reports.
          </p>
          <p>
            Gross Profit Margin uses whatever you've posted to a "Cost of Sales" account - it reads "N/A" until you
            post something there, since Point of Sale checkouts don't automatically record a Cost of Goods Sold entry
            yet (that needs real inventory costing, a bigger separate piece of work). Inventory Turnover and
            Current/Quick Ratio still aren't shown because they need data this platform doesn't track at all yet (a
            current-vs-long-term split on accounts) - an approximation there would risk a misleading figure.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
