import { useState, useEffect, useMemo } from "react";
import { TrendingUp, TrendingDown, Users, ShoppingBag, BarChart3, Award } from "lucide-react";
import { api } from "../../lib/api";
import { useTenantSettings } from "../../hooks/useTenantSettings";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";

interface TrendPoint {
  month: string;
  label: string;
  revenue: number;
  cogs: number;
  expenses: number;
  netProfit: number;
}

interface TopCustomer {
  id: string;
  name: string;
  email: string;
  customerType: string;
  revenue: number;
  invoiceCount: number;
}

interface TopItem {
  itemId: string;
  itemName: string;
  itemSku: string;
  revenue: number;
  quantity: number;
}

type Period = 3 | 6 | 12;

// --- Inline SVG bar chart ---
function TrendChart({
  series,
  currency,
}: {
  series: TrendPoint[];
  currency: string;
}) {
  const fmt = (v: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(v);

  if (!series.length) return null;

  const maxVal = Math.max(...series.flatMap((p) => [p.revenue, p.expenses + p.cogs]));
  const W = 700;
  const H = 200;
  const PAD = { top: 16, right: 8, bottom: 48, left: 56 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;
  const barGroupW = chartW / series.length;
  const barPad = barGroupW * 0.15;
  const barW = Math.max(4, (barGroupW - barPad * 2) / 2 - 2);

  const yScale = (v: number) => chartH - (maxVal > 0 ? (v / maxVal) * chartH : 0);

  // Y-axis grid lines
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({
    y: yScale(maxVal * t),
    label: fmt(maxVal * t),
  }));

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        aria-label="Revenue and expenses monthly trend chart"
        role="img"
      >
        {/* Y-axis grid */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line
              x1={PAD.left}
              x2={PAD.left + chartW}
              y1={PAD.top + t.y}
              y2={PAD.top + t.y}
              stroke="currentColor"
              strokeOpacity={0.1}
              strokeWidth={1}
            />
            <text
              x={PAD.left - 6}
              y={PAD.top + t.y + 4}
              textAnchor="end"
              fontSize={9}
              fill="currentColor"
              opacity={0.5}
            >
              {t.label}
            </text>
          </g>
        ))}

        {/* Bars */}
        {series.map((pt, i) => {
          const x = PAD.left + i * barGroupW + barPad;
          const revH = (maxVal > 0 ? pt.revenue / maxVal : 0) * chartH;
          const expH = (maxVal > 0 ? (pt.expenses + pt.cogs) / maxVal : 0) * chartH;
          const profitPositive = pt.netProfit >= 0;
          return (
            <g key={pt.month}>
              {/* Revenue bar */}
              <rect
                x={x}
                y={PAD.top + chartH - revH}
                width={barW}
                height={Math.max(2, revH)}
                rx={2}
                fill="#22c55e"
                opacity={0.85}
              >
                <title>{`${pt.label} Revenue: ${fmt(pt.revenue)}`}</title>
              </rect>
              {/* Expenses bar */}
              <rect
                x={x + barW + 2}
                y={PAD.top + chartH - expH}
                width={barW}
                height={Math.max(2, expH)}
                rx={2}
                fill="#f97316"
                opacity={0.75}
              >
                <title>{`${pt.label} Total Costs: ${fmt(pt.expenses + pt.cogs)}`}</title>
              </rect>
              {/* Net profit dot on top of revenue bar */}
              <circle
                cx={x + barW / 2}
                cy={PAD.top + yScale(Math.max(0, pt.netProfit))}
                r={3}
                fill={profitPositive ? "#3b82f6" : "#ef4444"}
                opacity={0.9}
              >
                <title>{`${pt.label} Net Profit: ${fmt(pt.netProfit)}`}</title>
              </circle>
              {/* X label */}
              <text
                x={x + barW}
                y={PAD.top + chartH + 14}
                textAnchor="middle"
                fontSize={9}
                fill="currentColor"
                opacity={0.6}
              >
                {pt.label}
              </text>
            </g>
          );
        })}

        {/* Baseline */}
        <line
          x1={PAD.left}
          x2={PAD.left + chartW}
          y1={PAD.top + chartH}
          y2={PAD.top + chartH}
          stroke="currentColor"
          strokeOpacity={0.2}
          strokeWidth={1}
        />
      </svg>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-2 pl-2 text-xs text-secondary-500 dark:text-secondary-400">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm bg-green-500 opacity-85" />
          Revenue
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm bg-orange-500 opacity-75" />
          Total Costs
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-full bg-blue-500 opacity-90" />
          Net Profit
        </span>
      </div>
    </div>
  );
}

