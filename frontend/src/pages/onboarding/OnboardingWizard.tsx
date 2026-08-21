import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Rocket,
  CheckCircle2,
  Circle,
  Building2,
  BookOpen,
  Scale,
  PlusCircle,
  Trash2,
  ArrowRight,
  ShoppingCart,
  FileText,
  Package,
} from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../../components/ui/Card";
import { api } from "../../lib/api";
import { useToast } from "../../contexts/ToastContext";
import { useAuth } from "../../contexts/AuthContext";

interface OnboardingChecklist {
  businessProfileComplete: boolean;
  chartOfAccountsReady: boolean;
  openingBalancesPosted: boolean;
  firstTransactionRecorded: boolean;
}

interface OnboardingStatus {
  businessType: string | null;
  vatRegistered: boolean;
  graTin: string | null;
  baseCurrency: string;
  isLive: boolean;
  accountCount: number;
  checklist: OnboardingChecklist;
}

interface TemplateAccount {
  code: string;
  name: string;
  type: string;
}

interface AccountOption {
  id: string;
  code: string;
  name: string;
  type: string;
}

interface OpeningBalanceRow {
  accountId: string;
  code: string;
  name: string;
  debit: string;
  credit: string;
}

const BUSINESS_TYPES = [
  "Retail Shop / Boutique",
  "Wholesale / Distributor",
  "Service Business / Agency",
  "Sole Proprietor",
  "Partnership",
  "Limited Company",
  "NGO / Nonprofit",
];

// Steps shown to NGO / Nonprofit workspaces (full accounting setup).
const STEPS_FULL = [
  { key: "profile", label: "Business Profile", icon: Building2 },
  { key: "accounts", label: "Chart of Accounts", icon: BookOpen },
  { key: "balances", label: "Opening Balances", icon: Scale },
] as const;

// Steps shown to retail / business workspaces (simplified quick-start).
const STEPS_SIMPLE = [
  { key: "profile", label: "Business Profile", icon: Building2 },
  { key: "ready", label: "Ready to Go", icon: Rocket },
] as const;

type StepKey = "profile" | "accounts" | "balances" | "ready";

