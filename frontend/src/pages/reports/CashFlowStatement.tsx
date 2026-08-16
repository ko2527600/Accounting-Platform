import { useState } from "react";
import { Download, Printer, FileText, FileType, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useCashFlow } from "../../hooks/useCashFlow";
import { useTenantSettings } from "../../hooks/useTenantSettings";
import { Button } from "../../components/ui/Button";
import { exportToCsv } from "../../lib/exportCsv";
import { api } from "../../lib/api";
import { downloadBlobResponse } from "../../lib/downloadBlob";
import { useToast } from "../../contexts/ToastContext";

export function CashFlowStatement() {
  const { settings } = useTenantSettings();
  const { showToast } = useToast();
  const [isExporting, setIsExporting] = useState<"pdf" | "docx" | null>(null);
  const {
    startDate,
    endDate,
    netIncome,
    operatingAdjustments,
    netCashFromOperating,
    investingAdjustments,
    netCashFromInvesting,
    financingAdjustments,
    netCashFromFinancing,
    netChangeInCash,
    beginningCash,
    endingCash,
    cashTies,
  } = useCashFlow();

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: settings.baseCurrency,
    }).format(amount);
  };

  const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const periodLabel = startDate
    ? `${fmtDate(startDate)} to ${endDate ? fmtDate(endDate) : 'present'}`
    : `Since inception to ${endDate ? fmtDate(endDate) : 'present'}`;

  const handleExport = () => {
    const exportData = [
      { Section: 'Operating', Line: 'Net Income', Amount: netIncome },
      ...operatingAdjustments.map(a => ({ Section: 'Operating', Line: a.name, Amount: a.change })),
      { Section: 'Operating', Line: 'Net Cash from Operating Activities', Amount: netCashFromOperating },
      ...investingAdjustments.map(a => ({ Section: 'Investing', Line: a.name, Amount: a.change })),
      { Section: 'Investing', Line: 'Net Cash from Investing Activities', Amount: netCashFromInvesting },
      ...financingAdjustments.map(a => ({ Section: 'Financing', Line: a.name, Amount: a.change })),
      { Section: 'Financing', Line: 'Net Cash from Financing Activities', Amount: netCashFromFinancing },
      { Section: 'Summary', Line: 'Net Change in Cash', Amount: netChangeInCash },
      { Section: 'Summary', Line: 'Cash at Beginning of Period', Amount: beginningCash },
      { Section: 'Summary', Line: 'Cash at End of Period', Amount: endingCash },
    ];
    exportToCsv(`cash_flow_statement_${new Date().toISOString().split('T')[0]}`, exportData);
  };

  const handleExportFile = async (format: "pdf" | "docx") => {
    setIsExporting(format);
    try {
      const response = await api.get(`/reports/cash-flow/export?format=${format}`, { responseType: "blob" });
      downloadBlobResponse(response, `Cash_Flow_Statement_${new Date().toISOString().split('T')[0]}.${format}`);
    } catch (err) {
      console.error(`Failed to export Cash Flow Statement as ${format}:`, err);
      showToast(`Failed to export Cash Flow Statement as ${format.toUpperCase()}.`, "error");
    } finally {
      setIsExporting(null);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 print:hidden">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-secondary-900 dark:text-secondary-50">
            Cash Flow Statement
          </h2>
          <p className="text-secondary-500 dark:text-secondary-400 mt-1">
            Where your cash came from and where it went, from day-to-day operations and owner activity.
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
            Cash Flow Statement
          </h2>
          <p className="text-sm text-secondary-500 dark:text-secondary-500 mt-2">
            {periodLabel}
          </p>
          <p className="text-xs text-secondary-400 mt-1">
            All figures are reported in {settings.baseCurrency}
          </p>
        </div>

        {/* Report Body */}
        <div className="space-y-8 text-sm">

          {/* Operating Activities Section */}
          <section>
            <h3 className="font-bold text-lg text-secondary-900 dark:text-secondary-50 border-b border-secondary-200 dark:border-secondary-800 pb-2 mb-4">
              Operating Activities
            </h3>
            <div className="space-y-3 pl-4">
              <div className="flex justify-between items-center text-secondary-700 dark:text-secondary-300 font-semibold">
                <span className="flex-1">Net Income</span>
                <span className="w-32 text-right tabular-nums">{formatCurrency(netIncome)}</span>
              </div>
              {operatingAdjustments.length === 0 ? (
                <div className="text-secondary-500 italic">No changes in working capital accounts to report.</div>
              ) : (
                operatingAdjustments.map((row) => (
                  <div key={row.id} className="flex justify-between items-center text-secondary-700 dark:text-secondary-300">
                    <span className="flex-1">{row.name}</span>
                    <span className="w-32 text-right tabular-nums">{formatCurrency(row.change)}</span>
                  </div>
                ))
              )}
            </div>
            <div className="flex justify-between items-center mt-4 pt-4 border-t border-secondary-200 dark:border-secondary-800 font-bold text-secondary-900 dark:text-secondary-50 pl-4">
              <span className="flex-1 uppercase tracking-wider text-xs">Net Cash from Operating Activities</span>
              <span className="w-32 text-right tabular-nums">{formatCurrency(netCashFromOperating)}</span>
            </div>
          </section>

          {/* Investing Activities Section */}
          <section>
            <h3 className="font-bold text-lg text-secondary-900 dark:text-secondary-50 border-b border-secondary-200 dark:border-secondary-800 pb-2 mb-4">
              Investing Activities
            </h3>
            <div className="space-y-3 pl-4">
              {investingAdjustments.length === 0 ? (
                <div className="text-secondary-500 italic">No fixed asset purchases to report.</div>
              ) : (
                investingAdjustments.map((row) => (
                  <div key={row.id} className="flex justify-between items-center text-secondary-700 dark:text-secondary-300">
                    <span className="flex-1">{row.name}</span>
                    <span className="w-32 text-right tabular-nums">{formatCurrency(row.change)}</span>
                  </div>
                ))
              )}
            </div>
            <div className="flex justify-between items-center mt-4 pt-4 border-t border-secondary-200 dark:border-secondary-800 font-bold text-secondary-900 dark:text-secondary-50 pl-4">
              <span className="flex-1 uppercase tracking-wider text-xs">Net Cash from Investing Activities</span>
              <span className="w-32 text-right tabular-nums">{formatCurrency(netCashFromInvesting)}</span>
            </div>
          </section>

          {/* Financing Activities Section */}
          <section>
            <h3 className="font-bold text-lg text-secondary-900 dark:text-secondary-50 border-b border-secondary-200 dark:border-secondary-800 pb-2 mb-4">
              Financing Activities
            </h3>
            <div className="space-y-3 pl-4">
              {financingAdjustments.length === 0 ? (
                <div className="text-secondary-500 italic">No owner contributions or withdrawals to report.</div>
              ) : (
                financingAdjustments.map((row) => (
                  <div key={row.id} className="flex justify-between items-center text-secondary-700 dark:text-secondary-300">
                    <span className="flex-1">{row.name}</span>
                    <span className="w-32 text-right tabular-nums">{formatCurrency(row.change)}</span>
                  </div>
                ))
              )}
            </div>
            <div className="flex justify-between items-center mt-4 pt-4 border-t border-secondary-200 dark:border-secondary-800 font-bold text-secondary-900 dark:text-secondary-50 pl-4">
              <span className="flex-1 uppercase tracking-wider text-xs">Net Cash from Financing Activities</span>
              <span className="w-32 text-right tabular-nums">{formatCurrency(netCashFromFinancing)}</span>
            </div>
          </section>

          {/* Summary Section */}
          <section className="pt-8 mt-8 border-t-2 border-secondary-900 dark:border-secondary-50">
            <div className="space-y-3">
              <div className="flex justify-between items-center font-bold text-secondary-900 dark:text-secondary-50">
                <span className="flex-1 uppercase tracking-wider text-xs">Net Change in Cash</span>
                <span className="w-32 text-right tabular-nums">{formatCurrency(netChangeInCash)}</span>
              </div>
              <div className="flex justify-between items-center text-secondary-700 dark:text-secondary-300">
                <span className="flex-1">Cash at Beginning of Period</span>
                <span className="w-32 text-right tabular-nums">{formatCurrency(beginningCash)}</span>
              </div>
              <div className="flex justify-between items-center text-xl font-black text-secondary-900 dark:text-secondary-50">
                <span className="flex-1 uppercase tracking-widest">Cash at End of Period</span>
                <span className="w-48 text-right tabular-nums double-underline decoration-double border-b-4 border-double pb-1">
                  {formatCurrency(endingCash)}
                </span>
              </div>
            </div>
            <div className={`mt-4 flex items-center justify-end gap-2 text-xs font-semibold ${cashTies ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
              {cashTies ? (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  Reconciles with actual cash account balances
                </>
              ) : (
                <>
                  <AlertTriangle className="h-4 w-4" />
                  Does not reconcile with actual cash account balances - check your ledger entries
                </>
              )}
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}
