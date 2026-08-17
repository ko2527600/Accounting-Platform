import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "../../components/ui/Table";
import { Modal } from "../../components/ui/Modal";
import { api } from "../../lib/api";
import { syncDb, createInvoiceLocalFirst, payInvoiceLocalFirst, resyncInvoicesFromServer } from "../../lib/syncEngine";
import { useToast } from "../../contexts/ToastContext";
import { useAuth } from "../../contexts/AuthContext";
import { useTenantSettings } from "../../hooks/useTenantSettings";
import { Plus, CheckCircle, UserPlus, DollarSign, Clock, Undo2, RefreshCw, History, Mail, ChevronDown, ShieldCheck } from "lucide-react";

// Mirrors rbacMiddleware.ts's SCOPED_ROLES - these actions all backend-gate
// to requireRole('Accountant') (Email Invoice, Request GRA Clearance, Pay
// Now Link/Paystack, Credit Note), so every scoped role always 403s on
// them. Hiding the buttons instead of letting the click fail matches the
// established pattern in ExpenseClaims.tsx's RESTRICTED_DECIDER_ROLES.
const RESTRICTED_ACCOUNTANT_ACTION_ROLES = new Set(["viewer", "auditor", "hr", "shop manager", "cashier"]);
// Record Payment backend-gates to requireRole('Accountant', 'Shop Manager') -
// one role wider than the set above.
const RESTRICTED_PAYMENT_ROLES = new Set(["viewer", "auditor", "hr", "cashier"]);

interface Customer {
  id: string;
  name: string;
  email: string;
  phone?: string;
  creditLimit?: number | null;
  // GRA TIN, required for real E-VAT clearance (see graEvatService.ts) -
  // null for a customer with no TIN on file (e.g. walk-in/cash customer).
  tin?: string | null;
}

interface TaxRate {
  id: string;
  name: string;
  code: string;
  rate: string;
}

interface Fund {
  id: string;
  name: string;
  code: string;
}

interface WarehouseOption {
  id: string;
  name: string;
}

interface InventoryItemOption {
  id: string;
  sku: string;
  name: string;
  sellingPrice: number;
}

interface InvoiceItem {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  // Set only when this line is issued against a real inventory item on an
  // Itemized Invoice - see the Simple/Itemized toggle in the Create
  // Invoice modal. Mirrors VendorBills' itemized purchase line shape.
  inventoryItemId?: string;
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
  amountPaid: number;
  status: string;
  warehouseId?: string | null;
  stockDeducted?: boolean;
  emailedAt?: string | null;
  graClearanceStatus?: "NOT_REQUESTED" | "PENDING" | "CLEARED" | "FAILED";
  // Present only on a record still in flight through the local-first sync
  // outbox (see lib/syncEngine.ts) - a real network round-trip hasn't
  // confirmed it yet, or a real rejection needs the user's attention.
  _pending?: boolean;
  _failed?: boolean;
  _failureReason?: string;
}

interface CreditNote {
  id: string;
  creditNoteNumber: string;
  amount: number;
  reason: string;
  method: "INVOICE_REDUCTION" | "JOURNAL_REVERSAL" | "MIXED";
  issueDate: string;
}

interface InvoicePaymentRecord {
  id: string;
  amount: number;
  baseCurrencyAmount: number;
  method: string;
  recordedByEmail?: string | null;
  createdAt: string;
}

interface PaystackRequest {
  id: string;
  reference: string;
  amount: number;
  authorizationUrl: string;
  status: "PENDING" | "SUCCESSFUL" | "FAILED";
  failureReason: string | null;
  createdAt: string;
}

