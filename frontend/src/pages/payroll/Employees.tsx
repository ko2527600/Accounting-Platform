import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Modal } from "../../components/ui/Modal";
import { api } from "../../lib/api";
import { useToast } from "../../contexts/ToastContext";
import { Plus, Pencil, Users } from "lucide-react";

interface Employee {
  id: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  position: string | null;
  department: string | null;
  grossSalary: number;
  salaryCurrency: string;
  salaryExchangeRate: number;
  dateOfJoining: string | null;
  dateOfLeaving: string | null;
  isActive: boolean;
}

const COMMON_CURRENCIES = ["GHS", "USD", "EUR", "GBP", "NGN", "XOF", "XAF", "ZAR"];

const emptyForm = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  position: "",
  department: "",
  grossSalary: "",
  salaryCurrency: "GHS",
  salaryExchangeRate: "",
  dateOfJoining: new Date().toISOString().split("T")[0],
};

function fmt(n: number) {
  return new Intl.NumberFormat("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

export function Employees() {
  const { showToast } = useToast();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editEmployee, setEditEmployee] = useState<Employee | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchEmployees = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.get(`/payroll/employees?activeOnly=${!showAll}`);
      setEmployees(res.data.data.employees || []);
    } catch {
      showToast("Failed to load employees.", "error");
    } finally {
      setIsLoading(false);
    }
  }, [showAll, showToast]);

  useEffect(() => { fetchEmployees(); }, [fetchEmployees]);

  function openAdd() {
    setForm(emptyForm);
    setEditEmployee(null);
    setIsAddOpen(true);
  }

  function openEdit(emp: Employee) {
    setForm({
      firstName: emp.firstName,
      lastName: emp.lastName,
      email: emp.email || "",
      phone: emp.phone || "",
      position: emp.position || "",
      department: emp.department || "",
      grossSalary: String(emp.grossSalary),
      salaryCurrency: emp.salaryCurrency || "GHS",
      salaryExchangeRate: emp.salaryCurrency && emp.salaryCurrency !== "GHS" ? String(emp.salaryExchangeRate) : "",
      dateOfJoining: emp.dateOfJoining || new Date().toISOString().split("T")[0],
    });
    setEditEmployee(emp);
    setIsAddOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const isFx = form.salaryCurrency !== "GHS";
      const payload = {
        ...form,
        grossSalary: Number(form.grossSalary),
        salaryCurrency: form.salaryCurrency,
        salaryExchangeRate: isFx ? Number(form.salaryExchangeRate) : 1,
        email: form.email || null,
        phone: form.phone || null,
        position: form.position || null,
        department: form.department || null,
        dateOfJoining: form.dateOfJoining || null,
      };
      if (editEmployee) {
        await api.put(`/payroll/employees/${editEmployee.id}`, { ...payload, isActive: editEmployee.isActive });
        showToast("Employee updated.", "success");
      } else {
        await api.post("/payroll/employees", payload);
        showToast("Employee added.", "success");
      }
      setIsAddOpen(false);
      fetchEmployees();
    } catch (err: any) {
      showToast(err?.response?.data?.error || "Failed to save employee.", "error");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Users className="h-6 w-6 text-primary-600" />
          <div>
            <h1 className="text-xl font-bold text-secondary-900 dark:text-secondary-50">Employees</h1>
            <p className="text-xs text-secondary-500">Manage the employee roster for payroll processing</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-secondary-600 dark:text-secondary-400 cursor-pointer">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(e) => setShowAll(e.target.checked)}
              className="rounded"
            />
            Show inactive
          </label>
          <Button onClick={openAdd} size="sm">
            <Plus className="h-4 w-4 mr-1" /> Add Employee
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-secondary-400 text-sm">Loading employees…</div>
          ) : employees.length === 0 ? (
            <div className="p-8 text-center text-secondary-400 text-sm">No employees yet. Add your first employee to begin payroll.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-secondary-200 dark:border-secondary-700 bg-secondary-50 dark:bg-secondary-800/50">
                    <th className="px-4 py-3 text-left font-semibold text-secondary-600 dark:text-secondary-400">#</th>
                    <th className="px-4 py-3 text-left font-semibold text-secondary-600 dark:text-secondary-400">Name</th>
                    <th className="px-4 py-3 text-left font-semibold text-secondary-600 dark:text-secondary-400">Position / Dept</th>
                    <th className="px-4 py-3 text-right font-semibold text-secondary-600 dark:text-secondary-400">Gross Salary</th>
                    <th className="px-4 py-3 text-left font-semibold text-secondary-600 dark:text-secondary-400">Status</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {employees.map((emp) => (
                    <tr key={emp.id} className="border-b border-secondary-100 dark:border-secondary-800 hover:bg-secondary-50 dark:hover:bg-secondary-800/30">
                      <td className="px-4 py-3 text-secondary-500 font-mono text-xs">{emp.employeeNumber}</td>
                      <td className="px-4 py-3 font-medium text-secondary-900 dark:text-secondary-100">
                        {emp.firstName} {emp.lastName}
                        {emp.email && <div className="text-xs text-secondary-400">{emp.email}</div>}
                      </td>
                      <td className="px-4 py-3 text-secondary-600 dark:text-secondary-400 text-xs">
                        {emp.position && <div>{emp.position}</div>}
                        {emp.department && <div className="text-secondary-400">{emp.department}</div>}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-secondary-900 dark:text-secondary-100">
                        {fmt(emp.grossSalary)}
                        {emp.salaryCurrency && emp.salaryCurrency !== "GHS" && (
                          <span className="ml-1 text-xs font-sans text-secondary-400">{emp.salaryCurrency}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          emp.isActive
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400"
                            : "bg-secondary-100 text-secondary-600 dark:bg-secondary-800 dark:text-secondary-400"
                        }`}>
                          {emp.isActive ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(emp)}>
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

      <Modal isOpen={isAddOpen} onClose={() => setIsAddOpen(false)} title={editEmployee ? "Edit Employee" : "Add Employee"}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-secondary-700 dark:text-secondary-300 mb-1">First Name *</label>
              <Input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} required />
            </div>
            <div>
              <label className="block text-xs font-medium text-secondary-700 dark:text-secondary-300 mb-1">Last Name *</label>
              <Input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-secondary-700 dark:text-secondary-300 mb-1">Email</label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-medium text-secondary-700 dark:text-secondary-300 mb-1">Phone</label>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-secondary-700 dark:text-secondary-300 mb-1">Position</label>
              <Input value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-medium text-secondary-700 dark:text-secondary-300 mb-1">Department</label>
              <Input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-secondary-700 dark:text-secondary-300 mb-1">Salary Currency *</label>
              <select
                className="w-full rounded-lg border border-secondary-300 dark:border-secondary-600 bg-white dark:bg-secondary-800 text-secondary-900 dark:text-secondary-100 px-3 py-2 text-sm"
                value={form.salaryCurrency}
                onChange={(e) => setForm({ ...form, salaryCurrency: e.target.value, salaryExchangeRate: e.target.value === "GHS" ? "" : form.salaryExchangeRate })}
              >
                {COMMON_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-secondary-700 dark:text-secondary-300 mb-1">
                Monthly Gross Salary ({form.salaryCurrency}) *
              </label>
              <Input type="number" min="0" step="0.01" value={form.grossSalary} onChange={(e) => setForm({ ...form, grossSalary: e.target.value })} required />
            </div>
          </div>
          {form.salaryCurrency !== "GHS" && (
            <div>
              <label className="block text-xs font-medium text-secondary-700 dark:text-secondary-300 mb-1">
                Exchange Rate (1 {form.salaryCurrency} = ? GHS) *
              </label>
              <Input
                type="number"
                min="0.000001"
                step="0.000001"
                placeholder="e.g. 15.5 for 1 USD = 15.5 GHS"
                value={form.salaryExchangeRate}
                onChange={(e) => setForm({ ...form, salaryExchangeRate: e.target.value })}
                required
              />
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-secondary-700 dark:text-secondary-300 mb-1">Date of Joining</label>
            <Input type="date" value={form.dateOfJoining} onChange={(e) => setForm({ ...form, dateOfJoining: e.target.value })} />
          </div>
          {editEmployee && (
            <label className="flex items-center gap-2 text-sm text-secondary-700 dark:text-secondary-300 cursor-pointer">
              <input
                type="checkbox"
                checked={editEmployee.isActive}
                onChange={(e) => setEditEmployee({ ...editEmployee, isActive: e.target.checked })}
                className="rounded"
              />
              Active employee
            </label>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setIsAddOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Saving…" : editEmployee ? "Update" : "Add Employee"}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
