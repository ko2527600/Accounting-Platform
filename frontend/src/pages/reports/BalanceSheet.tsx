import { useState } from "react";
import { Download, Printer, FileText, FileType, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useBalanceSheet } from "../../hooks/useBalanceSheet";
import { useTenantSettings } from "../../hooks/useTenantSettings";
import { Button } from "../../components/ui/Button";
import { exportToCsv } from "../../lib/exportCsv";
import { api } from "../../lib/api";
import { downloadBlobResponse } from "../../lib/downloadBlob";
import { useToast } from "../../contexts/ToastContext";

export function BalanceSheet() {
  const { settings } = useTenantSettings();
  const { showToast } = useToast();
  const [isExporting, setIsExporting] = useState<"pdf" | "docx" | null>(null);
  const {
    assetAccounts,
    liabilityAccounts,
    equityAccounts,
    totalAssets,
    totalLiabilities,
    retainedEarnings,
    totalEquity,
    totalLiabilitiesAndEquity,
    isBalanced,
    asOfDate,
  } = useBalanceSheet();

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: settings.baseCurrency,
    }).format(amount);
  };

  const displayDate = asOfDate
    ? new Date(asOfDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const handleExport = () => {
    const exportData = [
      ...assetAccounts.map(a => ({ Category: 'Asset', Account: a.account.name, Balance: a.balance })),
      { Category: 'Total', Account: 'Total Assets', Balance: totalAssets },
      ...liabilityAccounts.map(l => ({ Category: 'Liability', Account: l.account.name, Balance: l.balance })),
      { Category: 'Total', Account: 'Total Liabilities', Balance: totalLiabilities },
      ...equityAccounts.map(e => ({ Category: 'Equity', Account: e.account.name, Balance: e.balance })),
      { Category: 'Equity', Account: 'Retained Earnings', Balance: retainedEarnings },
      { Category: 'Total', Account: 'Total Equity', Balance: totalEquity },
      { Category: 'Total', Account: 'Total Liabilities & Equity', Balance: totalLiabilitiesAndEquity },
    ];
    exportToCsv(`balance_sheet_${new Date().toISOString().split('T')[0]}`, exportData);
  };

  const handleExportFile = async (format: "pdf" | "docx") => {
    setIsExporting(format);
    try {
      const response = await api.get(`/reports/balance-sheet/export?format=${format}`, { responseType: "blob" });
      downloadBlobResponse(response, `Balance_Sheet_${new Date().toISOString().split('T')[0]}.${format}`);
    } catch (err) {
      console.error(`Failed to export Balance Sheet as ${format}:`, err);
      showToast(`Failed to export Balance Sheet as ${format.toUpperCase()}.`, "error");
    } finally {
      setIsExporting(null);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 print:hidden">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-secondary-900 dark:text-secondary-50">
            Balance Sheet
          </h2>
          <p className="text-secondary-500 dark:text-secondary-400 mt-1">
            A snapshot of what your business owns, owes, and is worth on a given date.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="mr-2 h-4 w-4" />
            Print
          </Button>
          <Button variant="outline" disabled={isExporting === "pdf"} onClick={() => handleExportFile("pdf")}>
            <FileText className="mr-2 h-4 w-4 text-primary-600" />
            {isExporting === "pdf" ? "Exporting..." : "Export PDF"}
          </Button>
          <Button variant="outline" disabled={isExporting === "docx"} onClick={() => handleExportFile("docx")}>
            <FileType className="mr-2 h-4 w-4 text-blue-600" />
            {isExporting === "docx" ? "Exporting..." : "Export Word"}
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
            Balance Sheet
          </h2>
          <p className="text-sm text-secondary-500 dark:text-secondary-500 mt-2">
            As of {displayDate}
          </p>
          <p className="text-xs text-secondary-400 mt-1">
            All figures are reported in {settings.baseCurrency}
          </p>
        </div>

        {/* Report Body */}
        <div className="space-y-8 text-sm">

          {/* Assets Section */}
          <section>
            <h3 className="font-bold text-lg text-secondary-900 dark:text-secondary-50 border-b border-secondary-200 dark:border-secondary-800 pb-2 mb-4">
              Assets
            </h3>
            <div className="space-y-3 pl-4">
              {assetAccounts.length === 0 ? (
                <div className="text-secondary-500 italic">No asset accounts to report.</div>
              ) : (
                assetAccounts.map((row) => (
                  <div key={row.account.id} className="flex justify-between items-center text-secondary-700 dark:text-secondary-300">
                    <span className="flex-1">{row.account.name}</span>
                    <span className="w-32 text-right tabular-nums">{formatCurrency(row.balance)}</span>
                  </div>
                ))
              )}
            </div>
            <div className="flex justify-between items-center mt-4 pt-4 border-t border-secondary-200 dark:border-secondary-800 font-bold text-secondary-900 dark:text-secondary-50 pl-4">
              <span className="flex-1 uppercase tracking-wider text-xs">Total Assets</span>
              <span className="w-32 text-right tabular-nums">{formatCurrency(totalAssets)}</span>
            </div>
          </section>

          {/* Liabilities Section */}
          <section>
            <h3 className="font-bold text-lg text-secondary-900 dark:text-secondary-50 border-b border-secondary-200 dark:border-secondary-800 pb-2 mb-4">
              Liabilities
            </h3>
            <div className="space-y-3 pl-4">
              {liabilityAccounts.length === 0 ? (
                <div className="text-secondary-500 italic">No liability accounts to report.</div>
              ) : (
                liabilityAccounts.map((row) => (
                  <div key={row.account.id} className="flex justify-between items-center text-secondary-700 dark:text-secondary-300">
                    <span className="flex-1">{row.account.name}</span>
                    <span className="w-32 text-right tabular-nums">{formatCurrency(row.balance)}</span>
                  </div>
                ))
              )}
            </div>
            <div className="flex justify-between items-center mt-4 pt-4 border-t border-secondary-200 dark:border-secondary-800 font-bold text-secondary-900 dark:text-secondary-50 pl-4">
              <span className="flex-1 uppercase tracking-wider text-xs">Total Liabilities</span>
              <span className="w-32 text-right tabular-nums">{formatCurrency(totalLiabilities)}</span>
            </div>
          </section>

          {/* Equity Section */}
          <section>
            <h3 className="font-bold text-lg text-secondary-900 dark:text-secondary-50 border-b border-secondary-200 dark:border-secondary-800 pb-2 mb-4">
              Equity
            </h3>
            <div className="space-y-3 pl-4">
              {equityAccounts.length === 0 ? (
                <div className="text-secondary-500 italic">No equity accounts to report.</div>
              ) : (
                equityAccounts.map((row) => (
                  <div key={row.account.id} className="flex justify-between items-center text-secondary-700 dark:text-secondary-300">
                    <span className="flex-1">{row.account.name}</span>
                    <span className="w-32 text-right tabular-nums">{formatCurrency(row.balance)}</span>
                  </div>
                ))
              )}
              <div className="flex justify-between items-center text-secondary-700 dark:text-secondary-300">
                <span className="flex-1">Retained Earnings</span>
                <span className="w-32 text-right tabular-nums">{formatCurrency(retainedEarnings)}</span>
              </div>
            </div>
            <div className="flex justify-between items-center mt-4 pt-4 border-t border-secondary-200 dark:border-secondary-800 font-bold text-secondary-900 dark:text-secondary-50 pl-4">
              <span className="flex-1 uppercase tracking-wider text-xs">Total Equity</span>
              <span className="w-32 text-right tabular-nums">{formatCurrency(totalEquity)}</span>
            </div>
          </section>

          {/* Balance Check Section */}
          <section className="pt-8 mt-8 border-t-2 border-secondary-900 dark:border-secondary-50">
            <div className="flex justify-between items-center text-xl font-black text-secondary-900 dark:text-secondary-50">
              <span className="flex-1 uppercase tracking-widest">Total Liabilities & Equity</span>
              <span className="w-48 text-right tabular-nums double-underline decoration-double border-b-4 border-double pb-1">
                {formatCurrency(totalLiabilitiesAndEquity)}
              </span>
            </div>
            <div className={`mt-4 flex items-center justify-end gap-2 text-xs font-semibold ${isBalanced ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
              {isBalanced ? (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  Assets = Liabilities + Equity (balanced)
                </>
              ) : (
                <>
                  <AlertTriangle className="h-4 w-4" />
                  Assets do not equal Liabilities + Equity - check your ledger entries
                </>
              )}
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}
