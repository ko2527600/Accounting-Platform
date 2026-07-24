import { useState, useEffect, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "../../components/ui/Table";
import { Modal } from "../../components/ui/Modal";
import { api } from "../../lib/api";
import { Plus, CheckCircle, Building2, CreditCard, AlertCircle } from "lucide-react";

interface Vendor {
  id: string;
  name: string;
  email: string;
  phone?: string;
}

interface VendorBill {
  id: string;
  billNumber: string;
  vendor: Vendor;
  billDate: string;
  dueDate: string;
  amount: number;
  currency: string;
  status: string;
}

export function VendorBills() {
  const [bills, setBills] = useState<VendorBill[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Modals
  const [isBillOpen, setIsBillOpen] = useState(false);
  const [isVendorOpen, setIsVendorOpen] = useState(false);

  // Vendor Form
  const [vendorName, setVendorName] = useState("");
  const [vendorEmail, setVendorEmail] = useState("");

  // Bill Form
  const [selectedVendor, setSelectedVendor] = useState("");
  const [billAmount, setBillAmount] = useState("450");
  const [currency, setCurrency] = useState("USD");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [billRes, venRes] = await Promise.all([
        api.get("/bills"),
        api.get("/bills/vendors"),
      ]);

      if (billRes.data.success) setBills(billRes.data.data.bills);
      if (venRes.data.success) setVendors(venRes.data.data.vendors);
    } catch (err) {
      console.error("Failed to load bills data:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleAddVendor = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await api.post("/bills/vendors", { name: vendorName, email: vendorEmail });
      if (res.data.success) {
        setVendorName("");
        setVendorEmail("");
        setIsVendorOpen(false);
        fetchData();
      }
    } catch (err: any) {
      alert(err.response?.data?.error || "Failed to add vendor.");
    }
  };

  const handleCreateBill = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVendor) {
      alert("Please select a vendor.");
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await api.post("/bills", {
        vendorId: selectedVendor,
        amount: Number(billAmount),
        currency,
      });

      if (res.data.success) {
        setIsBillOpen(false);
        fetchData();
      }
    } catch (err: any) {
      alert(err.response?.data?.error || "Failed to create vendor bill.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePayBill = async (id: string) => {
    try {
      const res = await api.post(`/bills/${id}/pay`);
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

  const totalAP = bills.reduce((acc, b) => acc + (b.status !== "PAID" ? Number(b.amount) : 0), 0);
  const totalPaid = bills.reduce((acc, b) => acc + (b.status === "PAID" ? Number(b.amount) : 0), 0);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-secondary-900 dark:text-secondary-50">
            Vendor Bills & Accounts Payable (AP)
          </h2>
          <p className="text-secondary-500 dark:text-secondary-400 mt-1">
            Track vendor payables, record bill payments, and auto-post AP expense ledger entries.
          </p>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setIsVendorOpen(true)} className="flex items-center">
            <Building2 className="mr-2 h-4 w-4" />
            Add Vendor
          </Button>
          <Button variant="primary" onClick={() => setIsBillOpen(true)} className="flex items-center">
            <Plus className="mr-2 h-4 w-4" />
            Add Vendor Bill
          </Button>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid gap-6 md:grid-cols-3">
        <Card className="border-rose-100 dark:border-rose-950">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-semibold text-secondary-600 dark:text-secondary-400">Total Unpaid Bills (AP)</CardTitle>
            <AlertCircle className="h-5 w-5 text-rose-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-rose-600 dark:text-rose-400">{formatCurrency(totalAP)}</div>
          </CardContent>
        </Card>

        <Card className="border-emerald-100 dark:border-emerald-950">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-semibold text-secondary-600 dark:text-secondary-400">Total Paid Bills</CardTitle>
            <CreditCard className="h-5 w-5 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(totalPaid)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-semibold text-secondary-600 dark:text-secondary-400">Total Vendors</CardTitle>
            <Building2 className="h-5 w-5 text-primary-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-secondary-900 dark:text-secondary-50">{vendors.length}</div>
          </CardContent>
        </Card>
      </div>

      {/* Bills List */}
      <Card>
        <CardHeader>
          <CardTitle>Vendor Bills ({bills.length})</CardTitle>
          <CardDescription>Manage incoming vendor invoices and schedule payments.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-8 text-center text-secondary-500">Loading vendor bills...</div>
          ) : bills.length === 0 ? (
            <div className="py-8 text-center text-secondary-500 text-sm">
              No vendor bills recorded yet. Click "Add Vendor Bill" to enter a payable.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bill #</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Bill Date</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bills.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-mono font-medium text-primary-600 dark:text-primary-400">
                      {b.billNumber}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-secondary-900 dark:text-secondary-50">{b.vendor?.name}</div>
                      <div className="text-xs text-secondary-500">{b.vendor?.email}</div>
                    </TableCell>
                    <TableCell className="text-xs text-secondary-500">
                      {new Date(b.billDate).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="font-bold text-secondary-900 dark:text-secondary-50">
                      {formatCurrency(Number(b.amount), b.currency)}
                    </TableCell>
                    <TableCell>
                      {b.status === "PAID" ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">
                          <CheckCircle className="mr-1 h-3 w-3" /> Paid
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400">
                          Unpaid
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {b.status !== "PAID" && (
                        <Button variant="outline" size="sm" onClick={() => handlePayBill(b.id)} className="text-xs">
                          Pay Bill
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

      {/* Add Vendor Modal */}
      <Modal isOpen={isVendorOpen} onClose={() => setIsVendorOpen(false)} title="Add Vendor">
        <form onSubmit={handleAddVendor} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Vendor / Company Name</label>
            <Input required placeholder="AWS Cloud Services" value={vendorName} onChange={(e) => setVendorName(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Vendor Contact Email</label>
            <Input type="email" required placeholder="billing@aws.amazon.com" value={vendorEmail} onChange={(e) => setVendorEmail(e.target.value)} />
          </div>
          <div className="flex justify-end space-x-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setIsVendorOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary">Add Vendor</Button>
          </div>
        </form>
      </Modal>

      {/* Create Vendor Bill Modal */}
      <Modal isOpen={isBillOpen} onClose={() => setIsBillOpen(false)} title="Record Vendor Bill">
        <form onSubmit={handleCreateBill} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Select Vendor</label>
            <select
              required
              className="w-full h-10 px-3 rounded-md border border-secondary-300 bg-white dark:bg-secondary-800 text-secondary-900 dark:text-secondary-50"
              value={selectedVendor}
              onChange={(e) => setSelectedVendor(e.target.value)}
            >
              <option value="">-- Choose Vendor --</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>{v.name} ({v.email})</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Bill Amount ($)</label>
              <Input
                type="number"
                required
                placeholder="450"
                value={billAmount}
                onChange={(e) => setBillAmount(e.target.value)}
              />
            </div>
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

          <div className="flex justify-end space-x-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setIsBillOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={isSubmitting}>
              {isSubmitting ? "Recording..." : "Record Bill"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
