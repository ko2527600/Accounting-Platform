import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Modal } from "../../components/ui/Modal";
import { api } from "../../lib/api";
import { useToast } from "../../contexts/ToastContext";
import { CalendarDays, Plus, Pencil, CheckCircle, XCircle, Ban } from "lucide-react";

interface Employee {
  id: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
}

interface LeaveType {
  id: string;
  name: string;
  isPaid: boolean;
  maxDaysPerYear: number | null;
  isActive: boolean;
}

interface LeaveRequest {
  id: string;
  employeeId: string;
  leaveTypeId: string;
  leaveTypeName?: string;
  isPaid?: boolean;
  startDate: string;
  endDate: string;
  daysRequested: number;
  reason: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  approvedBy: string | null;
}

const emptyTypeForm = { name: "", isPaid: true, maxDaysPerYear: "" };
const emptyRequestForm = {
  employeeId: "",
  leaveTypeId: "",
  startDate: new Date().toISOString().split("T")[0],
  endDate: new Date().toISOString().split("T")[0],
  daysRequested: "",
  reason: "",
};

const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  APPROVED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  REJECTED: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  CANCELLED: "bg-secondary-100 text-secondary-600 dark:bg-secondary-800 dark:text-secondary-400",
};

export function Leave() {
  const { showToast } = useToast();
  const [tab, setTab] = useState<"requests" | "types">("requests");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("PENDING");

  // Modals
  const [showTypeModal, setShowTypeModal] = useState(false);
  const [editType, setEditType] = useState<LeaveType | null>(null);
  const [typeForm, setTypeForm] = useState(emptyTypeForm);

  const [showRequestModal, setShowRequestModal] = useState(false);
  const [requestForm, setRequestForm] = useState(emptyRequestForm);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchAll = useCallback(async () => {
    setIsLoading(true);
    try {
      const [typesRes, requestsRes, empRes] = await Promise.all([
        api.get("/payroll/leave/types?activeOnly=false"),
        api.get(`/payroll/leave/requests${statusFilter !== "ALL" ? `?status=${statusFilter}` : ""}`),
        api.get("/payroll/employees?activeOnly=false"),
      ]);
      setLeaveTypes(typesRes.data.data.leaveTypes || []);
      setRequests(requestsRes.data.data.leaveRequests || []);
      setEmployees(empRes.data.data.employees || []);
    } catch {
      showToast("Failed to load leave data.", "error");
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter, showToast]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  function empName(id: string) {
    const e = employees.find((em) => em.id === id);
    return e ? `${e.firstName} ${e.lastName} (${e.employeeNumber})` : id;
  }

  // ── Leave Types ──────────────────────────────────────────────────────────

  function openAddType() {
    setTypeForm(emptyTypeForm);
    setEditType(null);
    setShowTypeModal(true);
  }

  function openEditType(lt: LeaveType) {
    setTypeForm({ name: lt.name, isPaid: lt.isPaid, maxDaysPerYear: lt.maxDaysPerYear != null ? String(lt.maxDaysPerYear) : "" });
    setEditType(lt);
    setShowTypeModal(true);
  }

  async function handleTypeSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const payload = {
        name: typeForm.name,
        isPaid: typeForm.isPaid,
        maxDaysPerYear: typeForm.maxDaysPerYear ? Number(typeForm.maxDaysPerYear) : null,
        ...(editType ? { isActive: editType.isActive } : {}),
      };
      if (editType) {
        await api.put(`/payroll/leave/types/${editType.id}`, payload);
        showToast("Leave type updated.", "success");
      } else {
        await api.post("/payroll/leave/types", payload);
        showToast("Leave type created.", "success");
      }
      setShowTypeModal(false);
      fetchAll();
    } catch (err: any) {
      showToast(err?.response?.data?.error || "Failed to save leave type.", "error");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function toggleTypeActive(lt: LeaveType) {
    try {
      await api.put(`/payroll/leave/types/${lt.id}`, { isActive: !lt.isActive });
      fetchAll();
    } catch {
      showToast("Failed to update leave type.", "error");
    }
  }

  // ── Leave Requests ───────────────────────────────────────────────────────

  async function handleRequestSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await api.post("/payroll/leave/requests", {
        ...requestForm,
        daysRequested: Number(requestForm.daysRequested),
        reason: requestForm.reason || null,
      });
      showToast("Leave request created.", "success");
      setShowRequestModal(false);
      fetchAll();
    } catch (err: any) {
      showToast(err?.response?.data?.error || "Failed to create leave request.", "error");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function setStatus(id: string, status: "APPROVED" | "REJECTED" | "CANCELLED") {
    try {
      await api.patch(`/payroll/leave/requests/${id}/status`, { status });
      fetchAll();
    } catch (err: any) {
      showToast(err?.response?.data?.error || "Failed to update status.", "error");
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <CalendarDays className="h-6 w-6 text-primary-600" />
          <div>
            <h1 className="text-xl font-bold text-secondary-900 dark:text-secondary-50">Leave Management</h1>
            <p className="text-xs text-secondary-500">Track leave requests; approved unpaid leave reduces payroll gross</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {tab === "requests" && (
            <Button onClick={() => { setRequestForm(emptyRequestForm); setShowRequestModal(true); }} size="sm">
              <Plus className="h-4 w-4 mr-1" /> New Request
            </Button>
          )}
          {tab === "types" && (
            <Button onClick={openAddType} size="sm">
              <Plus className="h-4 w-4 mr-1" /> New Type
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-secondary-200 dark:border-secondary-700">
        {(["requests", "types"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t
                ? "border-primary-600 text-primary-700 dark:text-primary-400"
                : "border-transparent text-secondary-500 hover:text-secondary-700 dark:hover:text-secondary-300"
            }`}
          >
            {t === "requests" ? "Leave Requests" : "Leave Types"}
          </button>
        ))}
      </div>

      {tab === "requests" && (
        <>
          {/* Status filter */}
          <div className="flex gap-2 flex-wrap">
            {["PENDING", "APPROVED", "REJECTED", "CANCELLED", "ALL"].map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  statusFilter === s
                    ? "bg-primary-600 text-white"
                    : "bg-secondary-100 text-secondary-600 dark:bg-secondary-800 dark:text-secondary-400 hover:bg-secondary-200 dark:hover:bg-secondary-700"
                }`}
              >
                {s}
              </button>
            ))}
          </div>

          <Card>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-8 text-center text-secondary-400 text-sm">Loading…</div>
              ) : requests.length === 0 ? (
                <div className="p-8 text-center text-secondary-400 text-sm">No leave requests found.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-secondary-200 dark:border-secondary-700 bg-secondary-50 dark:bg-secondary-800/50">
                        <th className="px-4 py-3 text-left font-semibold text-secondary-600 dark:text-secondary-400">Employee</th>
                        <th className="px-4 py-3 text-left font-semibold text-secondary-600 dark:text-secondary-400">Leave Type</th>
                        <th className="px-4 py-3 text-left font-semibold text-secondary-600 dark:text-secondary-400">Dates</th>
                        <th className="px-4 py-3 text-right font-semibold text-secondary-600 dark:text-secondary-400">Days</th>
                        <th className="px-4 py-3 text-left font-semibold text-secondary-600 dark:text-secondary-400">Status</th>
                        <th className="px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {requests.map((req) => (
                        <tr key={req.id} className="border-b border-secondary-100 dark:border-secondary-800 hover:bg-secondary-50 dark:hover:bg-secondary-800/30">
                          <td className="px-4 py-3 font-medium text-secondary-900 dark:text-secondary-100">{empName(req.employeeId)}</td>
                          <td className="px-4 py-3 text-secondary-600 dark:text-secondary-400">
                            {req.leaveTypeName}
                            {req.isPaid === false && (
                              <span className="ml-1 text-xs text-red-500 dark:text-red-400">(unpaid)</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-secondary-600 dark:text-secondary-400 text-xs">
                            {req.startDate} → {req.endDate}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-secondary-900 dark:text-secondary-100">{req.daysRequested}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[req.status] || ""}`}>
                              {req.status}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            {req.status === "PENDING" && (
                              <div className="flex gap-1">
                                <Button variant="ghost" size="sm" onClick={() => setStatus(req.id, "APPROVED")} title="Approve">
                                  <CheckCircle className="h-3.5 w-3.5 text-emerald-600" />
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => setStatus(req.id, "REJECTED")} title="Reject">
                                  <XCircle className="h-3.5 w-3.5 text-red-500" />
                                </Button>
                              </div>
                            )}
                            {req.status === "APPROVED" && (
                              <Button variant="ghost" size="sm" onClick={() => setStatus(req.id, "CANCELLED")} title="Cancel">
                                <Ban className="h-3.5 w-3.5 text-secondary-400" />
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {tab === "types" && (
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 text-center text-secondary-400 text-sm">Loading…</div>
            ) : leaveTypes.length === 0 ? (
              <div className="p-8 text-center text-secondary-400 text-sm">No leave types found.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-secondary-200 dark:border-secondary-700 bg-secondary-50 dark:bg-secondary-800/50">
                      <th className="px-4 py-3 text-left font-semibold text-secondary-600 dark:text-secondary-400">Name</th>
                      <th className="px-4 py-3 text-left font-semibold text-secondary-600 dark:text-secondary-400">Paid?</th>
                      <th className="px-4 py-3 text-right font-semibold text-secondary-600 dark:text-secondary-400">Max Days/Year</th>
                      <th className="px-4 py-3 text-left font-semibold text-secondary-600 dark:text-secondary-400">Status</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {leaveTypes.map((lt) => (
                      <tr key={lt.id} className="border-b border-secondary-100 dark:border-secondary-800 hover:bg-secondary-50 dark:hover:bg-secondary-800/30">
                        <td className="px-4 py-3 font-medium text-secondary-900 dark:text-secondary-100">{lt.name}</td>
                        <td className="px-4 py-3 text-secondary-600 dark:text-secondary-400">{lt.isPaid ? "Yes" : "No (deducted)"}</td>
                        <td className="px-4 py-3 text-right font-mono text-secondary-900 dark:text-secondary-100">{lt.maxDaysPerYear ?? "—"}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            lt.isActive
                              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400"
                              : "bg-secondary-100 text-secondary-600 dark:bg-secondary-800 dark:text-secondary-400"
                          }`}>
                            {lt.isActive ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1">
                            <Button variant="ghost" size="sm" onClick={() => openEditType(lt)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => toggleTypeActive(lt)} title={lt.isActive ? "Deactivate" : "Activate"}>
                              {lt.isActive ? <Ban className="h-3.5 w-3.5 text-secondary-400" /> : <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Leave Type Modal */}
      <Modal isOpen={showTypeModal} onClose={() => setShowTypeModal(false)} title={editType ? "Edit Leave Type" : "New Leave Type"}>
        <form onSubmit={handleTypeSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-secondary-700 dark:text-secondary-300 mb-1">Name *</label>
            <Input value={typeForm.name} onChange={(e) => setTypeForm({ ...typeForm, name: e.target.value })} required />
          </div>
          <label className="flex items-center gap-2 text-sm text-secondary-700 dark:text-secondary-300 cursor-pointer">
            <input type="checkbox" checked={typeForm.isPaid} onChange={(e) => setTypeForm({ ...typeForm, isPaid: e.target.checked })} className="rounded" />
            Paid leave (employees are paid for these days)
          </label>
          <div>
            <label className="block text-xs font-medium text-secondary-700 dark:text-secondary-300 mb-1">Max Days Per Year (leave blank for unlimited)</label>
            <Input type="number" min="1" value={typeForm.maxDaysPerYear} onChange={(e) => setTypeForm({ ...typeForm, maxDaysPerYear: e.target.value })} />
          </div>
          {editType && (
            <label className="flex items-center gap-2 text-sm text-secondary-700 dark:text-secondary-300 cursor-pointer">
              <input type="checkbox" checked={editType.isActive} onChange={(e) => setEditType({ ...editType, isActive: e.target.checked })} className="rounded" />
              Active
            </label>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setShowTypeModal(false)}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Saving…" : editType ? "Update" : "Create"}</Button>
          </div>
        </form>
      </Modal>

      {/* Leave Request Modal */}
      <Modal isOpen={showRequestModal} onClose={() => setShowRequestModal(false)} title="New Leave Request">
        <form onSubmit={handleRequestSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-secondary-700 dark:text-secondary-300 mb-1">Employee *</label>
            <select
              className="w-full rounded-lg border border-secondary-300 dark:border-secondary-600 bg-white dark:bg-secondary-800 text-secondary-900 dark:text-secondary-100 px-3 py-2 text-sm"
              value={requestForm.employeeId}
              onChange={(e) => setRequestForm({ ...requestForm, employeeId: e.target.value })}
              required
            >
              <option value="">Select employee…</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>{emp.firstName} {emp.lastName} ({emp.employeeNumber})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-secondary-700 dark:text-secondary-300 mb-1">Leave Type *</label>
            <select
              className="w-full rounded-lg border border-secondary-300 dark:border-secondary-600 bg-white dark:bg-secondary-800 text-secondary-900 dark:text-secondary-100 px-3 py-2 text-sm"
              value={requestForm.leaveTypeId}
              onChange={(e) => setRequestForm({ ...requestForm, leaveTypeId: e.target.value })}
              required
            >
              <option value="">Select leave type…</option>
              {leaveTypes.filter((lt) => lt.isActive).map((lt) => (
                <option key={lt.id} value={lt.id}>{lt.name}{!lt.isPaid ? " (unpaid)" : ""}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-secondary-700 dark:text-secondary-300 mb-1">Start Date *</label>
              <Input type="date" value={requestForm.startDate} onChange={(e) => setRequestForm({ ...requestForm, startDate: e.target.value })} required />
            </div>
            <div>
              <label className="block text-xs font-medium text-secondary-700 dark:text-secondary-300 mb-1">End Date *</label>
              <Input type="date" value={requestForm.endDate} onChange={(e) => setRequestForm({ ...requestForm, endDate: e.target.value })} required />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-secondary-700 dark:text-secondary-300 mb-1">Days Requested *</label>
            <Input type="number" min="0.5" step="0.5" value={requestForm.daysRequested} onChange={(e) => setRequestForm({ ...requestForm, daysRequested: e.target.value })} required />
          </div>
          <div>
            <label className="block text-xs font-medium text-secondary-700 dark:text-secondary-300 mb-1">Reason</label>
            <Input value={requestForm.reason} onChange={(e) => setRequestForm({ ...requestForm, reason: e.target.value })} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setShowRequestModal(false)}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Saving…" : "Create Request"}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
