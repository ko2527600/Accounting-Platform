import { useState, useEffect, useCallback } from "react";
import { TrendingUp, TrendingDown, Info } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/Card";
import { api } from "../../lib/api";
import { useTenantSettings } from "../../hooks/useTenantSettings";

interface ForecastEvent {
  date: string;
  source: "RECURRING_TRANSACTION" | "INVOICE_DUE" | "BILL_DUE";
  description: string;
  amount: number;
}

interface ForecastWeek {
  weekStart: string;
  weekEnd: string;
  inflows: number;
  outflows: number;
  netChange: number;
  projectedBalance: number;
}

interface ForecastData {
  asOfDate: string;
  days: number;
  startingCashBalance: number;
  endingProjectedBalance: number;
  totalProjectedInflow: number;
  totalProjectedOutflow: number;
  weeks: ForecastWeek[];
  events: ForecastEvent[];
}

const sourceLabel: Record<string, string> = {
  RECURRING_TRANSACTION: "Recurring",
  INVOICE_DUE: "Invoice due",
  BILL_DUE: "Bill due",
};

export function CashFlowForecast() {
  const { settings } = useTenantSettings();
  const [days, setDays] = useState(180);
  const [forecast, setForecast] = useState<ForecastData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchForecast = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.get("/reports/cash-flow-forecast", { params: { days } });
      if (res.data.success) setForecast(res.data.data);
    } catch (err) {
      console.error("Failed to load cash flow forecast:", err);
    } finally {
      setIsLoading(false);
    }
  }, [days]);

  useEffect(() => {
    fetchForecast();
  }, [fetchForecast]);

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: settings.baseCurrency }).format(amount);

  const maxAbsBalance = forecast
    ? Math.max(forecast.startingCashBalance, ...forecast.weeks.map((w) => Math.abs(w.projectedBalance)), 1)
    : 1;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h2 className="text-3xl font-bold tracking-tight text-secondary-900 dark:text-secondary-50">
          Cash Flow Forecast
        </h2>
        <p className="text-secondary-500 dark:text-secondary-400 mt-1">
          A forward projection grounded entirely in real, already-scheduled or already-owed cash events - not a
          trend guess.
        </p>
      </div>

      <div className="flex items-center gap-2 p-3 bg-primary-50 dark:bg-primary-950/30 border border-primary-200 dark:border-primary-900 rounded-lg text-xs text-primary-800 dark:text-primary-300">
        <Info className="h-4 w-4 flex-shrink-0" />
        <span>
          Built from real Recurring Transactions, outstanding Invoices, and outstanding Vendor Bills due within the
          window - not a historical-average trend extrapolation. Approved-but-unreimbursed Expense Claims are
          deliberately excluded since they have no due date to project against honestly.
        </span>
      </div>

      <div className="flex gap-2">
        {[30, 90, 180].map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold border ${
              days === d
                ? "bg-primary-600 text-white border-primary-600"
                : "bg-white dark:bg-secondary-900 text-secondary-600 dark:text-secondary-400 border-secondary-300 dark:border-secondary-700"
            }`}
          >
            {d} days
          </button>
        ))}
      </div>

      {isLoading || !forecast ? (
        <div className="py-8 text-center text-secondary-500">Loading forecast...</div>
      ) : (
        <>
          <div className="grid gap-6 md:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-secondary-600 dark:text-secondary-400">
                  Starting Cash (as of {new Date(forecast.asOfDate).toLocaleDateString()})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xl font-bold text-secondary-900 dark:text-secondary-50">
                  {formatCurrency(forecast.startingCashBalance)}
                </div>
              </CardContent>
            </Card>
            <Card className="border-emerald-100 dark:border-emerald-950">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-secondary-600 dark:text-secondary-400 flex items-center">
                  <TrendingUp className="mr-1.5 h-4 w-4 text-emerald-500" /> Projected Inflows
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
                  {formatCurrency(forecast.totalProjectedInflow)}
                </div>
              </CardContent>
            </Card>
            <Card className="border-red-100 dark:border-red-950">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-secondary-600 dark:text-secondary-400 flex items-center">
                  <TrendingDown className="mr-1.5 h-4 w-4 text-red-500" /> Projected Outflows
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xl font-bold text-red-600 dark:text-red-400">
                  {formatCurrency(forecast.totalProjectedOutflow)}
                </div>
              </CardContent>
            </Card>
            <Card className={forecast.endingProjectedBalance < 0 ? "border-red-300 dark:border-red-800" : ""}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-secondary-600 dark:text-secondary-400">
                  Projected Balance in {forecast.days} Days
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div
                  className={`text-xl font-bold ${
                    forecast.endingProjectedBalance < 0
                      ? "text-red-600 dark:text-red-400"
                      : "text-secondary-900 dark:text-secondary-50"
                  }`}
                >
                  {formatCurrency(forecast.endingProjectedBalance)}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Weekly Projected Balance</CardTitle>
              <CardDescription>Running cash balance at the end of each week, bucketed from real events.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-1.5">
                {forecast.weeks.map((w) => {
                  const barWidthPct = Math.max(2, (Math.abs(w.projectedBalance) / maxAbsBalance) * 100);
                  const isNegative = w.projectedBalance < 0;
                  return (
                    <div key={w.weekStart} className="flex items-center gap-3 text-xs">
                      <div className="w-24 flex-shrink-0 text-secondary-500">
                        {new Date(w.weekStart).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      </div>
                      <div className="flex-1 bg-secondary-100 dark:bg-secondary-800 rounded h-4 overflow-hidden">
                        <div
                          className={`h-full rounded ${isNegative ? "bg-red-400" : "bg-primary-500"}`}
                          style={{ width: `${barWidthPct}%` }}
                        />
                      </div>
                      <div
                        className={`w-28 flex-shrink-0 text-right font-semibold ${
                          isNegative ? "text-red-600 dark:text-red-400" : "text-secondary-900 dark:text-secondary-50"
                        }`}
                      >
                        {formatCurrency(w.projectedBalance)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Contributing Events ({forecast.events.length})</CardTitle>
              <CardDescription>
                Every number above traces back to one of these real, dated events - nothing is estimated.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {forecast.events.length === 0 ? (
                <div className="py-4 text-center text-xs text-secondary-500">
                  No recurring transactions or outstanding invoices/bills due within this window.
                </div>
              ) : (
                <div className="space-y-1 max-h-96 overflow-y-auto text-xs">
                  {forecast.events.map((e, idx) => (
                    <div
                      key={idx}
                      className="flex justify-between items-center border-b border-secondary-100 dark:border-secondary-800 py-1.5"
                    >
                      <div>
                        <span className="text-secondary-500">{new Date(e.date).toLocaleDateString()}</span>{" "}
                        <span className="text-secondary-400">[{sourceLabel[e.source]}]</span>{" "}
                        <span className="text-secondary-900 dark:text-secondary-50">{e.description}</span>
                      </div>
                      <span className={e.amount >= 0 ? "text-emerald-600 font-semibold" : "text-red-600 font-semibold"}>
                        {e.amount >= 0 ? "+" : ""}
                        {formatCurrency(e.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
