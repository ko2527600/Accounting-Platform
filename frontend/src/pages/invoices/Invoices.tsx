import { useState, useEffect, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "../../components/ui/Table";
import { Modal } from "../../components/ui/Modal";
import { api } from "../../lib/api";
import { useToast } from "../../contexts/ToastContext";
import { Plus, CheckCircle, UserPlus, DollarSign, Clock, Undo2, Smartphone, RefreshCw } from "lucide-react";

interface Customer {
  id: string;
  name: string;
  email: string;
  phone?: string;
}

interface TaxRate {
  id: string;
  name: string;
  code: string;
  rate: string;
}

interface InvoiceItem {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

interface TaxBreakdownLine {
  name: string;
  rate: number;
  amount: number;
}

interface Invoice {
  id: string;
  invoiceNumber: string;
  customer: Customer;
  issueDate: string;
  dueDate: string;
  currency: string;
  subtotal: number;
  tax: number;
  taxBreakdown: TaxBreakdownLine[] | null;
  total: number;
  status: string;
}

interface CreditNote {
  id: string;
  creditNoteNumber: string;
  amount: number;
  reason: string;
  method: "INVOICE_REDUCTION" | "JOURNAL_REVERSAL";
  issueDate: string;
}

interface MomoRequest {
  id: string;
  referenceId: string;
  phoneNumber: string;
  amount: number;
  status: "PENDING" | "SUCCESSFUL" | "FAILED";
  failureReason: string | null;
  createdAt: string;
}

export function Invoices() {
  const { showToast } = useToast();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [taxRates, setTaxRates] = useState<TaxRate[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Modals
  const [isInvoiceOpen, setIsInvoiceOpen] = useState(false);
  const [isCustomerOpen, setIsCustomerOpen] = useState(false);

  // Customer Form
  const [custName, setCustName] = useState("");
  const [custEmail, setCustEmail] = useState("");

  // Invoice Form
  const [selectedCustomer, setSelectedCustomer] = useState("");
  const [selectedTaxRateId, setSelectedTaxRateId] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [items, setItems] = useState<InvoiceItem[]>([
    { description: "Software Consulting", quantity: 10, unitPrice: 150, amount: 1500 },
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Credit Note modal
  const [creditNoteInvoice, setCreditNoteInvoice] = useState<Invoice | null>(null);
  const [creditNotesHistory, setCreditNotesHistory] = useState<CreditNote[]>([]);
  const [creditAmount, setCreditAmount] = useState("");
  const [creditReason, setCreditReason] = useState("");
  const [isIssuingCredit, setIsIssuingCredit] = useState(false);

  // Mobile Money (MTN MoMo) collection modal
  const [momoInvoice, setMomoInvoice] = useState<Invoice | null>(null);
  const [momoRequests, setMomoRequests] = useState<MomoRequest[]>([]);
  const [momoPhone, setMomoPhone] = useState("");
  const [isSendingMomo, setIsSendingMomo] = useState(false);
  const [checkingReferenceId, setCheckingReferenceId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [invRes, custRes, taxRes] = await Promise.all([
        api.get("/invoices"),
        api.get("/invoices/customers"),
        api.get("/tax-rates"),
      ]);

      if (invRes.data.success) setInvoices(invRes.data.data.invoices);
      if (custRes.data.success) setCustomers(custRes.data.data.customers);
      if (taxRes.data.success) setTaxRates(taxRes.data.data.taxRates.filter((t: any) => t.isActive));
    } catch (err) {
      console.error("Failed to load invoice data:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleAddCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await api.post("/invoices/customers", { name: custName, email: custEmail });
      if (res.data.success) {
        setCustName("");
        setCustEmail("");
        setIsCustomerOpen(false);
        fetchData();
      }
    } catch (err: any) {
      showToast(err.response?.data?.error || "Failed to add customer.", "error");
    }
  };

  const handleCreateInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomer) {
      showToast("Please select or add a customer first.", "error");
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await api.post("/invoices", {
        customerId: selectedCustomer,
        currency,
        items,
        ...(selectedTaxRateId ? { taxRateId: selectedTaxRateId } : {}),
      });

      if (res.data.success) {
        setIsInvoiceOpen(false);
        fetchData();
      }
    } catch (err: any) {
      showToast(err.response?.data?.error || "Failed to create invoice.", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePayInvoice = async (id: string) => {
    try {
      const res = await api.post(`/invoices/${id}/pay`);
      if (res.data.success) {
        fetchData();
      }
    } catch (err: any) {
      showToast(err.response?.data?.error || "Payment recording failed.", "error");
    }
  };

  const openCreditNoteModal = async (invoice: Invoice) => {
    setCreditNoteInvoice(invoice);
    setCreditAmount("");
    setCreditReason("");
    setCreditNotesHistory([]);
    try {
      const res = await api.get(`/invoices/${invoice.id}/credit-notes`);
      if (res.data.success) setCreditNotesHistory(res.data.data.creditNotes);
    } catch (err) {
      console.error("Failed to load credit note history:", err);
    }
  };

  const handleIssueCreditNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!creditNoteInvoice) return;
    setIsIssuingCredit(true);
    try {
      const res = await api.post(`/invoices/${creditNoteInvoice.id}/credit-notes`, {
        amount: Number(creditAmount),
        reason: creditReason,
      });
      if (res.data.success) {
        showToast(`Credit note ${res.data.data.creditNote.creditNoteNumber} issued.`, "success");
        setCreditNoteInvoice(null);
        fetchData();
      }
    } catch (err: any) {
      showToast(err.response?.data?.error || "Failed to issue credit note.", "error");
    } finally {
      setIsIssuingCredit(false);
    }
  };

  const openMomoModal = async (invoice: Invoice) => {
    setMomoInvoice(invoice);
    setMomoPhone("");
    setMomoRequests([]);
    try {
      const res = await api.get(`/momo/invoices/${invoice.id}/requests`);
      if (res.data.success) setMomoRequests(res.data.data.requests);
    } catch (err) {
      console.error("Failed to load Mobile Money request history:", err);
    }
  };

  const handleSendMomoRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!momoInvoice) return;
    setIsSendingMomo(true);
    try {
      const res = await api.post(`/momo/invoices/${momoInvoice.id}/request`, { phoneNumber: momoPhone });
      if (res.data.success) {
        showToast("MTN MoMo payment request sent. The customer must approve it on their phone.", "success");
        setMomoRequests((prev) => [res.data.data.request, ...prev]);
        setMomoPhone("");
      }
    } catch (err: any) {
      showToast(err.response?.data?.error || "Failed to send Mobile Money payment request.", "error");
    } finally {
      setIsSendingMomo(false);
    }
  };

  const handleCheckMomoStatus = async (referenceId: string) => {
    setCheckingReferenceId(referenceId);
    try {
      const res = await api.post(`/momo/requests/${referenceId}/check-status`);
      if (res.data.success) {
        setMomoRequests((prev) => prev.map((r) => (r.referenceId === referenceId ? res.data.data.request : r)));
        if (res.data.data.request.status === "SUCCESSFUL") {
          showToast("Payment confirmed - invoice marked PAID.", "success");
          setMomoInvoice(null);
          fetchData();
        } else if (res.data.data.request.status === "FAILED") {
          showToast("Payment was not successful. See the reason below.", "error");
        } else {
          showToast("Still pending - the customer hasn't approved the prompt yet.", "info");
        }
      }
    } catch (err: any) {
      showToast(err.response?.data?.error || "Failed to check Mobile Money payment status.", "error");
    } finally {
      setCheckingReferenceId(null);
    }
  };

  const formatCurrency = (amt: number, curr = "USD") => {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: curr }).format(amt);
  };

  const totalAR = invoices.reduce((acc, inv) => acc + (inv.status !== "PAID" ? Number(inv.total) : 0), 0);
  const totalPaid = invoices.reduce((acc, inv) => acc + (inv.status === "PAID" ? Number(inv.total) : 0), 0);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-secondary-900 dark:text-secondary-50">
            Invoicing & Accounts Receivable (AR)
          </h2>
          <p className="text-secondary-500 dark:text-secondary-400 mt-1">
            Create multi-item invoices, manage customer balances, and auto-post AR ledger payments.
          </p>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setIsCustomerOpen(true)} className="flex items-center">
            <UserPlus className="mr-2 h-4 w-4" />
            Add Customer
          </Button>
          <Button variant="primary" onClick={() => setIsInvoiceOpen(true)} className="flex items-center">
            <Plus className="mr-2 h-4 w-4" />
            Create Invoice
          </Button>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid gap-6 md:grid-cols-3">
        <Card className="border-amber-100 dark:border-amber-950">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-semibold text-secondary-600 dark:text-secondary-400">Total Outstanding AR</CardTitle>
            <Clock className="h-5 w-5 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">{formatCurrency(totalAR)}</div>
          </CardContent>
        </Card>

        <Card className="border-emerald-100 dark:border-emerald-950">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-semibold text-secondary-600 dark:text-secondary-400">Total Collected Payments</CardTitle>
            <DollarSign className="h-5 w-5 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(totalPaid)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-semibold text-secondary-600 dark:text-secondary-400">Total Active Customers</CardTitle>
            <UserPlus className="h-5 w-5 text-primary-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-secondary-900 dark:text-secondary-50">{customers.length}</div>
          </CardContent>
        </Card>
      </div>

      {/* Invoices List */}
      <Card>
        <CardHeader>
          <CardTitle>Invoices ({invoices.length})</CardTitle>
          <CardDescription>View, issue, and collect customer payments.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-8 text-center text-secondary-500">Loading invoices...</div>
          ) : invoices.length === 0 ? (
            <div className="py-8 text-center text-secondary-500 text-sm">
              No invoices created yet. Click "Create Invoice" to issue your first invoice.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Issue Date</TableHead>
                  <TableHead>Tax</TableHead>
                  <TableHead>Total Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="font-mono font-medium text-primary-600 dark:text-primary-400">
                      {inv.invoiceNumber}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-secondary-900 dark:text-secondary-50">{inv.customer?.name}</div>
                      <div className="text-xs text-secondary-500">{inv.customer?.email}</div>
                    </TableCell>
                    <TableCell className="text-xs text-secondary-500">
                      {new Date(inv.issueDate).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <div className="text-secondary-900 dark:text-secondary-50">{formatCurrency(Number(inv.tax), inv.currency)}</div>
                      {inv.taxBreakdown && inv.taxBreakdown.length > 0 && (
                        <div className="text-xs text-secondary-500 mt-0.5">
                          {inv.taxBreakdown.map((c) => `${c.name} ${(c.rate * 100).toFixed(1)}%`).join(" + ")}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="font-bold text-secondary-900 dark:text-secondary-50">
                      {formatCurrency(Number(inv.total), inv.currency)}
                    </TableCell>
                    <TableCell>
                      {inv.status === "PAID" ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">
                          <CheckCircle className="mr-1 h-3 w-3" /> Paid
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
                          Pending Payment
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      {inv.status !== "PAID" && (
                        <Button variant="outline" size="sm" onClick={() => handlePayInvoice(inv.id)} className="text-xs">
                          Record Payment
                        </Button>
                      )}
                      {inv.status !== "PAID" && inv.status !== "DRAFT" && (
                        <Button variant="outline" size="sm" onClick={() => openMomoModal(inv)} className="text-xs">
                          <Smartphone className="mr-1 h-3 w-3" />
                          Collect via MoMo
                        </Button>
                      )}
                      {inv.status !== "DRAFT" && (
                        <Button variant="outline" size="sm" onClick={() => openCreditNoteModal(inv)} className="text-xs">
                          <Undo2 className="mr-1 h-3 w-3" />
                          Credit Note
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add Customer Modal */}
      <Modal isOpen={isCustomerOpen} onClose={() => setIsCustomerOpen(false)} title="Add Customer">
        <form onSubmit={handleAddCustomer} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Customer / Company Name</label>
            <Input required placeholder="Acme Client Corp" value={custName} onChange={(e) => setCustName(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Billing Email</label>
            <Input type="email" required placeholder="billing@acmeclient.com" value={custEmail} onChange={(e) => setCustEmail(e.target.value)} />
          </div>
          <div className="flex justify-end space-x-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setIsCustomerOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary">Add Customer</Button>
          </div>
        </form>
      </Modal>

      {/* Create Invoice Modal */}
      <Modal isOpen={isInvoiceOpen} onClose={() => setIsInvoiceOpen(false)} title="Create New Invoice">
        <form onSubmit={handleCreateInvoice} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Select Customer</label>
            <select
              required
              className="w-full h-10 px-3 rounded-md border border-secondary-300 bg-white dark:bg-secondary-800 text-secondary-900 dark:text-secondary-50"
              value={selectedCustomer}
              onChange={(e) => setSelectedCustomer(e.target.value)}
            >
              <option value="">-- Choose Customer --</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name} ({c.email})</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Currency</label>
              <select
                className="w-full h-10 px-3 rounded-md border border-secondary-300 bg-white dark:bg-secondary-800 text-secondary-900 dark:text-secondary-50"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                <option value="USD">USD ($)</option>
                <option value="EUR">EUR (€)</option>
                <option value="GBP">GBP (£)</option>
                <option value="GHS">GHS (GH₵)</option>
                <option value="JPY">JPY (¥)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Tax Rate</label>
              <select
                className="w-full h-10 px-3 rounded-md border border-secondary-300 bg-white dark:bg-secondary-800 text-secondary-900 dark:text-secondary-50"
                value={selectedTaxRateId}
                onChange={(e) => setSelectedTaxRateId(e.target.value)}
              >
                <option value="">Use default active rate</option>
                {taxRates.map((tr) => (
                  <option key={tr.id} value={tr.id}>
                    {tr.name} ({(Number(tr.rate) * 100).toFixed(2)}%)
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Line Items</label>
            {items.map((it, idx) => (
              <div key={idx} className="flex gap-2 mb-2">
                <Input
                  className="flex-1"
                  placeholder="Description"
                  value={it.description}
                  onChange={(e) => {
                    const newIt = [...items];
                    newIt[idx].description = e.target.value;
                    setItems(newIt);
                  }}
                />
                <Input
                  type="number"
                  className="w-20"
                  placeholder="Qty"
                  value={it.quantity}
                  onChange={(e) => {
                    const newIt = [...items];
                    newIt[idx].quantity = Number(e.target.value);
                    newIt[idx].amount = newIt[idx].quantity * newIt[idx].unitPrice;
                    setItems(newIt);
                  }}
                />
                <Input
                  type="number"
                  className="w-28"
                  placeholder="Price"
                  value={it.unitPrice}
                  onChange={(e) => {
                    const newIt = [...items];
                    newIt[idx].unitPrice = Number(e.target.value);
                    newIt[idx].amount = newIt[idx].quantity * newIt[idx].unitPrice;
                    setItems(newIt);
                  }}
                />
              </div>
            ))}
          </div>

          <div className="flex justify-end space-x-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setIsInvoiceOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={isSubmitting}>
              {isSubmitting ? "Generating..." : "Issue Invoice"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Credit Note Modal */}
      <Modal
        isOpen={!!creditNoteInvoice}
        onClose={() => setCreditNoteInvoice(null)}
        title={`Issue Credit Note - ${creditNoteInvoice?.invoiceNumber ?? ""}`}
        description={
          creditNoteInvoice?.status === "PAID"
            ? "This invoice is already paid, so the credit will post a real refund entry (Cash out, Revenue reversed)."
            : "This invoice is unpaid, so the credit simply reduces the amount that will be charged on payment."
        }
      >
        <form onSubmit={handleIssueCreditNote} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">
              Amount ({creditNoteInvoice?.currency ?? "USD"})
            </label>
            <Input
              type="number"
              step="0.01"
              min="0.01"
              required
              placeholder="0.00"
              value={creditAmount}
              onChange={(e) => setCreditAmount(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Reason</label>
            <Input
              required
              placeholder="e.g. Customer returned one unit"
              value={creditReason}
              onChange={(e) => setCreditReason(e.target.value)}
            />
          </div>

          {creditNotesHistory.length > 0 && (
            <div>
              <label className="block text-sm font-medium mb-1">Previously Issued</label>
              <div className="space-y-1 max-h-32 overflow-y-auto text-xs">
                {creditNotesHistory.map((cn) => (
                  <div key={cn.id} className="flex justify-between border-b border-secondary-100 dark:border-secondary-800 py-1">
                    <span className="text-secondary-600 dark:text-secondary-400">
                      {cn.creditNoteNumber} - {cn.reason}
                    </span>
                    <span className="font-medium text-secondary-900 dark:text-secondary-50">
                      {formatCurrency(Number(cn.amount), creditNoteInvoice?.currency)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end space-x-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setCreditNoteInvoice(null)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={isIssuingCredit}>
              {isIssuingCredit ? "Issuing..." : "Issue Credit Note"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Collect via MoMo Modal */}
      <Modal
        isOpen={!!momoInvoice}
        onClose={() => setMomoInvoice(null)}
        title={`Collect via MTN MoMo - ${momoInvoice?.invoiceNumber ?? ""}`}
        description="Sends a real USSD payment prompt to the customer's phone. Once they approve, click Check Status to confirm and mark the invoice PAID."
      >
        <form onSubmit={handleSendMomoRequest} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">
              Customer Phone Number ({momoInvoice ? formatCurrency(Number(momoInvoice.total), momoInvoice.currency) : ""})
            </label>
            <Input
              required
              placeholder="0244000000"
              value={momoPhone}
              onChange={(e) => setMomoPhone(e.target.value)}
            />
          </div>

          {momoRequests.length > 0 && (
            <div>
              <label className="block text-sm font-medium mb-1">Payment Requests</label>
              <div className="space-y-2 max-h-48 overflow-y-auto text-xs">
                {momoRequests.map((r) => (
                  <div key={r.id} className="flex items-center justify-between border-b border-secondary-100 dark:border-secondary-800 py-1.5">
                    <div>
                      <div className="text-secondary-900 dark:text-secondary-50">{r.phoneNumber}</div>
                      <div className="text-secondary-500">{new Date(r.createdAt).toLocaleString()}</div>
                      {r.status === "FAILED" && r.failureReason && (
                        <div className="text-red-500 mt-0.5">{r.failureReason}</div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {r.status === "PENDING" && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
                          Pending
                        </span>
                      )}
                      {r.status === "SUCCESSFUL" && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">
                          Successful
                        </span>
                      )}
                      {r.status === "FAILED" && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
                          Failed
                        </span>
                      )}
                      {r.status === "PENDING" && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="text-xs"
                          disabled={checkingReferenceId === r.referenceId}
                          onClick={() => handleCheckMomoStatus(r.referenceId)}
                        >
                          <RefreshCw className="mr-1 h-3 w-3" />
                          {checkingReferenceId === r.referenceId ? "Checking..." : "Check Status"}
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end space-x-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setMomoInvoice(null)}>Close</Button>
            <Button type="submit" variant="primary" disabled={isSendingMomo}>
              {isSendingMomo ? "Sending..." : "Send Payment Request"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
