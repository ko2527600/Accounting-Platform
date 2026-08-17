import { useState, useEffect, useCallback } from "react";
import { RefreshCw, Clock } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "../../components/ui/Card";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "../../components/ui/Table";
import { Button } from "../../components/ui/Button";
import { useTenantSettings } from "../../hooks/useTenantSettings";
import { api } from "../../lib/api";

interface AgingTotals {
  current: number;
  days1to30: number;
  days31to60: number;
  days61to90: number;
  days90plus: number;
  total: number;
}

interface ArRow {
  invoiceId: string;
  invoiceNumber: string;
  customerName: string;
  dueDate: string;
  daysOverdue: number;
  balanceDue: number;
  bucket: string;
}

interface ApRow {
  billId: string;
  billNumber: string;
  vendorName: string;
  dueDate: string;
  daysOverdue: number;
  balanceDue: number;
  bucket: string;
}

const BUCKET_LABELS: Record<string, string> = {
  current: "Current",
  days1to30: "1-30 Days",
  days31to60: "31-60 Days",
  days61to90: "61-90 Days",
  days90plus: "90+ Days",
};

function emptyTotals(): AgingTotals {
  return { current: 0, days1to30: 0, days31to60: 0, days61to90: 0, days90plus: 0, total: 0 };
}

// AP/AR aging - every genuinely outstanding invoice/bill balance, bucketed
// by how many days past its due date it is. Reads real Invoice.amountPaid
// (partial payments) and VendorBill.status (bills are all-or-nothing in
// this schema) - no separate accrual ledger, just the same balance-due math
// the Invoices/Vendor Bills pages already use.
export function AgingReport() {
  const { settings } = useTenantSettings();
  const [tab, setTab] = useState<"ar" | "ap">("ar");
  const [arRows, setArRows] = useState<ArRow[]>([]);
  const [apRows, setApRows] = useState<ApRow[]>([]);
  const [arTotals, setArTotals] = useState<AgingTotals>(emptyTotals());
  const [apTotals, setApTotals] = useState<AgingTotals>(emptyTotals());
  const [isLoading, setIsLoading] = useState(true);

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: settings.baseCurrency }).format(amount);

  const fetchAging = useCallback(async () => {
    setIsLoading(true);
    try {
      const [ar, ap] = await Promise.all([api.get("/reports/aging/ar"), api.get("/reports/aging/ap")]);
      if (ar.data.success) {
        setArRows(ar.data.data.rows);
        setArTotals(ar.data.data.totals);
      }
      if (ap.data.success) {
        setApRows(ap.data.data.rows);
        setApTotals(ap.data.data.totals);
      }
    } catch (err) {
      console.error("Failed to fetch aging report:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAging();
  }, [fetchAging]);

  const totals = tab === "ar" ? arTotals : apTotals;
  const rows = tab === "ar" ? arRows : apRows;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-secondary-900 dark:text-secondary-50">
            AP/AR Aging Analysis
          </h2>
          <p className="text-secondary-500 dark:text-secondary-400 mt-1">
            How much is outstanding, and how overdue it is - customer invoices (AR) and vendor bills (AP).
          </p>
        </div>
        <Button variant="outline" onClick={fetchAging} className="flex items-center">
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      <div className="flex gap-2">
        <Button variant={tab === "ar" ? "primary" : "outline"} onClick={() => setTab("ar")}>
          Accounts Receivable
        </Button>
        <Button variant={tab === "ap" ? "primary" : "outline"} onClick={() => setTab("ap")}>
          Accounts Payable
        </Button>
      </div>

      <div className="grid gap-4 grid-cols-2 md:grid-cols-6">
        {(["current", "days1to30", "days31to60", "days61to90", "days90plus", "total"] as const).map((key) => (
          <Card key={key}>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold text-secondary-500">
                {key === "total" ? "Total Outstanding" : BUCKET_LABELS[key]}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`text-lg font-bold ${key === "total" ? "text-primary-600 dark:text-primary-400" : "text-secondary-900 dark:text-secondary-50"}`}>
                {formatCurrency(totals[key])}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <Clock className="mr-2 h-5 w-5 text-primary-600 dark:text-primary-400" />
            {tab === "ar" ? "Outstanding Invoices" : "Outstanding Vendor Bills"}
          </CardTitle>
          <CardDescription>
            {tab === "ar"
              ? "Balance due (not the original total) for every SENT or PARTIALLY_PAID invoice."
              : "Full amount for every UNPAID vendor bill."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-8 text-center text-secondary-500">Loading...</div>
          ) : rows.length === 0 ? (
            <div className="py-12 text-center text-secondary-500 text-sm">
              Nothing outstanding right now.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tab === "ar" ? "Invoice #" : "Bill #"}</TableHead>
                  <TableHead>{tab === "ar" ? "Customer" : "Vendor"}</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead>Days Overdue</TableHead>
                  <TableHead>Bucket</TableHead>
                  <TableHead>Balance Due</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tab === "ar"
                  ? arRows.map((r) => (
                      <TableRow key={r.invoiceId}>
                        <TableCell className="font-medium">{r.invoiceNumber}</TableCell>
                        <TableCell>{r.customerName}</TableCell>
                        <TableCell className="text-xs text-secondary-500">{new Date(r.dueDate).toLocaleDateString()}</TableCell>
                        <TableCell className={r.daysOverdue > 0 ? "text-red-600 dark:text-red-400" : "text-secondary-500"}>
                          {r.daysOverdue > 0 ? `${r.daysOverdue}d` : "-"}
                        </TableCell>
                        <TableCell className="text-xs">{BUCKET_LABELS[r.bucket]}</TableCell>
                        <TableCell className="font-semibold">{formatCurrency(r.balanceDue)}</TableCell>
                      </TableRow>
                    ))
                  : apRows.map((r) => (
                      <TableRow key={r.billId}>
                        <TableCell className="font-medium">{r.billNumber}</TableCell>
                        <TableCell>{r.vendorName}</TableCell>
                        <TableCell className="text-xs text-secondary-500">{new Date(r.dueDate).toLocaleDateString()}</TableCell>
                        <TableCell className={r.daysOverdue > 0 ? "text-red-600 dark:text-red-400" : "text-secondary-500"}>
                          {r.daysOverdue > 0 ? `${r.daysOverdue}d` : "-"}
                        </TableCell>
                        <TableCell className="text-xs">{BUCKET_LABELS[r.bucket]}</TableCell>
                        <TableCell className="font-semibold">{formatCurrency(r.balanceDue)}</TableCell>
                      </TableRow>
                    ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
