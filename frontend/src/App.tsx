import { useEffect, useRef } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import { ToastProvider, useToast } from "./contexts/ToastContext";
import { api } from "./lib/api";
import { TenantSettingsProvider, useTenantSettings } from "./contexts/TenantSettingsContext";
import { useSyncEngineLifecycle } from "./hooks/useSyncEngineLifecycle";
import { usePresenceLifecycle } from "./hooks/usePresenceLifecycle";
import { SETTINGS_RESTRICTED_ROLES, getVisibleHrefs } from "./lib/navigation";
import { MainLayout } from "./components/layout/MainLayout";
import { Card, CardHeader, CardTitle, CardContent } from "./components/ui/Card";
import { Button } from "./components/ui/Button";
import { CommandMenu } from "./components/ui/CommandMenu";
import { Login } from "./pages/auth/Login";
import { Register } from "./pages/auth/Register";
import { AcceptInvitation } from "./pages/auth/AcceptInvitation";
import { Verification } from "./pages/auth/Verification";
import { LandingPage } from "./pages/landing/LandingPage";
import { FeaturesPage } from "./pages/landing/FeaturesPage";
import { HowItWorksPage } from "./pages/landing/HowItWorksPage";
import { LegalHubPage } from "./pages/legal/LegalHubPage";
import { LegalDocumentPage } from "./pages/legal/LegalDocumentPage";
import { AdminCoreEngine } from "./pages/admin/AdminCoreEngine";
import { ChartOfAccounts } from "./pages/accounts/ChartOfAccounts";
import { OnboardingWizard } from "./pages/onboarding/OnboardingWizard";
import { Settings } from "./pages/settings/Settings";
import { TaxRates } from "./pages/settings/TaxRates";
import { Funds } from "./pages/settings/Funds";
import { FiscalPeriods } from "./pages/settings/FiscalPeriods";
import { RecurringTransactions } from "./pages/settings/RecurringTransactions";
import { Approvals } from "./pages/approvals/Approvals";
import { ExpenseClaims } from "./pages/expenses/ExpenseClaims";
import { Budgets } from "./pages/reports/Budgets";
import { TeamManagement } from "./pages/team/TeamManagement";
import { AuditLogs } from "./pages/audit/AuditLogs";
import { HelpAssistantActivity } from "./pages/help/HelpAssistantActivity";
import { FeedbackInbox } from "./pages/feedback/FeedbackInbox";
import { BulkImportWizard } from "./pages/import/BulkImportWizard";
import { BankReconciliation } from "./pages/banking/BankReconciliation";
import { Invoices } from "./pages/invoices/Invoices";
import { VendorBills } from "./pages/bills/VendorBills";
import { WarehouseManagement } from "./pages/inventory/WarehouseManagement";
import { PointOfSale } from "./pages/pos/PointOfSale";
import { InventoryIntelligence } from "./pages/analytics/InventoryIntelligence";
import { ExecutiveReports } from "./pages/reports/ExecutiveReports";
import { JournalList } from "./pages/journals/JournalList";
import { JournalBuilder } from "./components/journals/JournalBuilder";
import { ContraVoucher } from "./pages/journals/ContraVoucher";
import { GeneralLedger } from "./pages/reports/GeneralLedger";
import { ProfitAndLoss } from "./pages/reports/ProfitAndLoss";
import { BalanceSheet } from "./pages/reports/BalanceSheet";
import { CashFlowStatement } from "./pages/reports/CashFlowStatement";
import { CashFlowForecast } from "./pages/reports/CashFlowForecast";
import { KpiDashboard } from "./pages/reports/KpiDashboard";
import { AgingReport } from "./pages/reports/AgingReport";
import { SalesChannelReport } from "./pages/reports/SalesChannelReport";
import { PettyCash } from "./pages/pettycash/PettyCash";
import { PurchaseOrders } from "./pages/purchaseorders/PurchaseOrders";
import { RecurringInvoices } from "./pages/recurringinvoices/RecurringInvoices";
import { FixedAssets } from "./pages/fixedassets/FixedAssets";
import { useProfitAndLoss } from "./hooks/useProfitAndLoss";
import { useAccounts } from "./hooks/useAccounts";

