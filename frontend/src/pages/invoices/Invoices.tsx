import { useState, useEffect, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "../../components/ui/Table";
import { Modal } from "../../components/ui/Modal";
import { api } from "../../lib/api";
import { Plus, CheckCircle, UserPlus, DollarSign, Clock } from "lucide-react";

interface Customer {
  id: string;
  name: string;
  email: string;
  phone?: string;
}

interface InvoiceItem {
  description: string;
  quantity: number;
  unitPrice: number;
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
  total: number;
  status: string;
}

export function Invoices() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // Modals
  const [isInvoiceOpen, setIsInvoiceOpen] = useState(false);
  const [isCustomerOpen, setIsCustomerOpen] = useState(false);

  // Customer Form
  const [custName, setCustName] = useState("");
  const [custEmail, setCustEmail] = useState("");

  // Invoice Form
  const [selectedCustomer, setSelectedCustomer] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [items, setItems] = useState<InvoiceItem[]>([
    { description: "Software Consulting", quantity: 10, unitPrice: 150, amount: 1500 },
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [invRes, custRes] = await Promise.all([
        api.get("/invoices"),
        api.get("/invoices/customers"),
      ]);

      if (invRes.data.success) setInvoices(invRes.data.data.invoices);
      if (custRes.data.success) setCustomers(custRes.data.data.customers);
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
      alert(err.response?.data?.error || "Failed to add customer.");
    }
  };

  const handleCreateInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomer) {
      alert("Please select or add a customer first.");
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await api.post("/invoices", {
        customerId: selectedCustomer,
        currency,
        items,
      });

      if (res.data.success) {
        setIsInvoiceOpen(false);
        fetchData();
      }
    } catch (err: any) {
      alert(err.response?.data?.error || "Failed to create invoice.");
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
      alert(err.response?.data?.error || "Payment recording failed.");
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
                    <TableCell className="text-right">
                      {inv.status !== "PAID" && (
                        <Button variant="outline" size="sm" onClick={() => handlePayInvoice(inv.id)} className="text-xs">
                          Record Payment
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
    </div>
  );
}
