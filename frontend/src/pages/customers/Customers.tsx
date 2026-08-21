import { useState, useEffect, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Modal } from "../../components/ui/Modal";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "../../components/ui/Table";
import { api } from "../../lib/api";
import { useToast } from "../../contexts/ToastContext";
import { useAuth } from "../../contexts/AuthContext";
import { cn } from "../../lib/utils";
import {
  Plus, Edit2, Trash2, X, Users, Phone, Mail, MapPin,
  CreditCard, FileText, ChevronRight, Loader2,
} from "lucide-react";

interface Customer {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  address?: string | null;
  creditLimit?: number | null;
  tin?: string | null;
  customerType: string;
  createdAt: string;
}

interface Invoice {
  id: string;
  invoiceNumber?: string;
  status: string;
  totalAmount: number;
  dueDate?: string | null;
  createdAt: string;
}

const STATUS_BADGE: Record<string, string> = {
  DRAFT: "bg-secondary-100 text-secondary-600 dark:bg-secondary-800 dark:text-secondary-400",
  SENT: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400",
  PARTIALLY_PAID: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
  PAID: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
  OVERDUE: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
  VOIDED: "bg-secondary-100 text-secondary-500 dark:bg-secondary-800 dark:text-secondary-500",
};

const RESTRICTED_WRITE_ROLES = new Set(["viewer", "auditor", "hr", "cashier", "warehouse manager"]);

const emptyForm = {
  name: "",
  email: "",
  phone: "",
  address: "",
  creditLimit: "",
  tin: "",
  customerType: "RETAIL" as "RETAIL" | "WHOLESALE",
};