// Pages
const Dashboard = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast } = useToast();
  const { totalRevenue, totalExpense, netIncome, refetch: refetchPnL } = useProfitAndLoss();
  const { accounts } = useAccounts();
  const { settings } = useTenantSettings();

  // Roles with a reduced nav (Shop Manager, Cashier, HR, Auditor) don't have
  // backend read access to company-wide P&L/ledger data (rbacMiddleware.ts's
  // scoped-role rules) - the underlying hooks above still fire regardless
  // (rules of hooks), but their 403s are swallowed by the hooks' own
  // catch/console.error, so just skip rendering these cards rather than
  // showing stale/zeroed figures. Also not shown to these roles: financial
  // data they have no operational need for anyway.
  const isRestrictedRole = getVisibleHrefs((user?.role || "").toLowerCase().trim()) !== null;

  // One-time self-heal for tenants with POS sales recorded before revenue
  // posting existed (see routes/cashTill.ts POST /tills/sales) - an old
  // COMPLETED sale's journalId stays null forever unless something actively
  // backfills it, so a returning Admin/Accountant would otherwise see a
  // permanently-understated Total Revenue with no way to fix it themselves.
  // Idempotent on the backend (already-posted sales are skipped), and this
  // ref guards against firing more than once per mount (StrictMode's double
  // effect included) - not per every render.
  const backfillAttempted = useRef(false);
  useEffect(() => {
    if (isRestrictedRole || backfillAttempted.current) return;
    backfillAttempted.current = true;
    api.post('/tills/backfill-revenue')
      .then((response) => {
        const { backfilled } = response.data?.data || {};
        if (backfilled > 0) {
          showToast(
            `Synced ${backfilled} POS sale${backfilled === 1 ? '' : 's'} recorded before revenue tracking was fixed - your totals are now up to date.`,
            'success'
          );
          refetchPnL();
        }
      })
      .catch((error) => {
        // Non-Admin/Accountant roles 403 here (route is role-gated) - not an
        // error worth surfacing, same silent-skip as the other company-wide
        // hooks on this page for restricted roles.
        console.error('Failed to check for missing POS revenue postings:', error);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRestrictedRole]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: settings.baseCurrency,
    }).format(amount);
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-secondary-900 dark:text-secondary-50">
            Dashboard
          </h2>
          <p className="text-secondary-500 dark:text-secondary-400 mt-1">
            Welcome back. Here's what's happening with your accounts today.
          </p>
        </div>
        {!isRestrictedRole && (
          <Button variant="primary" onClick={() => navigate("/journals/new")}>
            New Voucher
          </Button>
        )}
      </div>

      {!isRestrictedRole && (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(totalRevenue)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Expenses</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">{formatCurrency(totalExpense)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Net Profit</CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${netIncome >= 0 ? 'text-primary-600 dark:text-primary-400' : 'text-red-600 dark:text-red-400'}`}>
                {formatCurrency(netIncome)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Active Accounts</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{accounts.length}</div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};

function ProtectedRoute({ children, blockedRoles }: { children: React.ReactNode; blockedRoles?: Set<string> }) {
  const { token, isLoading, user } = useAuth();
  // Also wait on tenant settings (only once a token exists - no point waiting
  // when we're about to redirect to /login anyway) so pages never paint the
  // hardcoded USD default before flipping to the tenant's real currency.
  const { isLoading: settingsLoading } = useTenantSettings();
  const location = useLocation();

  if (isLoading || (token && settingsLoading)) {
    return <div className="min-h-screen flex items-center justify-center bg-secondary-50 dark:bg-secondary-900">Loading...</div>;
  }

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  const role = (user?.role || "").toLowerCase().trim();

  if (blockedRoles && blockedRoles.has(role)) {
    return <Navigate to="/dashboard" replace />;
  }

  // Generic allowlist enforcement for any role with a reduced nav
  // (RESTRICTED_ROLE_NAV in navigation.ts - Shop Manager, Cashier, HR,
  // Auditor) - covers every route automatically, including ones added
  // later, rather than relying on each route remembering to opt into
  // `blockedRoles`. Real enforcement is still server-side (rbacMiddleware);
  // this just keeps a restricted role from landing on a page shell whose
  // every action would 403 anyway.
  const visibleHrefs = getVisibleHrefs(role);
  if (visibleHrefs && !visibleHrefs.has(location.pathname)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

// Mounted once at the app root (not per-route, unlike ProtectedRoute) so the
// local-first sync engine's login/logout lifecycle only fires on an actual
// auth change, never on ordinary navigation between pages.
function SyncEngineLifecycleMount() {
  useSyncEngineLifecycle();
  return null;
}

// Same mounting rationale as SyncEngineLifecycleMount - unconditional for
// every role (not just Admin), since the presence roster needs everyone
// actually connected to be accurate, even though only the Admin-only Team
// Management page displays it.
function PresenceLifecycleMount() {
  usePresenceLifecycle();
  return null;
}

function App() {
  return (
    <ThemeProvider defaultTheme="system" storageKey="accountgo-theme">
      <ToastProvider>
      <AuthProvider>
      <TenantSettingsProvider>
        <SyncEngineLifecycleMount />
        <PresenceLifecycleMount />
        <BrowserRouter>
          <CommandMenu />
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/accept-invite" element={<AcceptInvitation />} />
            <Route path="/verify-account" element={<Verification />} />
            <Route path="/features" element={<FeaturesPage />} />
            <Route path="/how-it-works" element={<HowItWorksPage />} />
            <Route path="/legal" element={<LegalHubPage />} />
            <Route path="/legal/:policyName" element={<LegalDocumentPage />} />
            <Route path="/admin/core-engine" element={<AdminCoreEngine />} />
            
            {/* Protected Routes */}
            <Route path="/dashboard" element={<ProtectedRoute><MainLayout><Dashboard /></MainLayout></ProtectedRoute>} />
            <Route path="/accounts" element={<ProtectedRoute><MainLayout><ChartOfAccounts /></MainLayout></ProtectedRoute>} />
            <Route path="/onboarding" element={<ProtectedRoute blockedRoles={SETTINGS_RESTRICTED_ROLES}><MainLayout><OnboardingWizard /></MainLayout></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute blockedRoles={SETTINGS_RESTRICTED_ROLES}><MainLayout><Settings /></MainLayout></ProtectedRoute>} />
            <Route path="/settings/tax-rates" element={<ProtectedRoute blockedRoles={SETTINGS_RESTRICTED_ROLES}><MainLayout><TaxRates /></MainLayout></ProtectedRoute>} />
            <Route path="/settings/funds" element={<ProtectedRoute blockedRoles={SETTINGS_RESTRICTED_ROLES}><MainLayout><Funds /></MainLayout></ProtectedRoute>} />
            <Route path="/settings/fiscal-periods" element={<ProtectedRoute blockedRoles={SETTINGS_RESTRICTED_ROLES}><MainLayout><FiscalPeriods /></MainLayout></ProtectedRoute>} />
            <Route path="/settings/recurring-transactions" element={<ProtectedRoute blockedRoles={SETTINGS_RESTRICTED_ROLES}><MainLayout><RecurringTransactions /></MainLayout></ProtectedRoute>} />
            <Route path="/approvals" element={<ProtectedRoute><MainLayout><Approvals /></MainLayout></ProtectedRoute>} />
            <Route path="/expenses" element={<ProtectedRoute><MainLayout><ExpenseClaims /></MainLayout></ProtectedRoute>} />
            <Route path="/reports/budgets" element={<ProtectedRoute><MainLayout><Budgets /></MainLayout></ProtectedRoute>} />
            <Route path="/team" element={<ProtectedRoute><MainLayout><TeamManagement /></MainLayout></ProtectedRoute>} />
            <Route path="/audit-logs" element={<ProtectedRoute><MainLayout><AuditLogs /></MainLayout></ProtectedRoute>} />
            <Route path="/help-assistant/activity" element={<ProtectedRoute><MainLayout><HelpAssistantActivity /></MainLayout></ProtectedRoute>} />
            <Route path="/feedback" element={<ProtectedRoute><MainLayout><FeedbackInbox /></MainLayout></ProtectedRoute>} />
            <Route path="/import" element={<ProtectedRoute><MainLayout><BulkImportWizard /></MainLayout></ProtectedRoute>} />
            <Route path="/banking" element={<ProtectedRoute><MainLayout><BankReconciliation /></MainLayout></ProtectedRoute>} />
            <Route path="/invoices" element={<ProtectedRoute><MainLayout><Invoices /></MainLayout></ProtectedRoute>} />
            <Route path="/bills" element={<ProtectedRoute><MainLayout><VendorBills /></MainLayout></ProtectedRoute>} />
            <Route path="/inventory" element={<ProtectedRoute><MainLayout><WarehouseManagement /></MainLayout></ProtectedRoute>} />
            <Route path="/pos" element={<ProtectedRoute><MainLayout><PointOfSale /></MainLayout></ProtectedRoute>} />
            <Route path="/analytics/inventory" element={<ProtectedRoute><MainLayout><InventoryIntelligence /></MainLayout></ProtectedRoute>} />
            <Route path="/reports/executive" element={<ProtectedRoute><MainLayout><ExecutiveReports /></MainLayout></ProtectedRoute>} />
            <Route path="/journals" element={<ProtectedRoute><MainLayout><JournalList /></MainLayout></ProtectedRoute>} />
            <Route path="/journals/new" element={<ProtectedRoute><MainLayout><JournalBuilder /></MainLayout></ProtectedRoute>} />
            <Route path="/journals/contra" element={<ProtectedRoute><MainLayout><ContraVoucher /></MainLayout></ProtectedRoute>} />
            <Route path="/reports/ledger" element={<ProtectedRoute><MainLayout><GeneralLedger /></MainLayout></ProtectedRoute>} />
            <Route path="/reports/pnl" element={<ProtectedRoute><MainLayout><ProfitAndLoss /></MainLayout></ProtectedRoute>} />
            <Route path="/reports/balance-sheet" element={<ProtectedRoute><MainLayout><BalanceSheet /></MainLayout></ProtectedRoute>} />
            <Route path="/reports/cash-flow" element={<ProtectedRoute><MainLayout><CashFlowStatement /></MainLayout></ProtectedRoute>} />
            <Route path="/reports/cash-flow-forecast" element={<ProtectedRoute><MainLayout><CashFlowForecast /></MainLayout></ProtectedRoute>} />
            <Route path="/reports/kpis" element={<ProtectedRoute><MainLayout><KpiDashboard /></MainLayout></ProtectedRoute>} />
            <Route path="/reports/aging" element={<ProtectedRoute><MainLayout><AgingReport /></MainLayout></ProtectedRoute>} />
            <Route path="/reports/sales-channel" element={<ProtectedRoute><MainLayout><SalesChannelReport /></MainLayout></ProtectedRoute>} />
            <Route path="/petty-cash" element={<ProtectedRoute><MainLayout><PettyCash /></MainLayout></ProtectedRoute>} />
            <Route path="/purchase-orders" element={<ProtectedRoute><MainLayout><PurchaseOrders /></MainLayout></ProtectedRoute>} />
            <Route path="/recurring-invoices" element={<ProtectedRoute><MainLayout><RecurringInvoices /></MainLayout></ProtectedRoute>} />
            <Route path="/fixed-assets" element={<ProtectedRoute><MainLayout><FixedAssets /></MainLayout></ProtectedRoute>} />
            <Route path="/reports" element={<Navigate to="/reports/pnl" replace />} />
            
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </TenantSettingsProvider>
      </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}

export default App;
