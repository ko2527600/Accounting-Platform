import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import { MainLayout } from "./components/layout/MainLayout";
import { Card, CardHeader, CardTitle, CardContent } from "./components/ui/Card";
import { Button } from "./components/ui/Button";
import { CommandMenu } from "./components/ui/CommandMenu";
import { Login } from "./pages/auth/Login";
import { Register } from "./pages/auth/Register";
import { AcceptInvitation } from "./pages/auth/AcceptInvitation";
import { Verification } from "./pages/auth/Verification";
import { LandingPage } from "./pages/landing/LandingPage";
import { AdminCoreEngine } from "./pages/admin/AdminCoreEngine";
import { ChartOfAccounts } from "./pages/accounts/ChartOfAccounts";
import { Settings } from "./pages/settings/Settings";
import { TeamManagement } from "./pages/team/TeamManagement";
import { AuditLogs } from "./pages/audit/AuditLogs";
import { BulkImportWizard } from "./pages/import/BulkImportWizard";
import { BankReconciliation } from "./pages/banking/BankReconciliation";
import { Invoices } from "./pages/invoices/Invoices";
import { VendorBills } from "./pages/bills/VendorBills";
import { WarehouseManagement } from "./pages/inventory/WarehouseManagement";
import { InventoryIntelligence } from "./pages/analytics/InventoryIntelligence";
import { ExecutiveReports } from "./pages/reports/ExecutiveReports";
import { JournalList } from "./pages/journals/JournalList";
import { JournalBuilder } from "./components/journals/JournalBuilder";
import { GeneralLedger } from "./pages/reports/GeneralLedger";
import { ProfitAndLoss } from "./pages/reports/ProfitAndLoss";
import { useProfitAndLoss } from "./hooks/useProfitAndLoss";
import { useAccounts } from "./hooks/useAccounts";
import { useTenantSettings } from "./hooks/useTenantSettings";

// Pages
const Dashboard = () => {
  const navigate = useNavigate();
  const { totalRevenue, totalExpense, netIncome } = useProfitAndLoss();
  const { accounts } = useAccounts();
  const { settings } = useTenantSettings();

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
        <Button variant="primary" onClick={() => navigate("/journals/new")}>
          Create Entry
        </Button>
      </div>

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
    </div>
  );
};

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { token, isLoading } = useAuth();
  
  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center bg-secondary-50 dark:bg-secondary-900">Loading...</div>;
  }
  
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  
  return <>{children}</>;
}

function App() {
  return (
    <ThemeProvider defaultTheme="system" storageKey="accountgo-theme">
      <AuthProvider>
        <BrowserRouter>
          <CommandMenu />
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/accept-invite" element={<AcceptInvitation />} />
            <Route path="/verify-account" element={<Verification />} />
            <Route path="/admin/core-engine" element={<AdminCoreEngine />} />
            
            {/* Protected Routes */}
            <Route path="/dashboard" element={<ProtectedRoute><MainLayout><Dashboard /></MainLayout></ProtectedRoute>} />
            <Route path="/accounts" element={<ProtectedRoute><MainLayout><ChartOfAccounts /></MainLayout></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute><MainLayout><Settings /></MainLayout></ProtectedRoute>} />
            <Route path="/team" element={<ProtectedRoute><MainLayout><TeamManagement /></MainLayout></ProtectedRoute>} />
            <Route path="/audit-logs" element={<ProtectedRoute><MainLayout><AuditLogs /></MainLayout></ProtectedRoute>} />
            <Route path="/import" element={<ProtectedRoute><MainLayout><BulkImportWizard /></MainLayout></ProtectedRoute>} />
            <Route path="/banking" element={<ProtectedRoute><MainLayout><BankReconciliation /></MainLayout></ProtectedRoute>} />
            <Route path="/invoices" element={<ProtectedRoute><MainLayout><Invoices /></MainLayout></ProtectedRoute>} />
            <Route path="/bills" element={<ProtectedRoute><MainLayout><VendorBills /></MainLayout></ProtectedRoute>} />
            <Route path="/inventory" element={<ProtectedRoute><MainLayout><WarehouseManagement /></MainLayout></ProtectedRoute>} />
            <Route path="/analytics/inventory" element={<ProtectedRoute><MainLayout><InventoryIntelligence /></MainLayout></ProtectedRoute>} />
            <Route path="/reports/executive" element={<ProtectedRoute><MainLayout><ExecutiveReports /></MainLayout></ProtectedRoute>} />
            <Route path="/journals" element={<ProtectedRoute><MainLayout><JournalList /></MainLayout></ProtectedRoute>} />
            <Route path="/journals/new" element={<ProtectedRoute><MainLayout><JournalBuilder /></MainLayout></ProtectedRoute>} />
            <Route path="/reports/ledger" element={<ProtectedRoute><MainLayout><GeneralLedger /></MainLayout></ProtectedRoute>} />
            <Route path="/reports/pnl" element={<ProtectedRoute><MainLayout><ProfitAndLoss /></MainLayout></ProtectedRoute>} />
            <Route path="/reports" element={<Navigate to="/reports/pnl" replace />} />
            
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
