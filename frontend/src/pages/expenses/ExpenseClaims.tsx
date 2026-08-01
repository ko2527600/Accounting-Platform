import { useState, useEffect, useCallback } from "react";
import { Receipt, PlusCircle, CheckCircle2, XCircle, Wallet } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../../components/ui/Card";
import { api } from "../../lib/api";
import { useAuth } from "../../contexts/AuthContext";
import { useToast } from "../../contexts/ToastContext";

interface ExpenseAccount {
  id: string;
  code: string;
  name: string;
  type: string;
}

interface ExpenseClaim {
  id: string;
  claimNumber: string;
  submittedByName: string;
  category: string;
  description: string;
  amount: string;
  currency: string;
  expenseDate: string;
  status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "REIMBURSED";
  createdAt: string;
}

const statusColor: Record<string, string> = {
  PENDING_APPROVAL: "text-amber-600",
  APPROVED: "text-emerald-600",
  REJECTED: "text-red-600",
  REIMBURSED: "text-primary-600",
};

// Accountant/Admin (and custom worker titles the backend treats as
// full-operational-access) can decide/reimburse; Viewer/Auditor/HR cannot -
// mirrors the same requireRole('Accountant') gate the backend enforces, so
// the buttons don't render a false promise for roles the API would reject.
const RESTRICTED_DECIDER_ROLES = new Set(["viewer", "auditor", "hr"]);

