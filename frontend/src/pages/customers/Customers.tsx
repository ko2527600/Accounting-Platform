import { useState, useEffect, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "../../components/ui/Table";
import { Modal } from "../../components/ui/Modal";
import { api } from "../../lib/api";
import { useToast } from "../../contexts/ToastContext";
import { Plus, Edit2, Trash2, X, Mail, Phone, MapPin, CreditCard, FileText } from "lucide-react";

interface Customer {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  address?: string | null;
  creditLimit?: number | null;
  tin?: string | null;
  customerType?: string | null;
}

interface Invoice {
  id: string;
  invoiceNumber: string;
  status: string;
  totalAmount: number;
  amountPaid: number;
  issueDate: string;
  dueDate?: string | null;
}

type TypeFilter = '' | 'RETAIL' | 'WHOLESALE';

const STATUS_BADGE: Record<string, string> = {
  DRAFT: "bg-secondary-100 text-secondary-600 dark:bg-secondary-800 dark:text-secondary-300",
  SENT: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  PARTIALLY_PAID: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  PAID: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  OVERDUE: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  VOID: "bg-secondary-100 text-secondary-400 dark:bg-secondary-800 dark:text-secondary-500",
};

function formatGHS(amount: number | null | undefined): string {
  if (amount == null) return "—";
  return `GHS ${Number(amount).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-GH", { year: "numeric", month: "short", day: "numeric" });
}

const UNPAID_STATUSES = new Set(["DRAFT", "SENT", "PARTIALLY_PAID", "OVERDUE"]);

export function Customers() {
  const { showToast } = useToast();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("");

  const [showModal, setShowModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerInvoices, setCustomerInvoices] = useState<Invoice[]>([]);
  const [isLoadingInvoices, setIsLoadingInvoices] = useState(false);

  // Form fields
  const [formName, setFormName] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formAddress, setFormAddress] = useState("");
  const [formCreditLimit, setFormCreditLimit] = useState("");
  const [formTin, setFormTin] = useState("");
  const [formType, setFormType] = useState<"RETAIL" | "WHOLESALE">("RETAIL");

  const loadCustomers = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await api.get<{ success: boolean; customers: Customer[] }>("/invoices/customers");
      setCustomers(res.data.customers ?? []);
    } catch {
      showToast("Failed to load customers", "error");
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  useEffect(() => { loadCustomers(); }, [loadCustomers]);

  useEffect(() => {
    if (!selectedCustomer) { setCustomerInvoices([]); return; }
    (async () => {
      try {
        setIsLoadingInvoices(true);
        const res = await api.get<{ success: boolean; invoices: Invoice[] }>(`/invoices?customerId=${selectedCustomer.id}`);
        const sorted = (res.data.invoices ?? [])
          .sort((a, b) => new Date(b.issueDate).getTime() - new Date(a.issueDate).getTime())
          .slice(0, 20);
        setCustomerInvoices(sorted);
      } catch {
        setCustomerInvoices([]);
      } finally {
        setIsLoadingInvoices(false);
      }
    })();
  }, [selectedCustomer]);

  const filteredCustomers = customers.filter(c => {
    const matchesSearch = !search ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.email && c.email.toLowerCase().includes(search.toLowerCase()));
    const matchesType = !typeFilter || c.customerType === typeFilter;
    return matchesSearch && matchesType;
  });

  function openAddModal() {
    setEditingCustomer(null);
    setFormName(""); setFormEmail(""); setFormPhone(""); setFormAddress("");
    setFormCreditLimit(""); setFormTin(""); setFormType("RETAIL");
    setShowModal(true);
  }

  function openEditModal(c: Customer) {
    setEditingCustomer(c);
    setFormName(c.name); setFormEmail(c.email); setFormPhone(c.phone ?? "");
    setFormAddress(c.address ?? ""); setFormCreditLimit(c.creditLimit != null ? String(c.creditLimit) : "");
    setFormTin(c.tin ?? ""); setFormType((c.customerType as "RETAIL" | "WHOLESALE") ?? "RETAIL");
    setShowModal(true);
  }

  async function handleSave() {
    if (!formName.trim() || !formEmail.trim()) {
      showToast("Name and email are required", "error"); return;
    }
    setIsSaving(true);
    const payload = {
      name: formName.trim(),
      email: formEmail.trim(),
      phone: formPhone.trim() || null,
      address: formAddress.trim() || null,
      creditLimit: formCreditLimit ? Number(formCreditLimit) : null,
      tin: formTin.trim() || null,
      customerType: formType,
    };
    try {
      if (editingCustomer) {
        await api.put(`/invoices/customers/${editingCustomer.id}`, payload);
        showToast("Customer updated", "success");
        if (selectedCustomer?.id === editingCustomer.id) {
          setSelectedCustomer({ ...editingCustomer, ...payload });
        }
      } else {
        await api.post("/invoices/customers", payload);
        showToast("Customer created", "success");
      }
      setShowModal(false);
      loadCustomers();
    } catch (err: any) {
      showToast(err.response?.data?.error ?? "Save failed", "error");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(c: Customer) {
    if (!confirm(`Delete ${c.name}? This cannot be undone.`)) return;
    try {
      await api.delete(`/invoices/customers/${c.id}`);
      showToast("Customer deleted", "success");
      if (selectedCustomer?.id === c.id) setSelectedCustomer(null);
      loadCustomers();
    } catch (err: any) {
      showToast(err.response?.data?.error ?? "Delete failed", "error");
    }
  }

  const outstanding = customerInvoices
    .filter(inv => UNPAID_STATUSES.has(inv.status))
    .reduce((sum, inv) => sum + (Number(inv.totalAmount) - Number(inv.amountPaid)), 0);

  return (
    <div className="flex gap-4 h-full">
      {/* Main list */}
      <div className={`flex flex-col gap-4 flex-1 min-w-0 transition-all`}>
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <CardTitle className="text-lg font-semibold text-secondary-900 dark:text-secondary-50">
                Customers
              </CardTitle>
              <Button onClick={openAddModal} size="sm" className="flex items-center gap-1.5">
                <Plus className="h-4 w-4" aria-hidden /> Add Customer
              </Button>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 mt-3">
              <Input
                placeholder="Search by name or email…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="flex-1"
              />
              <div className="flex gap-1.5">
                {(["", "RETAIL", "WHOLESALE"] as TypeFilter[]).map(t => (
                  <button
                    key={t || "all"}
                    onClick={() => setTypeFilter(t)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                      typeFilter === t
                        ? "bg-emerald-600 text-white border-emerald-600"
                        : "border-secondary-300 dark:border-secondary-600 text-secondary-600 dark:text-secondary-300 hover:bg-secondary-50 dark:hover:bg-secondary-800"
                    }`}
                  >
                    {t || "All"}
                  </button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="text-center py-12 text-secondary-400 text-sm">Loading customers…</div>
            ) : filteredCustomers.length === 0 ? (
              <div className="text-center py-12 text-secondary-400 text-sm">
                {search || typeFilter ? "No customers match your filter." : "No customers yet. Add your first customer."}
              </div>
            ) : (
              <div className="overflow-x-auto">
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
                    {filteredCustomers.map(c => (
                      <TableRow
                        key={c.id}
                        className="cursor-pointer hover:bg-secondary-50 dark:hover:bg-secondary-800/50"
                        onClick={() => setSelectedCustomer(c)}
                      >
                        <TableCell className="font-medium text-secondary-900 dark:text-secondary-100">
                          {c.name}
                        </TableCell>
                        <TableCell className="text-secondary-600 dark:text-secondary-400">{c.email}</TableCell>
                        <TableCell className="text-secondary-600 dark:text-secondary-400">{c.phone ?? "—"}</TableCell>
                        <TableCell>
                          {c.customerType === "WHOLESALE" ? (
                            <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">Wholesale</span>
                          ) : (
                            <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">Retail</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {c.creditLimit ? formatGHS(c.creditLimit) : <span className="text-secondary-400 dark:text-secondary-500 text-xs">No limit</span>}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1" onClick={e => e.stopPropagation()}>
                            <button
                              aria-label="Edit customer"
                              onClick={() => openEditModal(c)}
                              className="p-1.5 rounded hover:bg-secondary-100 dark:hover:bg-secondary-700 text-secondary-500 dark:text-secondary-400"
                            >
                              <Edit2 className="h-3.5 w-3.5" aria-hidden />
                            </button>
                            <button
                              aria-label="Delete customer"
                              onClick={() => handleDelete(c)}
                              className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/30 text-secondary-500 hover:text-red-600 dark:text-secondary-400 dark:hover:text-red-400"
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden />
                            </button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Detail drawer */}
      {selectedCustomer && (
        <div className="w-80 shrink-0 flex flex-col gap-3">
          <Card className="flex flex-col">
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-base font-semibold text-secondary-900 dark:text-secondary-100 leading-tight">
                    {selectedCustomer.name}
                  </CardTitle>
                  <div className="mt-1">
                    {selectedCustomer.customerType === "WHOLESALE" ? (
                      <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">Wholesale</span>
                    ) : (
                      <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">Retail</span>
                    )}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button
                    aria-label="Edit customer"
                    onClick={() => openEditModal(selectedCustomer)}
                    className="p-1.5 rounded hover:bg-secondary-100 dark:hover:bg-secondary-700 text-secondary-500"
                  >
                    <Edit2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                  <button
                    aria-label="Close detail panel"
                    onClick={() => setSelectedCustomer(null)}
                    className="p-1.5 rounded hover:bg-secondary-100 dark:hover:bg-secondary-700 text-secondary-500"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0 space-y-3">
              {/* Contact */}
              <div className="space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-secondary-400 dark:text-secondary-500">Contact</p>
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm text-secondary-700 dark:text-secondary-300">
                    <Mail className="h-3.5 w-3.5 text-secondary-400 shrink-0" aria-hidden />
                    <span className="truncate">{selectedCustomer.email}</span>
                  </div>
                  {selectedCustomer.phone && (
                    <div className="flex items-center gap-2 text-sm text-secondary-700 dark:text-secondary-300">
                      <Phone className="h-3.5 w-3.5 text-secondary-400 shrink-0" aria-hidden />
                      <span>{selectedCustomer.phone}</span>
                    </div>
                  )}
                  {selectedCustomer.address && (
                    <div className="flex items-start gap-2 text-sm text-secondary-700 dark:text-secondary-300">
                      <MapPin className="h-3.5 w-3.5 text-secondary-400 shrink-0 mt-0.5" aria-hidden />
                      <span>{selectedCustomer.address}</span>
                    </div>
                  )}
                  {selectedCustomer.tin && (
                    <div className="flex items-center gap-2 text-sm text-secondary-700 dark:text-secondary-300">
                      <FileText className="h-3.5 w-3.5 text-secondary-400 shrink-0" aria-hidden />
                      <span>TIN: {selectedCustomer.tin}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Credit */}
              <div className="space-y-1.5 border-t border-secondary-100 dark:border-secondary-700 pt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-secondary-400 dark:text-secondary-500">Credit</p>
                <div className="flex items-center gap-2 text-sm">
                  <CreditCard className="h-3.5 w-3.5 text-secondary-400" aria-hidden />
                  <span className="text-secondary-700 dark:text-secondary-300">
                    Limit: {selectedCustomer.creditLimit ? formatGHS(selectedCustomer.creditLimit) : "No limit"}
                  </span>
                </div>
                {!isLoadingInvoices && (
                  <div className="flex items-center gap-2 text-sm">
                    <CreditCard className="h-3.5 w-3.5 text-secondary-400" aria-hidden />
                    <span className={outstanding > 0 ? "text-red-600 dark:text-red-400 font-medium" : "text-secondary-700 dark:text-secondary-300"}>
                      Outstanding: {formatGHS(outstanding)}
                    </span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Invoice history */}
          <Card className="flex-1 min-h-0">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-secondary-700 dark:text-secondary-200">Invoice History</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {isLoadingInvoices ? (
                <div className="text-center py-6 text-secondary-400 text-xs">Loading…</div>
              ) : customerInvoices.length === 0 ? (
                <div className="text-center py-6 text-secondary-400 text-xs">No invoices found.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-secondary-100 dark:border-secondary-700">
                        <th className="text-left px-4 py-2 text-secondary-500 dark:text-secondary-400 font-medium">Date</th>
                        <th className="text-left px-4 py-2 text-secondary-500 dark:text-secondary-400 font-medium">Invoice #</th>
                        <th className="text-left px-4 py-2 text-secondary-500 dark:text-secondary-400 font-medium">Status</th>
                        <th className="text-right px-4 py-2 text-secondary-500 dark:text-secondary-400 font-medium">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customerInvoices.map(inv => (
                        <tr key={inv.id} className="border-b border-secondary-50 dark:border-secondary-800/50 hover:bg-secondary-50 dark:hover:bg-secondary-800/30">
                          <td className="px-4 py-2 text-secondary-600 dark:text-secondary-400">{formatDate(inv.issueDate)}</td>
                          <td className="px-4 py-2 font-mono text-secondary-700 dark:text-secondary-300">{inv.invoiceNumber}</td>
                          <td className="px-4 py-2">
                            <span className={`inline-flex px-1.5 py-0.5 text-xs font-medium rounded-full ${STATUS_BADGE[inv.status] ?? STATUS_BADGE.DRAFT}`}>
                              {inv.status.replace(/_/g, " ")}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-right font-variant-numeric tabular-nums text-secondary-700 dark:text-secondary-300">
                            {formatGHS(inv.totalAmount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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
            <div>
              <label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
                Company / Customer Name <span className="text-red-500">*</span>
              </label>
              <Input value={formName} onChange={e => setFormName(e.target.value)} placeholder="Acme Ltd" />
            </div>
            <div>
              <label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
                Email <span className="text-red-500">*</span>
              </label>
              <Input type="email" value={formEmail} onChange={e => setFormEmail(e.target.value)} placeholder="customer@example.com" />
            </div>
            <div>
              <label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">Phone</label>
              <Input value={formPhone} onChange={e => setFormPhone(e.target.value)} placeholder="+233 24 000 0000" />
            </div>
            <div>
              <label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">Address</label>
              <textarea
                value={formAddress}
                onChange={e => setFormAddress(e.target.value)}
                placeholder="123 High Street, Accra"
                rows={2}
                className="w-full rounded-md border border-secondary-300 dark:border-secondary-600 bg-white dark:bg-secondary-800 text-secondary-900 dark:text-secondary-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">Credit Limit (GHS)</label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={formCreditLimit}
                  onChange={e => setFormCreditLimit(e.target.value)}
                  placeholder="0 = no limit"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">GRA TIN</label>
                <Input value={formTin} onChange={e => setFormTin(e.target.value)} placeholder="C0000000000" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">Customer Type</label>
              <div className="flex gap-2">
                {(["RETAIL", "WHOLESALE"] as const).map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setFormType(t)}
                    className={`flex-1 py-1.5 text-sm font-medium rounded-md border transition-colors ${
                      formType === t
                        ? "bg-emerald-600 text-white border-emerald-600"
                        : "border-secondary-300 dark:border-secondary-600 text-secondary-600 dark:text-secondary-300 hover:bg-secondary-50 dark:hover:bg-secondary-800"
                    }`}
                  >
                    {t.charAt(0) + t.slice(1).toLowerCase()}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setShowModal(false)} disabled={isSaving}>Cancel</Button>
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