export function Customers() {
  const { addToast } = useToast();
  const { user } = useAuth();
  const canWrite = !RESTRICTED_WRITE_ROLES.has((user?.role ?? "").toLowerCase());

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"" | "RETAIL" | "WHOLESALE">("");

  const [showModal, setShowModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [isSaving, setIsSaving] = useState(false);

  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerInvoices, setCustomerInvoices] = useState<Invoice[]>([]);
  const [isLoadingInvoices, setIsLoadingInvoices] = useState(false);

  const loadCustomers = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await api.get("/invoices/customers");
      setCustomers(res.data.data.customers ?? []);
    } catch {
      addToast("Failed to load customers.", "error");
    } finally {
      setIsLoading(false);
    }
  }, [addToast]);

  useEffect(() => { loadCustomers(); }, [loadCustomers]);

  useEffect(() => {
    if (!selectedCustomer) { setCustomerInvoices([]); return; }
    setIsLoadingInvoices(true);
    api.get("/invoices")
      .then((res) => {
        const all: any[] = res.data.data?.invoices ?? [];
        setCustomerInvoices(
          all
            .filter((inv) => inv.customerId === selectedCustomer.id)
            .slice(0, 20)
        );
      })
      .catch(() => setCustomerInvoices([]))
      .finally(() => setIsLoadingInvoices(false));
  }, [selectedCustomer]);

  const filtered = customers.filter((c) => {
    const matchesSearch =
      !search ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.email.toLowerCase().includes(search.toLowerCase());
    const matchesType = !typeFilter || c.customerType === typeFilter;
    return matchesSearch && matchesType;
  });

  function openAdd() {
    setEditingCustomer(null);
    setForm({ ...emptyForm });
    setShowModal(true);
  }

  function openEdit(c: Customer) {
    setEditingCustomer(c);
    setForm({
      name: c.name,
      email: c.email,
      phone: c.phone ?? "",
      address: c.address ?? "",
      creditLimit: c.creditLimit != null ? String(c.creditLimit) : "",
      tin: c.tin ?? "",
      customerType: c.customerType === "WHOLESALE" ? "WHOLESALE" : "RETAIL",
    });
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.name.trim() || !form.email.trim()) {
      addToast("Name and email are required.", "error");
      return;
    }
    const payload: Record<string, any> = {
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim() || null,
      address: form.address.trim() || null,
      creditLimit: form.creditLimit !== "" ? parseFloat(form.creditLimit) : null,
      tin: form.tin.trim() || null,
      customerType: form.customerType,
    };
    try {
      setIsSaving(true);
      if (editingCustomer) {
        await api.put(`/invoices/customers/${editingCustomer.id}`, payload);
        addToast("Customer updated.", "success");
      } else {
        await api.post("/invoices/customers", payload);
        addToast("Customer created.", "success");
      }
      setShowModal(false);
      loadCustomers();
      if (selectedCustomer?.id === editingCustomer?.id) setSelectedCustomer(null);
    } catch (err: any) {
      addToast(err?.response?.data?.error ?? "Failed to save customer.", "error");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(c: Customer) {
    if (!window.confirm(`Delete customer "${c.name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/invoices/customers/${c.id}`);
      addToast("Customer deleted.", "success");
      if (selectedCustomer?.id === c.id) setSelectedCustomer(null);
      loadCustomers();
    } catch (err: any) {
      addToast(err?.response?.data?.error ?? "Failed to delete customer.", "error");
    }
  }

  const outstandingTotal = customerInvoices
    .filter((inv) => ["DRAFT", "SENT", "PARTIALLY_PAID", "OVERDUE"].includes(inv.status))
    .reduce((sum, inv) => sum + (inv.totalAmount ?? 0), 0);

  return (
    <div className="flex h-full gap-4 p-6">
      {/* Main list */}
      <div className={cn("flex flex-col gap-4 transition-all duration-200", selectedCustomer ? "flex-1 min-w-0" : "w-full")}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-secondary-900 dark:text-secondary-50">Customers</h1>
            <p className="text-sm text-secondary-500 dark:text-secondary-400 mt-0.5">
              {customers.length} customer{customers.length !== 1 ? "s" : ""}
            </p>
          </div>
          {canWrite && (
            <Button onClick={openAdd} className="flex items-center gap-2">
              <Plus className="h-4 w-4" /> Add Customer
            </Button>
          )}
        </div>

        {/* Filters */}
        <div className="flex gap-3 flex-wrap">
          <Input
            placeholder="Search by name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
          <div className="flex gap-1">
            {(["", "RETAIL", "WHOLESALE"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium rounded-full transition-colors",
                  typeFilter === t
                    ? "bg-primary-600 text-white"
                    : "bg-secondary-100 text-secondary-600 hover:bg-secondary-200 dark:bg-secondary-800 dark:text-secondary-400 dark:hover:bg-secondary-700"
                )}
              >
                {t === "" ? "All" : t === "RETAIL" ? "Retail" : "Wholesale"}
              </button>
            ))}
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-16 text-secondary-400">
                <Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading customers…
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-secondary-400">
                <Users className="h-10 w-10" />
                <p className="text-sm">{customers.length === 0 ? "No customers yet." : "No customers match your filter."}</p>
                {canWrite && customers.length === 0 && (
                  <Button variant="outline" onClick={openAdd} className="flex items-center gap-2">
                    <Plus className="h-4 w-4" /> Add your first customer
                  </Button>
                )}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Credit Limit</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((c) => (
                    <TableRow
                      key={c.id}
                      onClick={() => setSelectedCustomer(selectedCustomer?.id === c.id ? null : c)}
                      className={cn(
                        "cursor-pointer transition-colors",
                        selectedCustomer?.id === c.id && "bg-primary-50 dark:bg-primary-900/20"
                      )}
                    >
                      <TableCell className="font-medium text-secondary-900 dark:text-secondary-50">
                        <div className="flex items-center gap-2">
                          {c.name}
                          {selectedCustomer?.id === c.id && (
                            <ChevronRight className="h-3.5 w-3.5 text-primary-500 flex-shrink-0" />
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-secondary-600 dark:text-secondary-400 text-sm">{c.email}</TableCell>
                      <TableCell className="text-secondary-500 dark:text-secondary-500 text-sm">{c.phone ?? "—"}</TableCell>
                      <TableCell>
                        <span className={cn(
                          "inline-block text-[11px] font-semibold rounded-full px-2 py-0.5",
                          c.customerType === "WHOLESALE"
                            ? "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400"
                            : "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400"
                        )}>
                          {c.customerType === "WHOLESALE" ? "Wholesale" : "Retail"}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-secondary-600 dark:text-secondary-400 font-variant-numeric tabular-nums">
                        {c.creditLimit != null ? `GHS ${Number(c.creditLimit).toLocaleString("en-GH", { minimumFractionDigits: 2 })}` : "No limit"}
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          {canWrite && (
                            <>
                              <button
                                onClick={() => openEdit(c)}
                                className="p-1.5 rounded text-secondary-400 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/30 transition-colors"
                                title="Edit"
                              >
                                <Edit2 className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => handleDelete(c)}
                                className="p-1.5 rounded text-secondary-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
                                title="Delete"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Detail drawer */}
      {selectedCustomer && (
        <div className="w-80 flex-shrink-0 flex flex-col gap-4 animate-in slide-in-from-right-4 duration-200">
          {/* Header card */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <CardTitle className="text-base leading-tight truncate">{selectedCustomer.name}</CardTitle>
                  <span className={cn(
                    "inline-block mt-1 text-[11px] font-semibold rounded-full px-2 py-0.5",
                    selectedCustomer.customerType === "WHOLESALE"
                      ? "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400"
                      : "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400"
                  )}>
                    {selectedCustomer.customerType === "WHOLESALE" ? "Wholesale" : "Retail"}
                  </span>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {canWrite && (
                    <button
                      onClick={() => openEdit(selectedCustomer)}
                      className="p-1.5 rounded text-secondary-400 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/30 transition-colors"
                      title="Edit customer"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button
                    onClick={() => setSelectedCustomer(null)}
                    className="p-1.5 rounded text-secondary-400 hover:text-secondary-700 hover:bg-secondary-100 dark:hover:bg-secondary-800 transition-colors"
                    title="Close"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0 space-y-2">
              <div className="flex items-center gap-2 text-sm text-secondary-600 dark:text-secondary-400">
                <Mail className="h-3.5 w-3.5 flex-shrink-0 text-secondary-400" />
                <span className="truncate">{selectedCustomer.email}</span>
              </div>
              {selectedCustomer.phone && (
                <div className="flex items-center gap-2 text-sm text-secondary-600 dark:text-secondary-400">
                  <Phone className="h-3.5 w-3.5 flex-shrink-0 text-secondary-400" />
                  <span>{selectedCustomer.phone}</span>
                </div>
              )}
              {selectedCustomer.address && (
                <div className="flex items-start gap-2 text-sm text-secondary-600 dark:text-secondary-400">
                  <MapPin className="h-3.5 w-3.5 flex-shrink-0 text-secondary-400 mt-0.5" />
                  <span className="leading-snug">{selectedCustomer.address}</span>
                </div>
              )}
              {selectedCustomer.tin && (
                <div className="flex items-center gap-2 text-sm text-secondary-600 dark:text-secondary-400">
                  <FileText className="h-3.5 w-3.5 flex-shrink-0 text-secondary-400" />
                  <span>TIN: {selectedCustomer.tin}</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Credit card */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-secondary-400" />
                Credit
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-secondary-500 dark:text-secondary-400">Credit limit</span>
                <span className="font-medium text-secondary-900 dark:text-secondary-50 tabular-nums">
                  {selectedCustomer.creditLimit != null
                    ? `GHS ${Number(selectedCustomer.creditLimit).toLocaleString("en-GH", { minimumFractionDigits: 2 })}`
                    : "No limit"}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-secondary-500 dark:text-secondary-400">Outstanding</span>
                <span className={cn(
                  "font-semibold tabular-nums",
                  outstandingTotal > 0 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"
                )}>
                  GHS {outstandingTotal.toLocaleString("en-GH", { minimumFractionDigits: 2 })}
                </span>
              </div>
              {selectedCustomer.creditLimit != null && outstandingTotal > 0 && (
                <div className="mt-2">
                  <div className="h-1.5 rounded-full bg-secondary-100 dark:bg-secondary-800 overflow-hidden">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all",
                        outstandingTotal >= selectedCustomer.creditLimit ? "bg-red-500" : "bg-amber-400"
                      )}
                      style={{ width: `${Math.min(100, (outstandingTotal / selectedCustomer.creditLimit) * 100)}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-secondary-400 mt-1 text-right">
                    {Math.round((outstandingTotal / selectedCustomer.creditLimit) * 100)}% of limit used
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Invoice history */}
          <Card className="flex-1 min-h-0 flex flex-col">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <FileText className="h-4 w-4 text-secondary-400" />
                Invoice History
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 flex-1 min-h-0 overflow-y-auto">
              {isLoadingInvoices ? (
                <div className="flex items-center justify-center py-6 text-secondary-400">
                  <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading…
                </div>
              ) : customerInvoices.length === 0 ? (
                <p className="text-sm text-secondary-400 py-4 text-center">No invoices found.</p>
              ) : (
                <div className="space-y-2">
                  {customerInvoices.map((inv) => (
                    <div
                      key={inv.id}
                      className="flex items-center justify-between gap-2 py-2 border-b border-secondary-100 dark:border-secondary-800 last:border-0"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-secondary-900 dark:text-secondary-50 truncate">
                          {inv.invoiceNumber ?? inv.id.slice(0, 8)}
                        </p>
                        <p className="text-[10px] text-secondary-400 mt-0.5">
                          {new Date(inv.createdAt).toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" })}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        <span className={cn(
                          "text-[10px] font-semibold rounded-full px-1.5 py-0.5",
                          STATUS_BADGE[inv.status] ?? STATUS_BADGE.DRAFT
                        )}>
                          {inv.status}
                        </span>
                        <span className="text-xs font-medium text-secondary-900 dark:text-secondary-50 tabular-nums">
                          GHS {Number(inv.totalAmount ?? 0).toLocaleString("en-GH", { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Add/Edit modal */}
      {showModal && (
        <Modal
          isOpen={showModal}
          onClose={() => setShowModal(false)}
          title={editingCustomer ? "Edit Customer" : "Add Customer"}
        >
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-secondary-700 dark:text-secondary-300 mb-1">
                  Customer / Company Name <span className="text-red-500">*</span>
                </label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Mensah Traders Ltd"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-secondary-700 dark:text-secondary-300 mb-1">
                  Email <span className="text-red-500">*</span>
                </label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="customer@example.com"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-secondary-700 dark:text-secondary-300 mb-1">
                  Phone
                </label>
                <Input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="+233 24 000 0000"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-secondary-700 dark:text-secondary-300 mb-1">
                  Address
                </label>
                <Input
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  placeholder="Street, City, Region"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-secondary-700 dark:text-secondary-300 mb-1">
                  Credit Limit (GHS)
                </label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.creditLimit}
                  onChange={(e) => setForm({ ...form, creditLimit: e.target.value })}
                  placeholder="Leave blank for no limit"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-secondary-700 dark:text-secondary-300 mb-1">
                  GRA TIN
                </label>
                <Input
                  value={form.tin}
                  onChange={(e) => setForm({ ...form, tin: e.target.value })}
                  placeholder="C0000000000"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-secondary-700 dark:text-secondary-300 mb-2">
                  Customer Type
                </label>
                <div className="flex gap-2">
                  {(["RETAIL", "WHOLESALE"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setForm({ ...form, customerType: t })}
                      className={cn(
                        "flex-1 py-2 text-xs font-semibold rounded-lg border transition-colors",
                        form.customerType === t
                          ? t === "WHOLESALE"
                            ? "bg-purple-600 border-purple-600 text-white"
                            : "bg-primary-600 border-primary-600 text-white"
                          : "border-secondary-200 text-secondary-600 hover:bg-secondary-50 dark:border-secondary-700 dark:text-secondary-400 dark:hover:bg-secondary-800"
                      )}
                    >
                      {t === "RETAIL" ? "Retail" : "Wholesale"}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setShowModal(false)} disabled={isSaving}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={isSaving}>
                {isSaving ? "Saving…" : editingCustomer ? "Save Changes" : "Add Customer"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
