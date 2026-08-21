import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Modal } from "../../components/ui/Modal";
import { api } from "../../lib/api";
import { useToast } from "../../contexts/ToastContext";
import { Landmark, Plus, Pencil } from "lucide-react";

interface Employee {
  id: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
}

interface Loan {
  id: string;
  employeeId: string;
  description: string;
  principal: number;
  monthlyInstallment: number;
  balance: number;
  startDate: string;
  isActive: boolean;
}

const emptyForm = {
  employeeId: "",
  description: "Salary Advance",
  principal: "",
  monthlyInstallment: "",
  startDate: new Date().toISOString().split("T")[0],
};

function fmt(n: number) {
  return new Intl.NumberFormat("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

export function Loans() {
  const { showToast } = useToast();
  const [loans, setLoans] = useState<Loan[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editLoan, setEditLoan] = useState<Loan | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchLoans = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.get(`/payroll/loans?activeOnly=${!showAll}`);
      setLoans(res.data.data.loans || []);
    } catch {
      showToast("Failed to load loans.", "error");
    } finally {
      setIsLoading(false);
    }
  }, [showAll, showToast]);

  useEffect(() => {
    fetchLoans();
    api.get("/payroll/employees?activeOnly=false").then((res) => {
      setEmployees(res.data.data.employees || []);
    });
  }, [fetchLoans]);

  function openAdd() {
    setForm(emptyForm);
    setEditLoan(null);
    setIsModalOpen(true);
  }

  function openEdit(loan: Loan) {
    setForm({
      employeeId: loan.employeeId,
      description: loan.description,
      principal: String(loan.principal),
      monthlyInstallment: String(loan.monthlyInstallment),
      startDate: loan.startDate,
    });
    setEditLoan(loan);
    setIsModalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      if (editLoan) {
        await api.put(`/payroll/loans/${editLoan.id}`, {
          description: form.description,
          monthlyInstallment: Number(form.monthlyInstallment),
          isActive: editLoan.isActive,
        });
        showToast("Loan updated.", "success");
      } else {
        await api.post("/payroll/loans", {
          ...form,
          principal: Number(form.principal),
          monthlyInstallment: Number(form.monthlyInstallment),
        });
        showToast("Loan created.", "success");
      }
      setIsModalOpen(false);
      fetchLoans();
    } catch (err: any) {
      showToast(err?.response?.data?.error || "Failed to save loan.", "error");
    } finally {
      setIsSubmitting(false);
    }
  }

  function employeeName(id: string) {
    const emp = employees.find((e) => e.id === id);
    return emp ? `${emp.firstName} ${emp.lastName} (${emp.employeeNumber})` : id;
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Landmark className="h-6 w-6 text-primary-600" />
          <div>
            <h1 className="text-xl font-bold text-secondary-900 dark:text-secondary-50">Employee Loans</h1>
            <p className="text-xs text-secondary-500">Salary advances deducted automatically during payroll runs</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-secondary-600 dark:text-secondary-400 cursor-pointer">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} className="rounded" />
            Show settled
          </label>
          <Button onClick={openAdd} size="sm">
            <Plus className="h-4 w-4 mr-1" /> New Loan
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-secondary-400 text-sm">Loading loans…</div>
          ) : loans.length === 0 ? (
            <div className="p-8 text-center text-secondary-400 text-sm">No loans yet. Create a salary advance to start deducting from payroll.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-secondary-200 dark:border-secondary-700 bg-secondary-50 dark:bg-secondary-800/50">
                    <th className="px-4 py-3 text-left font-semibold text-secondary-600 dark:text-secondary-400">Employee</th>
                    <th className="px-4 py-3 text-left font-semibold text-secondary-600 dark:text-secondary-400">Description</th>
                    <th className="px-4 py-3 text-right font-semibold text-secondary-600 dark:text-secondary-400">Principal (GHS)</th>
                    <th className="px-4 py-3 text-right font-semibold text-secondary-600 dark:text-secondary-400">Installment (GHS)</th>
                    <th className="px-4 py-3 text-right font-semibold text-secondary-600 dark:text-secondary-400">Balance (GHS)</th>
                    <th className="px-4 py-3 text-left font-semibold text-secondary-600 dark:text-secondary-400">Status</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {loans.map((loan) => (
                    <tr key={loan.id} className="border-b border-secondary-100 dark:border-secondary-800 hover:bg-secondary-50 dark:hover:bg-secondary-800/30">
                      <td className="px-4 py-3 text-secondary-900 dark:text-secondary-100 font-medium">{employeeName(loan.employeeId)}</td>
                      <td className="px-4 py-3 text-secondary-600 dark:text-secondary-400 text-xs">{loan.description}</td>
                      <td className="px-4 py-3 text-right font-mono text-secondary-900 dark:text-secondary-100">{fmt(loan.principal)}</td>
                      <td className="px-4 py-3 text-right font-mono text-secondary-700 dark:text-secondary-300">{fmt(loan.monthlyInstallment)}</td>
                      <td className="px-4 py-3 text-right font-mono font-semibold text-amber-700 dark:text-amber-400">{fmt(loan.balance)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          loan.isActive
                            ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
                            : "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400"
                        }`}>
                          {loan.isActive ? "Active" : "Settled"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(loan)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={editLoan ? "Edit Loan" : "New Employee Loan"}>
        <form onSubmit={handleSubmit} className="space-y-4">
          {!editLoan && (
            <div>
              <label className="block text-xs font-medium text-secondary-700 dark:text-secondary-300 mb-1">Employee *</label>
              <select
                className="w-full rounded-lg border border-secondary-300 dark:border-secondary-600 bg-white dark:bg-secondary-800 text-secondary-900 dark:text-secondary-100 px-3 py-2 text-sm"
                value={form.employeeId}
                onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
                required
              >
                <option value="">Select employee…</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.firstName} {emp.lastName} ({emp.employeeNumber})
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-secondary-700 dark:text-secondary-300 mb-1">Description</label>
            <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          {!editLoan && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-secondary-700 dark:text-secondary-300 mb-1">Principal (GHS) *</label>
                <Input type="number" min="1" step="0.01" value={form.principal} onChange={(e) => setForm({ ...form, principal: e.target.value })} required />
              </div>
              <div>
                <label className="block text-xs font-medium text-secondary-700 dark:text-secondary-300 mb-1">Start Date *</label>
                <Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} required />
              </div>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-secondary-700 dark:text-secondary-300 mb-1">Monthly Installment (GHS) *</label>
            <Input type="number" min="1" step="0.01" value={form.monthlyInstallment} onChange={(e) => setForm({ ...form, monthlyInstallment: e.target.value })} required />
          </div>
          {editLoan && (
            <label className="flex items-center gap-2 text-sm text-secondary-700 dark:text-secondary-300 cursor-pointer">
              <input
                type="checkbox"
                checked={editLoan.isActive}
                onChange={(e) => setEditLoan({ ...editLoan, isActive: e.target.checked })}
                className="rounded"
              />
              Active (deduct from payroll)
            </label>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setIsModalOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Saving…" : editLoan ? "Update" : "Create Loan"}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
