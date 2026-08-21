import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import { api } from "../../lib/api";
import { useToast } from "../../contexts/ToastContext";
import { BadgeDollarSign, Plus, ChevronDown, ChevronUp, CheckCircle, Download } from "lucide-react";

interface Payslip {
  id: string;
  employeeId: string;
  employee?: {
    employeeNumber: string;
    firstName: string;
    lastName: string;
    position: string | null;
    department: string | null;
  };
  grossSalary: number;
  paye: number;
  ssnitEmployee: number;
  ssnitEmployer: number;
  netPay: number;
}

interface PayrollRun {
  id: string;
  runNumber: string;
  periodMonth: number;
  periodYear: number;
  status: "DRAFT" | "POSTED" | "VOID";
  totalGross: number;
  totalPaye: number;
  totalSsnitEmployee: number;
  totalSsnitEmployer: number;
  totalNetPay: number;
  journalEntryId: string | null;
  payslips?: Payslip[];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmt(n: number) {
  return new Intl.NumberFormat("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function statusBadge(status: PayrollRun["status"]) {
  const map = {
    DRAFT: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
    POSTED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
    VOID: "bg-secondary-100 text-secondary-600 dark:bg-secondary-800 dark:text-secondary-400",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${map[status]}`}>
      {status}
    </span>
  );
}

export function PayrollRuns() {
  const { showToast } = useToast();
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedRun, setExpandedRun] = useState<PayrollRun | null>(null);
  const [isRunOpen, setIsRunOpen] = useState(false);
  const [periodMonth, setPeriodMonth] = useState(new Date().getMonth() + 1);
  const [periodYear, setPeriodYear] = useState(new Date().getFullYear());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [postingId, setPostingId] = useState<string | null>(null);

  const fetchRuns = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.get("/payroll/runs");
      setRuns(res.data.data.payrollRuns || []);
    } catch {
      showToast("Failed to load payroll runs.", "error");
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  useEffect(() => { fetchRuns(); }, [fetchRuns]);

  async function toggleExpand(run: PayrollRun) {
    if (expandedId === run.id) {
      setExpandedId(null);
      setExpandedRun(null);
      return;
    }
    try {
      const res = await api.get(`/payroll/runs/${run.id}`);
      setExpandedRun(res.data.data.payrollRun);
      setExpandedId(run.id);
    } catch {
      showToast("Failed to load payslips.", "error");
    }
  }

  async function handleCreateRun(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await api.post("/payroll/runs", { periodMonth, periodYear });
      showToast("Payroll run created.", "success");
      setIsRunOpen(false);
      fetchRuns();
    } catch (err: any) {
      showToast(err?.response?.data?.error || "Failed to create payroll run.", "error");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handlePost(run: PayrollRun) {
    if (!window.confirm(`Post payroll run ${run.runNumber}? This will create an irreversible journal entry.`)) return;
    setPostingId(run.id);
    try {
      await api.post(`/payroll/runs/${run.id}/post`);
      showToast(`Payroll run ${run.runNumber} posted.`, "success");
      fetchRuns();
      if (expandedId === run.id) {
        const res = await api.get(`/payroll/runs/${run.id}`);
        setExpandedRun(res.data.data.payrollRun);
      }
    } catch (err: any) {
      showToast(err?.response?.data?.error || "Failed to post payroll run.", "error");
    } finally {
      setPostingId(null);
    }
  }

  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i);

  async function downloadPdf(url: string, filename: string) {
    try {
      const res = await api.get(url, { responseType: "blob" });
      const blob = new Blob([res.data], { type: "application/pdf" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch {
      showToast("Failed to download PDF.", "error");
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BadgeDollarSign className="h-6 w-6 text-primary-600" />
          <div>
            <h1 className="text-xl font-bold text-secondary-900 dark:text-secondary-50">Payroll Runs</h1>
            <p className="text-xs text-secondary-500">Ghana PAYE & SSNIT payroll processing</p>
          </div>
        </div>
        <Button onClick={() => setIsRunOpen(true)} size="sm">
          <Plus className="h-4 w-4 mr-1" /> New Payroll Run
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-secondary-400 text-sm">Loading payroll runs…</div>
          ) : runs.length === 0 ? (
            <div className="p-8 text-center text-secondary-400 text-sm">No payroll runs yet. Create your first run to process salaries.</div>
          ) : (
            <div className="divide-y divide-secondary-100 dark:divide-secondary-800">
              {runs.map((run) => (
                <div key={run.id}>
                  <div className="flex items-center gap-4 px-4 py-3 hover:bg-secondary-50 dark:hover:bg-secondary-800/30">
                    <button
                      onClick={() => toggleExpand(run)}
                      className="flex items-center gap-2 flex-1 text-left"
                    >
                      {expandedId === run.id ? <ChevronUp className="h-4 w-4 text-secondary-400" /> : <ChevronDown className="h-4 w-4 text-secondary-400" />}
                      <span className="font-mono text-xs text-secondary-500">{run.runNumber}</span>
                      <span className="font-medium text-secondary-900 dark:text-secondary-100 text-sm ml-2">
                        {MONTHS[run.periodMonth - 1]} {run.periodYear}
                      </span>
                    </button>
                    <div className="text-right mr-6">
                      <div className="text-xs text-secondary-500">Total Gross</div>
                      <div className="font-mono font-medium text-secondary-900 dark:text-secondary-100 text-sm">GHS {fmt(run.totalGross)}</div>
                    </div>
                    <div className="text-right mr-6">
                      <div className="text-xs text-secondary-500">Net Pay</div>
                      <div className="font-mono font-medium text-emerald-700 dark:text-emerald-400 text-sm">GHS {fmt(run.totalNetPay)}</div>
                    </div>
                    {statusBadge(run.status)}
                    {run.status === "DRAFT" && (
                      <Button
                        size="sm"
                        onClick={(e) => { e.stopPropagation(); handlePost(run); }}
                        disabled={postingId === run.id}
                        className="ml-2"
                      >
                        <CheckCircle className="h-3.5 w-3.5 mr-1" />
                        {postingId === run.id ? "Posting…" : "Post"}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => { e.stopPropagation(); downloadPdf(`/payroll/runs/${run.id}/pdf`, `payroll-${run.runNumber}.pdf`); }}
                      title="Download payroll run PDF"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                  </div>

                  {expandedId === run.id && expandedRun && (
                    <div className="px-4 pb-4 bg-secondary-50 dark:bg-secondary-900/20">
                      <div className="grid grid-cols-4 gap-4 py-3 mb-3 border-b border-secondary-200 dark:border-secondary-700">
                        <div>
                          <div className="text-xs text-secondary-500">PAYE Withheld</div>
                          <div className="font-mono text-sm font-medium text-red-600 dark:text-red-400">GHS {fmt(run.totalPaye)}</div>
                        </div>
                        <div>
                          <div className="text-xs text-secondary-500">Employee SSNIT (5.5%)</div>
                          <div className="font-mono text-sm font-medium text-secondary-700 dark:text-secondary-300">GHS {fmt(run.totalSsnitEmployee)}</div>
                        </div>
                        <div>
                          <div className="text-xs text-secondary-500">Employer SSNIT (13%)</div>
                          <div className="font-mono text-sm font-medium text-secondary-700 dark:text-secondary-300">GHS {fmt(run.totalSsnitEmployer)}</div>
                        </div>
                        <div>
                          <div className="text-xs text-secondary-500">Net Pay to Employees</div>
                          <div className="font-mono text-sm font-semibold text-emerald-700 dark:text-emerald-400">GHS {fmt(run.totalNetPay)}</div>
                        </div>
                      </div>

                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-secondary-500 text-left">
                            <th className="pb-2 font-semibold">Employee</th>
                            <th className="pb-2 font-semibold text-right">Gross</th>
                            <th className="pb-2 font-semibold text-right">PAYE</th>
                            <th className="pb-2 font-semibold text-right">SSNIT (Emp)</th>
                            <th className="pb-2 font-semibold text-right">SSNIT (Er)</th>
                            <th className="pb-2 font-semibold text-right">Net Pay</th>
                            <th className="pb-2" />
                          </tr>
                        </thead>
                        <tbody>
                          {(expandedRun.payslips || []).map((slip) => (
                            <tr key={slip.id} className="border-t border-secondary-100 dark:border-secondary-800">
                              <td className="py-1.5">
                                <div className="font-medium text-secondary-900 dark:text-secondary-100">
                                  {slip.employee ? `${slip.employee.firstName} ${slip.employee.lastName}` : slip.employeeId}
                                </div>
                                {slip.employee?.position && (
                                  <div className="text-secondary-400">{slip.employee.position}</div>
                                )}
                              </td>
                              <td className="py-1.5 text-right font-mono text-secondary-700 dark:text-secondary-300">{fmt(slip.grossSalary)}</td>
                              <td className="py-1.5 text-right font-mono text-red-600 dark:text-red-400">{fmt(slip.paye)}</td>
                              <td className="py-1.5 text-right font-mono text-secondary-600 dark:text-secondary-400">{fmt(slip.ssnitEmployee)}</td>
                              <td className="py-1.5 text-right font-mono text-secondary-600 dark:text-secondary-400">{fmt(slip.ssnitEmployer)}</td>
                              <td className="py-1.5 text-right font-mono font-semibold text-emerald-700 dark:text-emerald-400">{fmt(slip.netPay)}</td>
                              <td className="py-1.5 pl-2">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    const name = slip.employee ? `${slip.employee.firstName}-${slip.employee.lastName}` : slip.employeeId;
                                    downloadPdf(`/payroll/runs/${expandedRun.id}/payslips/${slip.id}/pdf`, `payslip-${name}-${expandedRun.runNumber}.pdf`);
                                  }}
                                  title="Download payslip PDF"
                                >
                                  <Download className="h-3 w-3" />
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Modal isOpen={isRunOpen} onClose={() => setIsRunOpen(false)} title="New Payroll Run">
        <form onSubmit={handleCreateRun} className="space-y-4">
          <p className="text-sm text-secondary-600 dark:text-secondary-400">
            Select the payroll period. Ghana PAYE and SSNIT will be computed automatically for all active employees.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-secondary-700 dark:text-secondary-300 mb-1">Month</label>
              <select
                className="w-full rounded-lg border border-secondary-300 dark:border-secondary-600 bg-white dark:bg-secondary-800 text-secondary-900 dark:text-secondary-100 px-3 py-2 text-sm"
                value={periodMonth}
                onChange={(e) => setPeriodMonth(Number(e.target.value))}
              >
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-secondary-700 dark:text-secondary-300 mb-1">Year</label>
              <select
                className="w-full rounded-lg border border-secondary-300 dark:border-secondary-600 bg-white dark:bg-secondary-800 text-secondary-900 dark:text-secondary-100 px-3 py-2 text-sm"
                value={periodYear}
                onChange={(e) => setPeriodYear(Number(e.target.value))}
              >
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setIsRunOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Processing…" : "Run Payroll"}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