export function ExpenseClaims() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const canDecide = !RESTRICTED_DECIDER_ROLES.has((user?.role || "").toLowerCase().trim());

  const [claims, setClaims] = useState<ExpenseClaim[]>([]);
  const [expenseAccounts, setExpenseAccounts] = useState<ExpenseAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  const [form, setForm] = useState({
    category: "",
    description: "",
    amount: "",
    currency: "USD",
    expenseDate: new Date().toISOString().split("T")[0],
    expenseAccountId: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchClaims = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.get("/expense-claims", { params: showAll ? {} : { mine: "true" } });
      if (res.data.success) setClaims(res.data.data.expenseClaims);
    } catch (err) {
      console.error("Failed to load expense claims:", err);
    } finally {
      setIsLoading(false);
    }
  }, [showAll]);

  useEffect(() => {
    fetchClaims();
  }, [fetchClaims]);

  useEffect(() => {
    api
      .get("/accounts")
      .then((res) => {
        if (res.data.success) {
          setExpenseAccounts(res.data.data.accounts.filter((a: any) => a.type === "EXPENSE"));
        }
      })
      .catch((err) => console.error("Failed to load expense accounts:", err));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const res = await api.post("/expense-claims", {
        category: form.category,
        description: form.description,
        amount: Number(form.amount),
        currency: form.currency,
        expenseDate: form.expenseDate,
        ...(form.expenseAccountId ? { expenseAccountId: form.expenseAccountId } : {}),
      });
      if (res.data.success) {
        showToast(`Expense claim ${res.data.data.expenseClaim.claimNumber} submitted for approval.`, "success");
        setForm({ category: "", description: "", amount: "", currency: form.currency, expenseDate: form.expenseDate, expenseAccountId: "" });
        fetchClaims();
      }
    } catch (err: any) {
      showToast(err.response?.data?.error || "Failed to submit expense claim.", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDecide = async (id: string, decision: "APPROVE" | "REJECT") => {
    try {
      const res = await api.post(`/expense-claims/${id}/decide`, { decision });
      if (res.data.success) {
        showToast(`Claim ${decision === "APPROVE" ? "approved" : "rejected"}.`, "success");
        fetchClaims();
      }
    } catch (err: any) {
      showToast(err.response?.data?.error || "Failed to record decision.", "error");
    }
  };

  const handleReimburse = async (id: string) => {
    try {
      const res = await api.post(`/expense-claims/${id}/reimburse`);
      if (res.data.success) {
        showToast("Claim reimbursed - journal entry posted.", "success");
        fetchClaims();
      }
    } catch (err: any) {
      showToast(err.response?.data?.error || "Failed to reimburse claim.", "error");
    }
  };

  const formatCurrency = (amt: number, curr = "USD") =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: curr }).format(amt);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-4xl mx-auto">
      <div>
        <h2 className="text-3xl font-bold tracking-tight text-secondary-900 dark:text-secondary-50">Expense Claims</h2>
        <p className="text-secondary-500 dark:text-secondary-400 mt-1">
          File out-of-pocket expenses for reimbursement - each claim goes through the same approval engine used for
          journal entries and invoices.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center">
              <Receipt className="mr-2 h-5 w-5 text-primary-600" />
              {showAll ? "All Claims" : "My Claims"}
            </span>
            {canDecide && (
              <button
                onClick={() => setShowAll(!showAll)}
                className="text-xs font-medium text-primary-600 hover:text-primary-700"
              >
                {showAll ? "Show only my claims" : "Show all claims"}
              </button>
            )}
          </CardTitle>
          <CardDescription>
            Unpaid claims require approval before they can be reimbursed - a real Expense/Cash journal entry is posted
            only on reimbursement.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-xs text-secondary-500 py-4 text-center">Loading...</div>
          ) : claims.length === 0 ? (
            <div className="text-xs text-secondary-500 py-4 text-center">No expense claims yet.</div>
          ) : (
            <div className="space-y-3">
              {claims.map((c) => (
                <div key={c.id} className="p-3 border border-secondary-200 dark:border-secondary-800 rounded-lg text-xs space-y-2">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-semibold text-secondary-900 dark:text-secondary-50">
                        {c.claimNumber} - {c.category}
                      </div>
                      <div className="text-secondary-500 mt-0.5">
                        {c.description} - {c.submittedByName} - {new Date(c.expenseDate).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-secondary-900 dark:text-secondary-50">
                        {formatCurrency(Number(c.amount), c.currency)}
                      </div>
                      <span className={`font-semibold ${statusColor[c.status]}`}>{c.status.replace("_", " ")}</span>
                    </div>
                  </div>
                  {canDecide && c.status === "PENDING_APPROVAL" && (
                    <div className="flex justify-end gap-2 pt-1">
                      <Button variant="outline" size="sm" className="text-xs text-emerald-600" onClick={() => handleDecide(c.id, "APPROVE")}>
                        <CheckCircle2 className="mr-1 h-3 w-3" /> Approve
                      </Button>
                      <Button variant="outline" size="sm" className="text-xs text-red-600" onClick={() => handleDecide(c.id, "REJECT")}>
                        <XCircle className="mr-1 h-3 w-3" /> Reject
                      </Button>
                    </div>
                  )}
                  {canDecide && c.status === "APPROVED" && (
                    <div className="flex justify-end pt-1">
                      <Button variant="primary" size="sm" className="text-xs" onClick={() => handleReimburse(c.id)}>
                        <Wallet className="mr-1 h-3 w-3" /> Reimburse
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <PlusCircle className="mr-2 h-5 w-5 text-primary-600" />
              File a New Claim
            </CardTitle>
            <CardDescription>Any team member can submit a claim for their own spend.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Category</label>
                <Input
                  required
                  placeholder="Travel, Supplies, Meals..."
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Expense Date</label>
                <Input
                  type="date"
                  required
                  value={form.expenseDate}
                  onChange={(e) => setForm({ ...form, expenseDate: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Description</label>
              <Input
                required
                placeholder="Taxi to client meeting"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Amount</label>
                <Input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  placeholder="0.00"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Currency</label>
                <select
                  className="w-full h-10 px-3 rounded-md border border-secondary-300 bg-white dark:bg-secondary-800 text-secondary-900 dark:text-secondary-50"
                  value={form.currency}
                  onChange={(e) => setForm({ ...form, currency: e.target.value })}
                >
                  <option value="USD">USD ($)</option>
                  <option value="GHS">GHS (GH₵)</option>
                  <option value="EUR">EUR (€)</option>
                  <option value="GBP">GBP (£)</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Expense Account</label>
                <select
                  className="w-full h-10 px-3 rounded-md border border-secondary-300 bg-white dark:bg-secondary-800 text-secondary-900 dark:text-secondary-50"
                  value={form.expenseAccountId}
                  onChange={(e) => setForm({ ...form, expenseAccountId: e.target.value })}
                >
                  <option value="">Use default expense account</option>
                  {expenseAccounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.code} - {a.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </CardContent>
          <CardFooter>
            <Button type="submit" variant="primary" disabled={isSubmitting}>
              {isSubmitting ? "Submitting..." : "Submit Claim"}
            </Button>
          </CardFooter>
        </Card>
      </form>
    </div>
  );
}