export function Invoices() {
  const { showToast } = useToast();
  const { user } = useAuth();
  const { settings } = useTenantSettings();
  const navigate = useNavigate();
  const userRoleLower = (user?.role || "").toLowerCase().trim();
  const canUseAccountantActions = !RESTRICTED_ACCOUNTANT_ACTION_ROLES.has(userRoleLower);
  const canRecordPayment = !RESTRICTED_PAYMENT_ROLES.has(userRoleLower);
  // Local-first: renders straight from the IndexedDB mirror (kept fresh by
  // the bootstrap + live push - see useSyncEngineLifecycle) instead of
  // waiting on a network fetch every time this page mounts.
  const localInvoices = useLiveQuery(() => syncDb.invoices.toArray(), []);
  const invoices: Invoice[] = ((localInvoices ?? []) as unknown as Invoice[])
    .slice()
    .sort((a, b) => new Date(b.issueDate ?? 0).getTime() - new Date(a.issueDate ?? 0).getTime());
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [taxRates, setTaxRates] = useState<TaxRate[]>([]);
  const [funds, setFunds] = useState<Fund[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItemOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Modals
  const [isInvoiceOpen, setIsInvoiceOpen] = useState(false);
  const [isCustomerOpen, setIsCustomerOpen] = useState(false);

  // Customer Form
  const [custName, setCustName] = useState("");
  const [custEmail, setCustEmail] = useState("");
  const [custCreditLimit, setCustCreditLimit] = useState("");
  const [custTin, setCustTin] = useState("");

  // Invoice Form
  const [selectedCustomer, setSelectedCustomer] = useState("");
  const [selectedTaxRateId, setSelectedTaxRateId] = useState("");
  const [selectedFundId, setSelectedFundId] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [items, setItems] = useState<InvoiceItem[]>([
    { description: "Software Consulting", quantity: 10, unitPrice: 150, amount: 1500 },
  ]);
  // Simple Invoice (no stock effect, the long-standing default) vs.
  // Itemized Invoice (deducts real stock at issue time) - mirrors
  // VendorBills' Simple Bill / Itemized Purchase toggle on the buying side.
  const [isItemizedInvoice, setIsItemizedInvoice] = useState(false);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Credit Note modal
  const [creditNoteInvoice, setCreditNoteInvoice] = useState<Invoice | null>(null);
  const [creditNotesHistory, setCreditNotesHistory] = useState<CreditNote[]>([]);
  const [creditAmount, setCreditAmount] = useState("");
  const [creditReason, setCreditReason] = useState("");
  const [creditReturnToStock, setCreditReturnToStock] = useState(false);
  const [isIssuingCredit, setIsIssuingCredit] = useState(false);

  // Record Payment modal - defaults to the full remaining balance, but the
  // amount is editable so a partial payment can be recorded instead.
  const [paymentInvoice, setPaymentInvoice] = useState<Invoice | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [isRecordingPayment, setIsRecordingPayment] = useState(false);

  // Payment History modal - read-only list of every payment (full or
  // partial) ever recorded against an invoice.
  const [paymentHistoryInvoice, setPaymentHistoryInvoice] = useState<Invoice | null>(null);
  const [paymentHistory, setPaymentHistory] = useState<InvoicePaymentRecord[]>([]);
  const [isLoadingPaymentHistory, setIsLoadingPaymentHistory] = useState(false);

  // Paystack "Pay Now" link (card/bank transfer/Mobile Money) collection modal
  const [paystackInvoice, setPaystackInvoice] = useState<Invoice | null>(null);
  const [paystackRequests, setPaystackRequests] = useState<PaystackRequest[]>([]);
  const [isGeneratingPaystackLink, setIsGeneratingPaystackLink] = useState(false);
  const [verifyingPaystackRef, setVerifyingPaystackRef] = useState<string | null>(null);

  const [requestingGraClearanceId, setRequestingGraClearanceId] = useState<string | null>(null);

  // Once the tenant's real base currency loads, default the new-invoice
  // currency picker to it instead of leaving it pinned to the initial "USD"
  // guess - most users never touch this field, so leaving it wrong would
  // silently misdenominate every invoice. Only snaps it while the field is
  // still at that initial default, so it never clobbers a currency the user
  // already chose.
  useEffect(() => {
    setCurrency((c) => (c === "USD" ? settings.baseCurrency : c));
  }, [settings.baseCurrency]);

  // Only customers/tax rates/funds are fetched live here - invoices
  // themselves come from the local-first sync mirror above. Those three
  // aren't part of the sync pilot's scope yet (see STATUS.md).
  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [custRes, taxRes, fundsRes, whRes, itemsRes] = await Promise.all([
        api.get("/invoices/customers"),
        api.get("/tax-rates"),
        api.get("/funds"),
        api.get("/inventory/warehouses"),
        api.get("/inventory/items"),
      ]);

      if (custRes.data.success) setCustomers(custRes.data.data.customers);
      if (taxRes.data.success) setTaxRates(taxRes.data.data.taxRates.filter((t: any) => t.isActive));
      if (fundsRes.data.success) setFunds(fundsRes.data.data.funds.filter((f: any) => f.isActive));
      if (whRes.data.success) setWarehouses(whRes.data.data.warehouses.map((w: any) => ({ id: w.id, name: w.name })));
      if (itemsRes.data.success) {
        setInventoryItems(
          itemsRes.data.data.items.map((it: any) => ({
            id: it.id,
            sku: it.sku,
            name: it.name,
            sellingPrice: Number(it.sellingPrice),
          }))
        );
      }
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
      const res = await api.post("/invoices/customers", {
        name: custName,
        email: custEmail,
        creditLimit: custCreditLimit.trim() ? Number(custCreditLimit) : null,
        tin: custTin.trim() || null,
      });
      if (res.data.success) {
        setCustName("");
        setCustEmail("");
        setCustCreditLimit("");
        setCustTin("");
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
    if (isItemizedInvoice && !selectedWarehouseId) {
      showToast("Select which warehouse this invoice ships stock from.", "error");
      return;
    }
    setIsSubmitting(true);
    try {
      // Writes locally first (instant) and queues the real request in the
      // background - see createInvoiceLocalFirst. The live query above
      // picks up the optimistic row immediately, no explicit refetch needed.
      const customer = customers.find((c) => c.id === selectedCustomer);
      await createInvoiceLocalFirst(
        {
          customerId: selectedCustomer,
          currency,
          items,
          ...(selectedTaxRateId ? { taxRateId: selectedTaxRateId } : {}),
          ...(selectedFundId ? { fundId: selectedFundId } : {}),
          ...(isItemizedInvoice ? { warehouseId: selectedWarehouseId } : {}),
        },
        customer
      );
      setIsInvoiceOpen(false);
      setIsItemizedInvoice(false);
      setSelectedWarehouseId("");
    } catch (err: any) {
      showToast(err.response?.data?.error || "Failed to create invoice.", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const balanceDue = (inv: Invoice) => Math.round((Number(inv.total) - Number(inv.amountPaid || 0)) * 100) / 100;

  const openPaymentModal = (inv: Invoice) => {
    setPaymentInvoice(inv);
    setPaymentAmount(balanceDue(inv).toFixed(2));
  };

  const handleSubmitPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentInvoice) return;
    const amount = Number(paymentAmount);
    if (!amount || amount <= 0) {
      showToast("Enter a payment amount greater than 0.", "error");
      return;
    }
    const remaining = balanceDue(paymentInvoice);
    if (amount > remaining + 0.01) {
      showToast(`Payment amount cannot exceed the remaining balance (${formatCurrency(remaining, paymentInvoice.currency)}).`, "error");
      return;
    }
    setIsRecordingPayment(true);
    try {
      await payInvoiceLocalFirst(paymentInvoice.id, amount);
      showToast(
        amount >= remaining - 0.01 ? "Payment recorded - invoice paid in full." : "Partial payment recorded.",
        "success"
      );
      setPaymentInvoice(null);
    } catch (err: any) {
      showToast(err.response?.data?.error || "Payment recording failed.", "error");
    } finally {
      setIsRecordingPayment(false);
    }
  };

  const openPaymentHistory = async (inv: Invoice) => {
    setPaymentHistoryInvoice(inv);
    setIsLoadingPaymentHistory(true);
    try {
      const res = await api.get(`/invoices/${inv.id}/payments`);
      if (res.data.success) setPaymentHistory(res.data.data.payments);
    } catch (err) {
      console.error("Failed to load payment history:", err);
    } finally {
      setIsLoadingPaymentHistory(false);
    }
  };

  const [sendingInvoiceId, setSendingInvoiceId] = useState<string | null>(null);
  const handleSendInvoiceEmail = async (invoice: Invoice) => {
    setSendingInvoiceId(invoice.id);
    try {
      const res = await api.post(`/invoices/${invoice.id}/send`);
      if (res.data.success) {
        showToast(res.data.message || `Invoice emailed to ${invoice.customer.email}.`, "success");
        resyncInvoicesFromServer();
      }
    } catch (err: any) {
      showToast(err.response?.data?.error || "Failed to email invoice.", "error");
    } finally {
      setSendingInvoiceId(null);
    }
  };

  // Which row's "Actions" overflow menu is open, if any - collapses the
  // per-row action buttons (previously 5-6 separate labeled buttons, which
  // wrapped and clipped at normal viewport width) into one menu, mirroring
  // Header.tsx's profile-dropdown outside-click-close pattern. Rendered via
  // a portal (see below) since Table.tsx's wrapper is `overflow-auto` for
  // horizontal scrolling - per the CSS spec, that forces vertical overflow
  // to clip too, so an absolutely-positioned dropdown inside a table cell
  // gets cut off no matter how it's positioned unless it escapes that
  // ancestor entirely.
  const [openActionsMenuId, setOpenActionsMenuId] = useState<string | null>(null);
  const [actionsMenuPosition, setActionsMenuPosition] = useState<{ top: number; right: number } | null>(null);

  const toggleActionsMenu = (invoiceId: string, e: React.MouseEvent<HTMLButtonElement>) => {
    if (openActionsMenuId === invoiceId) {
      setOpenActionsMenuId(null);
      return;
    }
    // Viewport-relative (not document-relative) since the menu below uses
    // `position: fixed` - deliberately not adding window.scrollX/scrollY.
    const rect = e.currentTarget.getBoundingClientRect();
    setActionsMenuPosition({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    setOpenActionsMenuId(invoiceId);
  };

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!(event.target as HTMLElement).closest("[data-invoice-actions-menu]")) {
        setOpenActionsMenuId(null);
      }
    }
    // Closes on any scroll (including the table's own horizontal/vertical
    // scroll container) rather than repositioning - the portal-rendered
    // menu uses viewport coordinates captured at open time, so it would
    // otherwise visually detach from its trigger button as the page scrolls.
    function handleScroll() {
      setOpenActionsMenuId(null);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("scroll", handleScroll, true);
    };
  }, []);

  const openCreditNoteModal = async (invoice: Invoice) => {
    setCreditNoteInvoice(invoice);
    setCreditAmount("");
    setCreditReason("");
    setCreditReturnToStock(false);
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
        ...(creditReturnToStock ? { returnToStock: true } : {}),
      });
      if (res.data.success) {
        showToast(`Credit note ${res.data.data.creditNote.creditNoteNumber} issued.`, "success");
        setCreditNoteInvoice(null);
        setCreditReturnToStock(false);
        resyncInvoicesFromServer();
      }
    } catch (err: any) {
      showToast(err.response?.data?.error || "Failed to issue credit note.", "error");
    } finally {
      setIsIssuingCredit(false);
    }
  };

  const openPaystackModal = async (invoice: Invoice) => {
    setPaystackInvoice(invoice);
    setPaystackRequests([]);
    try {
      const res = await api.get(`/paystack/invoices/${invoice.id}/requests`);
      if (res.data.success) setPaystackRequests(res.data.data.requests);
    } catch (err) {
      console.error("Failed to load Paystack request history:", err);
    }
  };

  const handleGeneratePaystackLink = async () => {
    if (!paystackInvoice) return;
    setIsGeneratingPaystackLink(true);
    try {
      const res = await api.post(`/paystack/invoices/${paystackInvoice.id}/initialize`);
      if (res.data.success) {
        setPaystackRequests((prev) => [res.data.data.request, ...prev]);
        if (navigator.clipboard) {
          navigator.clipboard.writeText(res.data.data.request.authorizationUrl).catch(() => {});
          showToast("Payment link generated and copied to clipboard. Share it with the customer.", "success");
        } else {
          showToast("Payment link generated. Share it with the customer.", "success");
        }
      }
    } catch (err: any) {
      showToast(err.response?.data?.error || "Failed to generate Paystack payment link.", "error");
    } finally {
      setIsGeneratingPaystackLink(false);
    }
  };

  const handleVerifyPaystack = async (reference: string) => {
    setVerifyingPaystackRef(reference);
    try {
      const res = await api.post(`/paystack/requests/${reference}/verify`);
      if (res.data.success) {
        setPaystackRequests((prev) => prev.map((r) => (r.reference === reference ? res.data.data.request : r)));
        if (res.data.data.request.status === "SUCCESSFUL") {
          showToast("Payment confirmed - invoice marked PAID.", "success");
          setPaystackInvoice(null);
          resyncInvoicesFromServer();
        } else if (res.data.data.request.status === "FAILED") {
          showToast("Payment was not successful. See the reason below.", "error");
        } else {
          showToast("Still pending - the customer hasn't completed checkout yet.", "info");
        }
      }
    } catch (err: any) {
      showToast(err.response?.data?.error || "Failed to verify Paystack payment.", "error");
    } finally {
      setVerifyingPaystackRef(null);
    }
  };

  // Requesting GRA clearance always fails today with a clear explanation -
  // see graEvatService.requestClearance's own doc comment for why (GRA only
  // hands out the real API specification during their own taxpayer
  // onboarding process, so there's no public wire format to build against
  // yet). Still routes through the real endpoint so the moment that changes,
  // this action starts actually working with no UI change needed.
  const handleRequestGraClearance = async (invoiceId: string) => {
    setRequestingGraClearanceId(invoiceId);
    try {
      const res = await api.post(`/invoices/${invoiceId}/gra-clearance`);
      if (res.data.success) {
        showToast("Invoice cleared by GRA.", "success");
        resyncInvoicesFromServer();
      }
    } catch (err: any) {
      showToast(err.response?.data?.error || "Failed to request GRA clearance.", "error");
    } finally {
      setRequestingGraClearanceId(null);
    }
  };

  // Defaults to the tenant's real configured base currency (not a hardcoded
  // "USD") for aggregate figures like the AR/Paid summary tiles that don't
  // pass an explicit currency. Individual invoice rows still pass
  // `inv.currency` explicitly - that's the real per-invoice native currency,
  // correct as-is.
  const formatCurrency = (amt: number, curr = settings.baseCurrency) => {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: curr }).format(amt);
  };

  // Balance still owed, not the original total - a partially-paid invoice
  // must only count what's actually still outstanding.
  const totalAR = invoices.reduce((acc, inv) => acc + (inv.status !== "PAID" ? Number(inv.total) - Number(inv.amountPaid || 0) : 0), 0);
  const totalPaid = invoices.reduce((acc, inv) => acc + Number(inv.amountPaid || 0), 0);

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
                      <div className="flex items-center gap-2">
                        {inv.invoiceNumber}
                        {inv._pending && (
                          <span className="font-sans text-[10px] font-normal text-amber-600 dark:text-amber-400" title="Saving to the cloud...">
                            Syncing...
                          </span>
                        )}
                        {inv._failed && (
                          <span
                            className="font-sans text-[10px] font-normal text-red-600 dark:text-red-400"
                            title={inv._failureReason || 'This change was rejected and needs your attention.'}
                          >
                            Needs attention
                          </span>
                        )}
                      </div>
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
                      {inv.status === "PARTIALLY_PAID" && (
                        <div className="font-normal text-[11px] text-secondary-500 dark:text-secondary-400">
                          {formatCurrency(balanceDue(inv), inv.currency)} still due
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      {inv.status === "PAID" ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">
                          <CheckCircle className="mr-1 h-3 w-3" /> Paid
                        </span>
                      ) : inv.status === "PARTIALLY_PAID" ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
                          Partially Paid
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
                          Pending Payment
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => navigate(`/audit-logs?entityId=${inv.id}&entity=Invoice`)}
                        className="text-xs"
                        title="View this invoice's change history"
                      >
                        <History className="h-3 w-3" />
                      </Button>
                      <div className="inline-block" data-invoice-actions-menu>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(e) => toggleActionsMenu(inv.id, e)}
                          className="text-xs"
                        >
                          Actions
                          <ChevronDown className="ml-1 h-3 w-3" />
                        </Button>
                        {openActionsMenuId === inv.id && actionsMenuPosition && createPortal(
                          <div
                            data-invoice-actions-menu
                            style={{ position: "fixed", top: actionsMenuPosition.top, right: actionsMenuPosition.right }}
                            className="w-64 bg-white dark:bg-secondary-900 border border-secondary-200 dark:border-secondary-800 rounded-lg shadow-lg z-50 py-1 text-left"
                          >
                            {inv.status !== "DRAFT" && canUseAccountantActions && (
                              <button
                                onClick={() => { setOpenActionsMenuId(null); handleSendInvoiceEmail(inv); }}
                                disabled={sendingInvoiceId === inv.id}
                                title={inv.emailedAt ? `Last emailed ${new Date(inv.emailedAt).toLocaleString()}` : "Email this invoice to the customer"}
                                className="w-full flex items-center px-3 py-2 text-xs text-secondary-700 dark:text-secondary-300 hover:bg-secondary-50 dark:hover:bg-secondary-800 disabled:opacity-50"
                              >
                                <Mail className="mr-2 h-3 w-3" />
                                {sendingInvoiceId === inv.id ? "Sending..." : inv.emailedAt ? "Re-send Invoice" : "Email Invoice"}
                              </button>
                            )}
                            {inv.status !== "DRAFT" && inv.graClearanceStatus !== "CLEARED" && canUseAccountantActions && (
                              <button
                                onClick={() => { setOpenActionsMenuId(null); handleRequestGraClearance(inv.id); }}
                                disabled={requestingGraClearanceId === inv.id}
                                title="Requests real-time clearance from GRA's VSDC (E-VAT). Requires the business to be onboarded with GRA directly first."
                                className="w-full flex items-center px-3 py-2 text-xs text-secondary-700 dark:text-secondary-300 hover:bg-secondary-50 dark:hover:bg-secondary-800 disabled:opacity-50"
                              >
                                <ShieldCheck className="mr-2 h-3 w-3" />
                                {requestingGraClearanceId === inv.id ? "Requesting..." : "Request GRA Clearance"}
                              </button>
                            )}
                            {inv.status !== "PAID" && canRecordPayment && (
                              <button
                                onClick={() => { setOpenActionsMenuId(null); openPaymentModal(inv); }}
                                className="w-full flex items-center px-3 py-2 text-xs text-secondary-700 dark:text-secondary-300 hover:bg-secondary-50 dark:hover:bg-secondary-800"
                              >
                                <DollarSign className="mr-2 h-3 w-3" />
                                Record Payment
                              </button>
                            )}
                            {inv.status !== "DRAFT" && Number(inv.amountPaid || 0) > 0 && (
                              <button
                                onClick={() => { setOpenActionsMenuId(null); openPaymentHistory(inv); }}
                                className="w-full flex items-center px-3 py-2 text-xs text-secondary-700 dark:text-secondary-300 hover:bg-secondary-50 dark:hover:bg-secondary-800"
                              >
                                <History className="mr-2 h-3 w-3" />
                                Payment History
                              </button>
                            )}
                            {inv.status !== "PAID" && inv.status !== "DRAFT" && canUseAccountantActions && (
                              <button
                                onClick={() => { setOpenActionsMenuId(null); openPaystackModal(inv); }}
                                className="w-full flex items-center px-3 py-2 text-xs text-secondary-700 dark:text-secondary-300 hover:bg-secondary-50 dark:hover:bg-secondary-800"
                              >
                                <DollarSign className="mr-2 h-3 w-3" />
                                Pay Now Link (Paystack)
                              </button>
                            )}
                            {inv.status !== "DRAFT" && canUseAccountantActions && (
                              <button
                                onClick={() => { setOpenActionsMenuId(null); openCreditNoteModal(inv); }}
                                className="w-full flex items-center px-3 py-2 text-xs text-secondary-700 dark:text-secondary-300 hover:bg-secondary-50 dark:hover:bg-secondary-800"
                              >
                                <Undo2 className="mr-2 h-3 w-3" />
                                Credit Note
                              </button>
                            )}
                          </div>,
                          document.body
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
          <div>
            <label className="block text-sm font-medium mb-1">Credit Limit (optional)</label>
            <Input
              type="number"
              min="0"
              step="0.01"
              placeholder="No limit"
              value={custCreditLimit}
              onChange={(e) => setCustCreditLimit(e.target.value)}
            />
            <p className="text-xs text-secondary-500 mt-1">
              New invoices for this customer are blocked once their outstanding balance would exceed this. Leave blank for no limit.
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">GRA TIN (optional)</label>
            <Input placeholder="e.g. C0001234567" value={custTin} onChange={(e) => setCustTin(e.target.value)} />
            <p className="text-xs text-secondary-500 mt-1">
              Required for GRA E-VAT clearance to identify this customer correctly - leave blank for a walk-in/cash customer.
            </p>
          </div>
          <div className="flex justify-end space-x-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setIsCustomerOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary">Add Customer</Button>
          </div>
        </form>
      </Modal>

      {/* Create Invoice Modal */}
      <Modal isOpen={isInvoiceOpen} onClose={() => setIsInvoiceOpen(false)} title="Create New Invoice" className="max-w-2xl">
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

          {funds.length > 0 && (
            <div>
              <label className="block text-sm font-medium mb-1">Fund (optional)</label>
              <select
                className="w-full h-10 px-3 rounded-md border border-secondary-300 bg-white dark:bg-secondary-800 text-secondary-900 dark:text-secondary-50"
                value={selectedFundId}
                onChange={(e) => setSelectedFundId(e.target.value)}
              >
                <option value="">No fund</option>
                {funds.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} ({f.code})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex rounded-md border border-secondary-200 dark:border-secondary-800 p-1 text-sm">
            <button
              type="button"
              onClick={() => setIsItemizedInvoice(false)}
              className={`flex-1 py-1.5 rounded ${!isItemizedInvoice ? "bg-primary-600 text-white" : "text-secondary-500"}`}
            >
              Simple Invoice
            </button>
            <button
              type="button"
              onClick={() => setIsItemizedInvoice(true)}
              className={`flex-1 py-1.5 rounded ${isItemizedInvoice ? "bg-primary-600 text-white" : "text-secondary-500"}`}
            >
              Itemized Invoice (Deducts Stock)
            </button>
          </div>

          {isItemizedInvoice && (
            <div>
              <label className="block text-sm font-medium mb-1">Shipping Warehouse</label>
              <select
                required={isItemizedInvoice}
                className="w-full h-10 px-3 rounded-md border border-secondary-300 bg-white dark:bg-secondary-800 text-secondary-900 dark:text-secondary-50"
                value={selectedWarehouseId}
                onChange={(e) => setSelectedWarehouseId(e.target.value)}
              >
                <option value="">-- Choose Warehouse --</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1">Line Items</label>
            {items.map((it, idx) => (
              <div key={idx} className="flex gap-2 mb-2">
                {isItemizedInvoice && (
                  <select
                    className="w-40 h-9 px-2 rounded-md border border-secondary-300 bg-white dark:bg-secondary-800 text-secondary-900 dark:text-secondary-50 text-xs"
                    value={it.inventoryItemId || ""}
                    onChange={(e) => {
                      const selected = inventoryItems.find((inv) => inv.id === e.target.value);
                      const newIt = [...items];
                      newIt[idx].inventoryItemId = e.target.value || undefined;
                      if (selected) {
                        newIt[idx].description = selected.name;
                        newIt[idx].unitPrice = selected.sellingPrice;
                        newIt[idx].amount = newIt[idx].quantity * selected.sellingPrice;
                      }
                      setItems(newIt);
                    }}
                  >
                    <option value="">-- Stock Item --</option>
                    {inventoryItems.map((inv) => (
                      <option key={inv.id} value={inv.id}>{inv.name} ({inv.sku})</option>
                    ))}
                  </select>
                )}
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
            : creditNoteInvoice?.status === "PARTIALLY_PAID"
            ? "This invoice is partially paid - the credit will reduce what's still owed first, and only post a refund entry (Cash out, Revenue reversed) for any amount beyond what's still unpaid."
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

          {creditNoteInvoice?.stockDeducted && (
            <label className="flex items-start space-x-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={creditReturnToStock}
                onChange={(e) => setCreditReturnToStock(e.target.checked)}
              />
              <span>
                Return items to stock
                <span className="block text-[11px] text-secondary-500 dark:text-secondary-400">
                  Only works when this credit note covers the invoice's full remaining balance - a
                  partial credit can't be tied to specific returned units.
                </span>
              </span>
            </label>
          )}

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

      {/* Record Payment Modal */}
      <Modal
        isOpen={!!paymentInvoice}
        onClose={() => setPaymentInvoice(null)}
        title={`Record Payment - ${paymentInvoice?.invoiceNumber ?? ""}`}
        description={
          paymentInvoice
            ? `Balance due: ${formatCurrency(balanceDue(paymentInvoice), paymentInvoice.currency)}. Enter the full balance to mark this invoice Paid, or a smaller amount to record a partial payment.`
            : undefined
        }
      >
        <form onSubmit={handleSubmitPayment} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">
              Amount Received ({paymentInvoice?.currency ?? "USD"})
            </label>
            <Input
              type="number"
              step="0.01"
              min="0.01"
              required
              placeholder="0.00"
              value={paymentAmount}
              onChange={(e) => setPaymentAmount(e.target.value)}
            />
          </div>
          <div className="flex justify-end space-x-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setPaymentInvoice(null)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={isRecordingPayment}>
              {isRecordingPayment ? "Recording..." : "Record Payment"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Payment History Modal (read-only) */}
      <Modal
        isOpen={!!paymentHistoryInvoice}
        onClose={() => setPaymentHistoryInvoice(null)}
        title={`Payment History - ${paymentHistoryInvoice?.invoiceNumber ?? ""}`}
      >
        {isLoadingPaymentHistory ? (
          <p className="text-sm text-secondary-500">Loading...</p>
        ) : paymentHistory.length === 0 ? (
          <p className="text-sm text-secondary-500">No payments recorded yet.</p>
        ) : (
          <div className="space-y-1 max-h-80 overflow-y-auto text-xs">
            {paymentHistory.map((pmt) => (
              <div key={pmt.id} className="flex justify-between items-center border-b border-secondary-100 dark:border-secondary-800 py-2">
                <div>
                  <div className="font-medium text-secondary-900 dark:text-secondary-50">
                    {formatCurrency(Number(pmt.amount), paymentHistoryInvoice?.currency)}
                  </div>
                  <div className="text-secondary-500 dark:text-secondary-400">
                    {new Date(pmt.createdAt).toLocaleString()} - {pmt.method}
                    {pmt.recordedByEmail ? ` - ${pmt.recordedByEmail}` : ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* Paystack "Pay Now" Link Modal */}
      <Modal
        isOpen={!!paystackInvoice}
        onClose={() => setPaystackInvoice(null)}
        title={`Pay Now Link (Paystack) - ${paystackInvoice?.invoiceNumber ?? ""}`}
        description="Generates a hosted checkout link for card or bank transfer. Share it with the customer, then verify once they confirm payment."
      >
        <div className="space-y-4">
          <div className="text-sm text-secondary-600 dark:text-secondary-400">
            Outstanding balance: {paystackInvoice ? formatCurrency(Number(paystackInvoice.total) - Number(paystackInvoice.amountPaid || 0), paystackInvoice.currency) : ""}
          </div>

          {paystackRequests.length > 0 && (
            <div>
              <label className="block text-sm font-medium mb-1">Payment Links</label>
              <div className="space-y-2 max-h-48 overflow-y-auto text-xs">
                {paystackRequests.map((r) => (
                  <div key={r.id} className="flex items-center justify-between border-b border-secondary-100 dark:border-secondary-800 py-1.5">
                    <div>
                      <div className="text-secondary-900 dark:text-secondary-50">{formatCurrency(Number(r.amount), paystackInvoice?.currency || "GHS")}</div>
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
                        <>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="text-xs"
                            onClick={() => navigator.clipboard?.writeText(r.authorizationUrl).then(() => showToast("Link copied.", "success")).catch(() => {})}
                          >
                            Copy Link
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="text-xs"
                            disabled={verifyingPaystackRef === r.reference}
                            onClick={() => handleVerifyPaystack(r.reference)}
                          >
                            <RefreshCw className="mr-1 h-3 w-3" />
                            {verifyingPaystackRef === r.reference ? "Verifying..." : "Verify Payment"}
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end space-x-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setPaystackInvoice(null)}>Close</Button>
            <Button type="button" variant="primary" disabled={isGeneratingPaystackLink} onClick={handleGeneratePaystackLink}>
              {isGeneratingPaystackLink ? "Generating..." : "Generate Payment Link"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