// --- Tiny horizontal bar for proportional share ---
function ShareBar({ pct }: { pct: number }) {
  return (
    <div className="w-full bg-secondary-100 dark:bg-secondary-800 rounded-full h-1.5 mt-1">
      <div
        className="h-1.5 rounded-full bg-primary-500"
        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
      />
    </div>
  );
}

export function AnalyticsDashboard() {
  const { settings } = useTenantSettings();
  const [period, setPeriod] = useState<Period>(12);
  const [trends, setTrends] = useState<TrendPoint[]>([]);
  const [customers, setCustomers] = useState<TopCustomer[]>([]);
  const [items, setItems] = useState<TopItem[]>([]);
  const [isLoadingTrends, setIsLoadingTrends] = useState(true);
  const [isLoadingCustomers, setIsLoadingCustomers] = useState(true);
  const [isLoadingItems, setIsLoadingItems] = useState(true);

  const currency = settings.baseCurrency || "USD";

  const fmt = (v: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency }).format(v);
  const fmtCompact = (v: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(v);

  // Derive date window for customer/item queries
  const { startDate, endDate } = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - period + 1, 1);
    return {
      startDate: start.toISOString().split("T")[0],
      endDate: now.toISOString().split("T")[0],
    };
  }, [period]);

  useEffect(() => {
    setIsLoadingTrends(true);
    api
      .get(`/reports/analytics/trends?months=${period}`)
      .then((res) => setTrends(res.data.data?.series ?? []))
      .catch(() => setTrends([]))
      .finally(() => setIsLoadingTrends(false));
  }, [period]);

  useEffect(() => {
    setIsLoadingCustomers(true);
    api
      .get(`/reports/analytics/top-customers?startDate=${startDate}&endDate=${endDate}&limit=5`)
      .then((res) => setCustomers(res.data.data?.customers ?? []))
      .catch(() => setCustomers([]))
      .finally(() => setIsLoadingCustomers(false));
  }, [startDate, endDate]);

  useEffect(() => {
    setIsLoadingItems(true);
    api
      .get(`/reports/analytics/top-items?startDate=${startDate}&endDate=${endDate}&limit=5`)
      .then((res) => setItems(res.data.data?.items ?? []))
      .catch(() => setItems([]))
      .finally(() => setIsLoadingItems(false));
  }, [startDate, endDate]);

  // Summary KPIs from the trend series
  const summary = useMemo(() => {
    if (!trends.length) return null;
    const totalRevenue = trends.reduce((s, p) => s + p.revenue, 0);
    const totalExpenses = trends.reduce((s, p) => s + p.expenses + p.cogs, 0);
    const totalProfit = trends.reduce((s, p) => s + p.netProfit, 0);
    const prevHalf = trends.slice(0, Math.floor(trends.length / 2));
    const recentHalf = trends.slice(Math.floor(trends.length / 2));
    const prevRev = prevHalf.reduce((s, p) => s + p.revenue, 0);
    const recentRev = recentHalf.reduce((s, p) => s + p.revenue, 0);
    const revTrendPct = prevRev > 0 ? ((recentRev - prevRev) / prevRev) * 100 : null;
    return { totalRevenue, totalExpenses, totalProfit, revTrendPct };
  }, [trends]);

  const maxCustomerRev = customers[0]?.revenue ?? 1;
  const maxItemRev = items[0]?.revenue ?? 1;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-secondary-900 dark:text-secondary-50">
            Analytics Dashboard
          </h2>
          <p className="text-secondary-500 dark:text-secondary-400 mt-1">
            Revenue trends, top customers, and best-selling items at a glance.
          </p>
        </div>
        {/* Period pills */}
        <div className="flex items-center gap-1 bg-secondary-100 dark:bg-secondary-800 p-1 rounded-lg">
          {([3, 6, 12] as Period[]).map((m) => (
            <button
              key={m}
              onClick={() => setPeriod(m)}
              className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                period === m
                  ? "bg-white dark:bg-secondary-700 text-secondary-900 dark:text-secondary-50 shadow-sm"
                  : "text-secondary-500 hover:text-secondary-700 dark:hover:text-secondary-300"
              }`}
            >
              {m}M
            </button>
          ))}
        </div>
      </div>

      {/* Summary KPI tiles */}
      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-5">
              <p className="text-xs font-medium uppercase tracking-wide text-secondary-500 dark:text-secondary-400">
                Total Revenue
              </p>
              <p className="text-2xl font-bold text-secondary-900 dark:text-secondary-50 mt-1">
                {fmtCompact(summary.totalRevenue)}
              </p>
              {summary.revTrendPct !== null && (
                <span
                  className={`inline-flex items-center gap-0.5 text-xs mt-1 ${
                    summary.revTrendPct >= 0 ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"
                  }`}
                >
                  {summary.revTrendPct >= 0 ? (
                    <TrendingUp className="h-3 w-3" aria-hidden />
                  ) : (
                    <TrendingDown className="h-3 w-3" aria-hidden />
                  )}
                  {Math.abs(summary.revTrendPct).toFixed(1)}% vs prior half
                </span>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <p className="text-xs font-medium uppercase tracking-wide text-secondary-500 dark:text-secondary-400">
                Total Costs
              </p>
              <p className="text-2xl font-bold text-secondary-900 dark:text-secondary-50 mt-1">
                {fmtCompact(summary.totalExpenses)}
              </p>
              <p className="text-xs text-secondary-400 mt-1">COGS + operating expenses</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <p className="text-xs font-medium uppercase tracking-wide text-secondary-500 dark:text-secondary-400">
                Net Profit
              </p>
              <p
                className={`text-2xl font-bold mt-1 ${
                  summary.totalProfit >= 0
                    ? "text-green-600 dark:text-green-400"
                    : "text-red-500 dark:text-red-400"
                }`}
              >
                {fmtCompact(summary.totalProfit)}
              </p>
              {summary.totalRevenue > 0 && (
                <p className="text-xs text-secondary-400 mt-1">
                  {((summary.totalProfit / summary.totalRevenue) * 100).toFixed(1)}% margin
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Trend chart */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-secondary-500" aria-hidden />
            Revenue vs Costs — Last {period} Months
          </CardTitle>
          <CardDescription>
            Each month shows Revenue (green) and Total Costs (orange) bars; the dot marks Net Profit.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingTrends ? (
            <div className="h-48 flex items-center justify-center text-secondary-400 text-sm">
              Loading chart data…
            </div>
          ) : trends.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-secondary-400 text-sm">
              No posted journal entries found for this period.
            </div>
          ) : (
            <TrendChart series={trends} currency={currency} />
          )}
        </CardContent>
      </Card>

      {/* Top Customers + Top Items */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Customers */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-4 w-4 text-secondary-500" aria-hidden />
              Top Customers
            </CardTitle>
            <CardDescription>By invoiced revenue paid in the selected period</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingCustomers ? (
              <div className="text-sm text-secondary-400 py-6 text-center">Loading…</div>
            ) : customers.length === 0 ? (
              <div className="text-sm text-secondary-400 py-6 text-center">
                No paid invoice revenue recorded yet.
              </div>
            ) : (
              <ol className="space-y-4">
                {customers.map((c, i) => (
                  <li key={c.id} className="flex items-start gap-3">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-secondary-100 dark:bg-secondary-800 text-xs font-semibold flex items-center justify-center text-secondary-500">
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-sm text-secondary-900 dark:text-secondary-50 truncate">
                          {c.name}
                        </span>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {i === 0 && (
                            <Award className="h-3.5 w-3.5 text-amber-500" aria-label="Top customer" />
                          )}
                          <span className="text-sm font-semibold text-secondary-900 dark:text-secondary-50">
                            {fmt(c.revenue)}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-xs text-secondary-400 mt-0.5">
                        <span>{c.invoiceCount} invoice{c.invoiceCount !== 1 ? "s" : ""}</span>
                        <Badge variant={c.customerType === "WHOLESALE" ? "default" : "secondary"}>
                          {c.customerType === "WHOLESALE" ? "Wholesale" : "Retail"}
                        </Badge>
                      </div>
                      <ShareBar pct={(c.revenue / maxCustomerRev) * 100} />
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        {/* Top Items */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShoppingBag className="h-4 w-4 text-secondary-500" aria-hidden />
              Top-Selling Items
            </CardTitle>
            <CardDescription>By POS revenue in the selected period</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingItems ? (
              <div className="text-sm text-secondary-400 py-6 text-center">Loading…</div>
            ) : items.length === 0 ? (
              <div className="text-sm text-secondary-400 py-6 text-center">
                No POS sales recorded yet.
              </div>
            ) : (
              <ol className="space-y-4">
                {items.map((item, i) => (
                  <li key={item.itemId} className="flex items-start gap-3">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-secondary-100 dark:bg-secondary-800 text-xs font-semibold flex items-center justify-center text-secondary-500">
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-sm text-secondary-900 dark:text-secondary-50 truncate">
                          {item.itemName}
                        </span>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {i === 0 && (
                            <Award className="h-3.5 w-3.5 text-amber-500" aria-label="Top item" />
                          )}
                          <span className="text-sm font-semibold text-secondary-900 dark:text-secondary-50">
                            {fmt(item.revenue)}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-xs text-secondary-400 mt-0.5">
                        <span>{item.quantity.toLocaleString()} units sold</span>
                        <span className="font-mono text-[10px]">{item.itemSku}</span>
                      </div>
                      <ShareBar pct={(item.revenue / maxItemRev) * 100} />
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
