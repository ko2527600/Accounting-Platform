import { Download, Printer, FileText } from "lucide-react";
import { useProfitAndLoss } from "../../hooks/useProfitAndLoss";
import { useTenantSettings } from "../../hooks/useTenantSettings";
import { Button } from "../../components/ui/Button";
import { exportToCsv } from "../../lib/exportCsv";

export function ProfitAndLoss() {
  const { settings } = useTenantSettings();
  const {
    revenueAccounts,
    expenseAccounts,
    totalRevenue,
    totalExpense,
    netIncome
  } = useProfitAndLoss();

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: settings.baseCurrency,
    }).format(amount);
  };

  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const handleExport = () => {
    const exportData = [
      ...revenueAccounts.map(r => ({ Category: 'Income', Account: r.account.name, Balance: r.balance })),
      ...expenseAccounts.map(e => ({ Category: 'Expense', Account: e.account.name, Balance: e.balance })),
      { Category: 'Total', Account: 'Net Income', Balance: netIncome }
    ];
    exportToCsv(`profit_and_loss_${new Date().toISOString().split('T')[0]}`, exportData);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 print:hidden">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-secondary-900 dark:text-secondary-50">
            Profit and Loss
          </h2>
          <p className="text-secondary-500 dark:text-secondary-400 mt-1">
            Review your income and expenses to determine net profit.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="mr-2 h-4 w-4" />
            Print
          </Button>
          <Button variant="outline" onClick={async () => {
            try {
              window.print();
            } catch (e) {
              console.error(e);
            }
          }}>
            <FileText className="mr-2 h-4 w-4 text-primary-600" />
            Export PDF
          </Button>
          <Button variant="primary" onClick={handleExport}>
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
        </div>
      </div>

      <div className="bg-white dark:bg-secondary-950 shadow-sm border border-secondary-200 dark:border-secondary-800 rounded-xl p-8 sm:p-12 print:shadow-none print:border-none print:p-0">
        
        {/* Report Header */}
        <div className="text-center mb-10 border-b border-secondary-200 dark:border-secondary-800 pb-6">
          <h1 className="text-2xl font-bold text-secondary-900 dark:text-secondary-50 tracking-tight uppercase">
            {settings.companyName}
          </h1>
          <h2 className="text-xl text-secondary-600 dark:text-secondary-400 mt-1">
            Profit and Loss Statement
          </h2>
          <p className="text-sm text-secondary-500 dark:text-secondary-500 mt-2">
            As of {today}
          </p>
          <p className="text-xs text-secondary-400 mt-1">
            All figures are reported in {settings.baseCurrency}
          </p>
        </div>

        {/* Report Body */}
        <div className="space-y-8 text-sm">
          
          {/* Income Section */}
          <section>
            <h3 className="font-bold text-lg text-secondary-900 dark:text-secondary-50 border-b border-secondary-200 dark:border-secondary-800 pb-2 mb-4">
              Income
            </h3>
            <div className="space-y-3 pl-4">
              {revenueAccounts.length === 0 ? (
                <div className="text-secondary-500 italic">No revenue activity to report.</div>
              ) : (
                revenueAccounts.map((row) => (
                  <div key={row.account.id} className="flex justify-between items-center text-secondary-700 dark:text-secondary-300">
                    <span className="flex-1">{row.account.name}</span>
                    <span className="w-32 text-right tabular-nums">{formatCurrency(row.balance)}</span>
                  </div>
                ))
              )}
            </div>
            <div className="flex justify-between items-center mt-4 pt-4 border-t border-secondary-200 dark:border-secondary-800 font-bold text-secondary-900 dark:text-secondary-50 pl-4">
              <span className="flex-1 uppercase tracking-wider text-xs">Total Income</span>
              <span className="w-32 text-right tabular-nums">{formatCurrency(totalRevenue)}</span>
            </div>
          </section>

          {/* Expenses Section */}
          <section>
            <h3 className="font-bold text-lg text-secondary-900 dark:text-secondary-50 border-b border-secondary-200 dark:border-secondary-800 pb-2 mb-4">
              Expenses
            </h3>
            <div className="space-y-3 pl-4">
              {expenseAccounts.length === 0 ? (
                <div className="text-secondary-500 italic">No expense activity to report.</div>
              ) : (
                expenseAccounts.map((row) => (
                  <div key={row.account.id} className="flex justify-between items-center text-secondary-700 dark:text-secondary-300">
                    <span className="flex-1">{row.account.name}</span>
                    <span className="w-32 text-right tabular-nums">{formatCurrency(row.balance)}</span>
                  </div>
                ))
              )}
            </div>
            <div className="flex justify-between items-center mt-4 pt-4 border-t border-secondary-200 dark:border-secondary-800 font-bold text-secondary-900 dark:text-secondary-50 pl-4">
              <span className="flex-1 uppercase tracking-wider text-xs">Total Expenses</span>
              <span className="w-32 text-right tabular-nums">{formatCurrency(totalExpense)}</span>
            </div>
          </section>

          {/* Net Income Section */}
          <section className="pt-8 mt-8 border-t-2 border-secondary-900 dark:border-secondary-50">
            <div className={`flex justify-between items-center text-xl font-black ${netIncome >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}>
              <span className="flex-1 uppercase tracking-widest">{netIncome >= 0 ? 'Net Profit' : 'Net Loss'}</span>
              <span className="w-48 text-right tabular-nums double-underline decoration-double border-b-4 border-double pb-1">
                {formatCurrency(netIncome)}
              </span>
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}