export function OnboardingWizard() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { user } = useAuth();

  // NONPROFIT orgType gets the full wizard (accounts + balances).
  // All other org types (BUSINESS) get the quick-start path.
  const isNonprofit = user?.orgType === "NONPROFIT";
  const steps = isNonprofit ? STEPS_FULL : STEPS_SIMPLE;

  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [activeStep, setActiveStep] = useState<StepKey>("profile");

  // Step 1: Business Profile
  const [businessType, setBusinessType] = useState(BUSINESS_TYPES[0]);
  const [vatRegistered, setVatRegistered] = useState(false);
  const [graTin, setGraTin] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  // Step 2 (nonprofit only): Chart of Accounts
  const [templateAccounts, setTemplateAccounts] = useState<TemplateAccount[]>([]);
  const [seedingAccounts, setSeedingAccounts] = useState(false);

  // Step 3 (nonprofit only): Opening Balances
  const [balanceRows, setBalanceRows] = useState<OpeningBalanceRow[]>([]);
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().split("T")[0]);
  const [openingBalanceError, setOpeningBalanceError] = useState<string | null>(null);
  const [postingBalances, setPostingBalances] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await api.get("/onboarding/status");
      const data: OnboardingStatus = res.data.data;
      setStatus(data);
      if (data.businessType) setBusinessType(data.businessType);
      setVatRegistered(data.vatRegistered);
      setGraTin(data.graTin || "");
    } catch {
      showToast("Failed to load onboarding status.", "error");
    }
  }, [showToast]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    if (activeStep === "accounts" && templateAccounts.length === 0) {
      api
        .get("/onboarding/chart-of-accounts-template")
        .then((res) => setTemplateAccounts(res.data.data))
        .catch(() => showToast("Failed to load the default chart of accounts template.", "error"));
    }
    if (activeStep === "balances") {
      api
        .get("/accounts")
        .then((res) => {
          const accounts: AccountOption[] = res.data.data.accounts;
          setBalanceRows((prev) => {
            const existing = new Map(prev.map((r) => [r.accountId, r]));
            return accounts.map((a) => {
              const found = existing.get(a.id);
              return found || { accountId: a.id, code: a.code, name: a.name, debit: "", credit: "" };
            });
          });
        })
        .catch(() => showToast("Failed to load chart of accounts.", "error"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStep]);

  const handleSaveProfile = async () => {
    setSavingProfile(true);
    try {
      const res = await api.put("/onboarding/business-profile", { businessType, vatRegistered, graTin });
      setStatus(res.data.data);
      showToast("Business profile saved.", "success");
      // Nonprofits need a chart of accounts and opening balances before going
      // live. Retail/business workspaces can start selling immediately.
      setActiveStep(isNonprofit ? "accounts" : "ready");
    } catch (err: any) {
      showToast(err.response?.data?.error || "Failed to save business profile.", "error");
    } finally {
      setSavingProfile(false);
    }
  };

  const updateTemplateRow = (index: number, field: keyof TemplateAccount, value: string) => {
    setTemplateAccounts((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  };

  const removeTemplateRow = (index: number) => {
    setTemplateAccounts((prev) => prev.filter((_, i) => i !== index));
  };

  const addTemplateRow = () => {
    setTemplateAccounts((prev) => [...prev, { code: "", name: "", type: "ASSET" }]);
  };

  const handleSeedAccounts = async () => {
    setSeedingAccounts(true);
    try {
      const res = await api.post("/onboarding/chart-of-accounts/seed", { accounts: templateAccounts });
      showToast(`Created ${res.data.data.created} account(s).`, "success");
      await fetchStatus();
      setActiveStep("balances");
    } catch (err: any) {
      showToast(err.response?.data?.error || "Failed to create chart of accounts.", "error");
    } finally {
      setSeedingAccounts(false);
    }
  };

  const totals = useMemo(() => {
    let debit = 0;
    let credit = 0;
    for (const row of balanceRows) {
      debit += Number(row.debit) || 0;
      credit += Number(row.credit) || 0;
    }
    return { debit, credit, diff: Math.round((debit - credit) * 100) / 100 };
  }, [balanceRows]);

  const isBalanced = totals.diff === 0 && (totals.debit > 0 || totals.credit > 0);

  const updateBalanceRow = (accountId: string, field: "debit" | "credit", value: string) => {
    setBalanceRows((prev) =>
      prev.map((row) =>
        row.accountId === accountId
          ? { ...row, [field]: value, ...(field === "debit" ? { credit: "" } : { debit: "" }) }
          : row
      )
    );
  };

  const handlePostOpeningBalances = async () => {
    setOpeningBalanceError(null);
    setPostingBalances(true);
    try {
      const lines = balanceRows
        .filter((r) => Number(r.debit) > 0 || Number(r.credit) > 0)
        .map((r) => ({ accountId: r.accountId, debit: Number(r.debit) || 0, credit: Number(r.credit) || 0 }));

      const res = await api.post("/onboarding/opening-balances", { asOfDate, lines });
      showToast(`Opening balances posted (${res.data.data.entryNumber}). You're live!`, "success");
      await fetchStatus();
    } catch (err: any) {
      // The hard gate: the backend's exact "Total Debits (X) must equal
      // Total Credits (Y)" message is shown as-is - no client-side override
      // that could let a mismatched entry through with a softer warning.
      setOpeningBalanceError(err.response?.data?.error || "Failed to post opening balances.");
    } finally {
      setPostingBalances(false);
    }
  };

  if (!status) {
    return <div className="flex items-center justify-center h-64 text-secondary-500">Loading setup wizard...</div>;
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-4xl mx-auto">
      <div>
        <h2 className="text-3xl font-bold tracking-tight text-secondary-900 dark:text-secondary-50 flex items-center">
          <Rocket className="mr-2 h-7 w-7 text-primary-600" />
          Guided Setup
        </h2>
        <p className="text-secondary-500 dark:text-secondary-400 mt-1">
          {isNonprofit
            ? "Set up your fund accounts and opening balances to go live."
            : "Confirm your business profile and you're ready to start selling."}
        </p>
      </div>

      {/* Completion checklist */}
      <Card>
        <CardContent className="py-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Business Profile", done: status.checklist.businessProfileComplete },
              { label: "Chart of Accounts", done: status.checklist.chartOfAccountsReady },
              { label: "Opening Balances", done: status.checklist.openingBalancesPosted },
              { label: "First Transaction", done: status.checklist.firstTransactionRecorded },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-2 text-xs">
                {item.done ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0" />
                ) : (
                  <Circle className="h-4 w-4 text-secondary-300 flex-shrink-0" />
                )}
                <span className={item.done ? "text-secondary-700 dark:text-secondary-300" : "text-secondary-400"}>
                  {item.label}
                </span>
              </div>
            ))}
          </div>
          {status.isLive && (
            <div className="mt-3 text-xs font-semibold text-emerald-600 flex items-center">
              <CheckCircle2 className="mr-1.5 h-4 w-4" />
              You're live - debits equal credits and your books are ready to use.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Step tabs — simplified for business, full for nonprofit */}
      <div className="flex border-b border-secondary-200 dark:border-secondary-800 space-x-6">
        {steps.map((step) => (
          <button
            key={step.key}
            onClick={() => setActiveStep(step.key as StepKey)}
            className={`pb-3 text-sm font-medium transition-colors border-b-2 flex items-center ${
              activeStep === step.key
                ? "border-primary-600 text-primary-600"
                : "border-transparent text-secondary-500 hover:text-secondary-700"
            }`}
          >
            <step.icon className="mr-2 h-4 w-4" />
            {step.label}
          </button>
        ))}
      </div>

      {activeStep === "profile" && (
        <Card>
          <CardHeader>
            <CardTitle>Tell us about your business</CardTitle>
            <CardDescription>This drives which defaults and tax behavior make sense for you.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Business Type</label>
              <select
                value={businessType}
                onChange={(e) => setBusinessType(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-secondary-300 dark:border-secondary-700 bg-white dark:bg-secondary-900 text-sm"
              >
                {BUSINESS_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <label className="flex items-center space-x-2 p-3 bg-secondary-50 dark:bg-secondary-900 rounded-lg border border-secondary-200 dark:border-secondary-800 cursor-pointer">
              <input type="checkbox" checked={vatRegistered} onChange={(e) => setVatRegistered(e.target.checked)} className="h-4 w-4" />
              <span className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">
                Registered for VAT with the Ghana Revenue Authority (GRA)
              </span>
            </label>
            {vatRegistered && (
              <div className="space-y-2">
                <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">GRA TIN (optional)</label>
                <Input value={graTin} onChange={(e) => setGraTin(e.target.value)} placeholder="e.g. TIN-0000000000" />
              </div>
            )}
          </CardContent>
          <CardFooter>
            <Button type="button" variant="primary" onClick={handleSaveProfile} disabled={savingProfile}>
              {savingProfile ? "Saving..." : "Save & Continue"}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </CardFooter>
        </Card>
      )}

      {/* Quick-start panel shown to business/retail workspaces after profile step */}
      {activeStep === "ready" && (
        <Card className="border-emerald-200 dark:border-emerald-900">
          <CardHeader>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-6 w-6 text-emerald-500" />
              <CardTitle>You're all set — start using Ledgio</CardTitle>
            </div>
            <CardDescription>
              Your workspace is ready. The accounting engine runs in the background — just start selling and
              recording. You can set up a chart of accounts and opening balances from Settings when you need them.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <button
                type="button"
                onClick={() => navigate("/pos")}
                className="flex flex-col items-center gap-2 rounded-xl border border-secondary-200 dark:border-secondary-700 p-5 text-center hover:border-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors"
              >
                <ShoppingCart className="h-8 w-8 text-primary-600" aria-hidden="true" />
                <span className="text-sm font-semibold text-secondary-900 dark:text-secondary-100">Make a Sale</span>
                <span className="text-xs text-secondary-500">Open the till and record sales</span>
              </button>
              <button
                type="button"
                onClick={() => navigate("/invoices")}
                className="flex flex-col items-center gap-2 rounded-xl border border-secondary-200 dark:border-secondary-700 p-5 text-center hover:border-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors"
              >
                <FileText className="h-8 w-8 text-primary-600" aria-hidden="true" />
                <span className="text-sm font-semibold text-secondary-900 dark:text-secondary-100">Send an Invoice</span>
                <span className="text-xs text-secondary-500">Bill a customer on credit</span>
              </button>
              <button
                type="button"
                onClick={() => navigate("/inventory")}
                className="flex flex-col items-center gap-2 rounded-xl border border-secondary-200 dark:border-secondary-700 p-5 text-center hover:border-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors"
              >
                <Package className="h-8 w-8 text-primary-600" aria-hidden="true" />
                <span className="text-sm font-semibold text-secondary-900 dark:text-secondary-100">Add Stock</span>
                <span className="text-xs text-secondary-500">Load your products and inventory</span>
              </button>
            </div>
          </CardContent>
          <CardFooter className="flex justify-between">
            <Button type="button" variant="outline" onClick={() => navigate("/dashboard")}>
              Go to Dashboard
            </Button>
            <Button type="button" variant="ghost" onClick={() => setActiveStep("profile")} className="text-xs text-secondary-400">
              Edit business profile
            </Button>
          </CardFooter>
        </Card>
      )}

      {activeStep === "accounts" && (
        <Card>
          <CardHeader>
            <CardTitle>Chart of Accounts</CardTitle>
            <CardDescription>
              A starting chart of accounts for a typical Ghana SME - fully editable below, and again anytime from
              Chart of Accounts after setup.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-h-96 overflow-y-auto border border-secondary-200 dark:border-secondary-800 rounded-lg">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-white dark:bg-secondary-900">
                  <tr className="text-left text-secondary-500 border-b border-secondary-200 dark:border-secondary-800">
                    <th className="py-2 px-2 w-24">Code</th>
                    <th className="py-2 px-2">Name</th>
                    <th className="py-2 px-2 w-36">Type</th>
                    <th className="py-2 px-2 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {templateAccounts.map((row, i) => (
                    <tr key={i} className="border-b border-secondary-100 dark:border-secondary-800">
                      <td className="py-1 px-2">
                        <Input value={row.code} onChange={(e) => updateTemplateRow(i, "code", e.target.value)} className="h-8 text-xs" />
                      </td>
                      <td className="py-1 px-2">
                        <Input value={row.name} onChange={(e) => updateTemplateRow(i, "name", e.target.value)} className="h-8 text-xs" />
                      </td>
                      <td className="py-1 px-2">
                        <select
                          value={row.type}
                          onChange={(e) => updateTemplateRow(i, "type", e.target.value)}
                          className="w-full h-8 px-2 rounded border border-secondary-300 dark:border-secondary-700 bg-white dark:bg-secondary-900 text-xs"
                        >
                          <option value="ASSET">Asset</option>
                          <option value="LIABILITY">Liability</option>
                          <option value="EQUITY">Equity</option>
                          <option value="REVENUE">Revenue</option>
                          <option value="COST_OF_SALES">Cost of Sales</option>
                          <option value="EXPENSE">Expense</option>
                        </select>
                      </td>
                      <td className="py-1 px-2 text-center">
                        <button onClick={() => removeTemplateRow(i)} aria-label="Remove account" className="text-secondary-400 hover:text-red-600">
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Button type="button" variant="outline" onClick={addTemplateRow} className="mt-3 text-xs h-8">
              <PlusCircle className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              Add Account
            </Button>
          </CardContent>
          <CardFooter>
            <Button type="button" variant="primary" onClick={handleSeedAccounts} disabled={seedingAccounts || templateAccounts.length === 0}>
              {seedingAccounts ? "Creating..." : `Create ${templateAccounts.length} Account(s) & Continue`}
              <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
            </Button>
          </CardFooter>
        </Card>
      )}

      {activeStep === "balances" && (
        <Card>
          <CardHeader>
            <CardTitle>Opening Balances</CardTitle>
            <CardDescription>
              Enter each account's starting balance as a debit or credit. Debits must equal credits exactly before you
              can go live - this is enforced by the server, not just this form.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2 max-w-xs">
              <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">As Of Date</label>
              <Input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} />
            </div>

            {openingBalanceError && (
              <div className="p-2.5 bg-red-100 text-red-950 rounded text-xs font-medium">{openingBalanceError}</div>
            )}

            <div className="max-h-96 overflow-y-auto border border-secondary-200 dark:border-secondary-800 rounded-lg">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-white dark:bg-secondary-900">
                  <tr className="text-left text-secondary-500 border-b border-secondary-200 dark:border-secondary-800">
                    <th className="py-2 px-2">Account</th>
                    <th className="py-2 px-2 w-32 text-right">Debit</th>
                    <th className="py-2 px-2 w-32 text-right">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {balanceRows.map((row) => (
                    <tr key={row.accountId} className="border-b border-secondary-100 dark:border-secondary-800">
                      <td className="py-1 px-2">{row.code} - {row.name}</td>
                      <td className="py-1 px-2">
                        <Input
                          type="number"
                          value={row.debit}
                          onChange={(e) => updateBalanceRow(row.accountId, "debit", e.target.value)}
                          className="h-8 text-xs text-right"
                          placeholder="0.00"
                        />
                      </td>
                      <td className="py-1 px-2">
                        <Input
                          type="number"
                          value={row.credit}
                          onChange={(e) => updateBalanceRow(row.accountId, "credit", e.target.value)}
                          className="h-8 text-xs text-right"
                          placeholder="0.00"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className={`p-3 rounded-lg border text-xs font-semibold flex justify-between ${
              isBalanced
                ? "bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-400"
                : "bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900 text-amber-700 dark:text-amber-400"
            }`}>
              <span>Total Debits: {totals.debit.toFixed(2)}</span>
              <span>Total Credits: {totals.credit.toFixed(2)}</span>
              <span>{isBalanced ? "Balanced" : `Out of balance by ${Math.abs(totals.diff).toFixed(2)}`}</span>
            </div>
          </CardContent>
          <CardFooter>
            <Button type="button" variant="primary" onClick={handlePostOpeningBalances} disabled={postingBalances || !isBalanced}>
              {postingBalances ? "Posting..." : "Post Opening Balances & Go Live"}
            </Button>
          </CardFooter>
        </Card>
      )}

      {status.checklist.openingBalancesPosted && !status.checklist.firstTransactionRecorded && (
        <Card className="border-primary-200 bg-primary-50/20 dark:bg-primary-950/10">
          <CardContent className="py-4 flex items-center justify-between">
            <p className="text-sm text-secondary-700 dark:text-secondary-300">
              You're live. Record your first real transaction to finish setup.
            </p>
            <Button type="button" variant="primary" onClick={() => navigate("/journals/new")}>
              Record First Transaction
              <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
