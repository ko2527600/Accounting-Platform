import {
  LayoutDashboard,
  BookOpen,
  FileSpreadsheet,
  PieChart,
  Users,
  ShieldCheck,
  FileUp,
  Landmark,
  FileText,
  Receipt,
  Warehouse,
  Lightbulb,
  BarChart3,
  Percent,
  CalendarClock,
  Target,
  Repeat,
  ShoppingCart,
  Scale,
  Waves,
  Gauge,
  Wallet,
  TrendingUp,
  Rocket,
  Bot,
  Clock,
  Wallet2,
  Building2,
  MessageSquare,
  Store,
  GitBranch,
  Anchor,
  BadgeDollarSign,
  LineChart,
} from "lucide-react";

export type WorkspaceMode = 'operations' | 'business' | 'professional';

export interface NavItem {
  name: string;
  href: string;
  icon: any;
}

export interface NavGroup {
  sectionTitle: string;
  items: NavItem[];
}

// Hrefs hidden from unrestricted roles in simplified workspace modes.
// Operations = small retail starter (7 work areas per the product report).
// Business  = wholesale/distribution (11 work areas).
// Professional = unrestricted (full accounting view).
const OPERATIONS_HIDDEN: ReadonlySet<string> = new Set([
  '/accounts', '/journals', '/banking',
  '/settings/tax-rates', '/settings/fiscal-periods', '/settings/recurring-transactions',
  '/fixed-assets', '/recurring-invoices',
  '/reports/ledger', '/reports/balance-sheet', '/reports/cash-flow',
  '/reports/cash-flow-forecast', '/reports/kpis', '/reports/aging',
  '/reports/landed-costs', '/reports/budgets', '/reports/analytics', '/reports/branch-comparison',
  '/payroll/employees', '/payroll/runs', '/payroll/loans', '/payroll/leave',
  '/approvals', '/audit-logs', '/help-assistant/activity', '/import',
]);

const BUSINESS_HIDDEN: ReadonlySet<string> = new Set([
  '/settings/fiscal-periods', '/settings/recurring-transactions',
  '/reports/ledger', '/fixed-assets',
  '/audit-logs', '/help-assistant/activity', '/import',
]);

// Per-href display name overrides for each simplified mode.
const MODE_LABELS: Record<string, Partial<Record<WorkspaceMode, string>>> = {
  '/invoices':          { operations: 'Credit Sales',            business: 'Invoices & Credit Sales' },
  '/bills':             { operations: 'Supplier Bills',          business: 'Supplier Bills' },
  '/purchase-orders':   { operations: 'Restock Orders' },
  '/inventory':         { operations: 'Products & Stock',        business: 'Stock & Warehouses' },
  '/pos':               { operations: 'Sell / POS' },
  '/expenses':          { operations: 'Expenses' },
  '/petty-cash':        { operations: 'Petty Cash Float' },
  '/reports/executive': { operations: 'Sales & Profit Reports',  business: 'Business Reports' },
  '/reports/pnl':       { operations: 'Profit Summary' },
  '/journals':          { business:   'Finance Adjustments' },
};

// Per-mode section title overrides (only override what changes).
const MODE_SECTION_TITLES: Record<WorkspaceMode, Partial<Record<string, string>>> = {
  operations: {
    'INVENTORY & GODOWNS':  'PRODUCTS & STOCK',
    'SALES & PURCHASES':    'SALES & EXPENSES',
    'REPORTS & ANALYTICS':  'REPORTS',
    'ADMINISTRATION':       'TEAM',
  },
  business: {
    'INVENTORY & GODOWNS':  'INVENTORY & WAREHOUSES',
    'ADMINISTRATION':       'ADMIN',
  },
  professional: {},
};

// Single source of truth for "what pages exist" - shared by Sidebar.tsx and
// CommandMenu.tsx so the two navigation surfaces can never drift apart.
export const navigationGroups: NavGroup[] = [
  {
    sectionTitle: "OVERVIEW",
    items: [
      { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
      { name: "Guided Setup", href: "/onboarding", icon: Rocket },
    ],
  },
  {
    sectionTitle: "INVENTORY & GODOWNS",
    items: [
      { name: "Warehouses & Stock", href: "/inventory", icon: Warehouse },
      { name: "Stock Intelligence", href: "/analytics/inventory", icon: Lightbulb },
    ],
  },
  {
    sectionTitle: "SALES & PURCHASES",
    items: [
      { name: "Point of Sale", href: "/pos", icon: ShoppingCart },
      { name: "Invoices (AR)", href: "/invoices", icon: FileText },
      { name: "Vendor Bills (AP)", href: "/bills", icon: Receipt },
      { name: "Purchase Orders", href: "/purchase-orders", icon: FileSpreadsheet },
      { name: "Recurring Invoices", href: "/recurring-invoices", icon: Repeat },
      { name: "Expense Claims", href: "/expenses", icon: Wallet },
      { name: "Petty Cash", href: "/petty-cash", icon: Wallet2 },
    ],
  },
  {
    sectionTitle: "FINANCE & BANKING",
    items: [
      { name: "Chart of Accounts", href: "/accounts", icon: BookOpen },
      { name: "Journal Vouchers", href: "/journals", icon: FileSpreadsheet },
      { name: "Banking & Feeds", href: "/banking", icon: Landmark },
      { name: "Tax Rates", href: "/settings/tax-rates", icon: Percent },
      { name: "Fiscal Periods", href: "/settings/fiscal-periods", icon: CalendarClock },
      { name: "Recurring Transactions", href: "/settings/recurring-transactions", icon: Repeat },
      { name: "Fixed Assets", href: "/fixed-assets", icon: Building2 },
    ],
  },
  {
    sectionTitle: "REPORTS & ANALYTICS",
    items: [
      { name: "Executive Reports", href: "/reports/executive", icon: BarChart3 },
      { name: "General Ledger", href: "/reports/ledger", icon: BookOpen },
      { name: "Profit & Loss", href: "/reports/pnl", icon: PieChart },
      { name: "Balance Sheet", href: "/reports/balance-sheet", icon: Scale },
      { name: "Cash Flow Statement", href: "/reports/cash-flow", icon: Waves },
      { name: "Cash Flow Forecast", href: "/reports/cash-flow-forecast", icon: TrendingUp },
      { name: "KPI Dashboard", href: "/reports/kpis", icon: Gauge },
      { name: "AP/AR Aging", href: "/reports/aging", icon: Clock },
      { name: "Sales Channel Report", href: "/reports/sales-channel", icon: Store },
      { name: "Branch Comparison", href: "/reports/branch-comparison", icon: GitBranch },
      { name: "Landed Cost", href: "/reports/landed-costs", icon: Anchor },
      { name: "Budgets", href: "/reports/budgets", icon: Target },
      { name: "Analytics Dashboard", href: "/reports/analytics", icon: LineChart },
    ],
  },
  {
    sectionTitle: "PAYROLL",
    items: [
      { name: "Employees", href: "/payroll/employees", icon: Users },
      { name: "Payroll Runs", href: "/payroll/runs", icon: BadgeDollarSign },
      { name: "Employee Loans", href: "/payroll/loans", icon: Landmark },
      { name: "Leave Management", href: "/payroll/leave", icon: CalendarClock },
    ],
  },
  {
    sectionTitle: "ADMINISTRATION",
    items: [
      { name: "Approvals", href: "/approvals", icon: ShieldCheck },
      { name: "Audit Trail", href: "/audit-logs", icon: ShieldCheck },
      { name: "AI Assistant Activity", href: "/help-assistant/activity", icon: Bot },
      { name: "Feedback Inbox", href: "/feedback", icon: MessageSquare },
      { name: "Bulk Data Import", href: "/import", icon: FileUp },
      { name: "Team Management", href: "/team", icon: Users },
    ],
  },
];

// Roles scoped to their own reduced set of screens - anything not listed
// here (Admin, Accountant, Viewer, or any legacy free-text worker title) is
// unrestricted and sees the full navigation, matching pre-existing behavior.
// Shop Manager/Cashier are already warehouse-scoped by the backend
// (assertWarehouseAccess) - this just keeps navigation from advertising
// screens (Settings, Finance, Team Management) they have no real use for
// and whose write actions the backend rejects anyway. HR gets a
// Team-Management-only screen; Auditor gets a read-focused financial
// review set with no operational entry points (POS, Inventory writes,
// Settings, Team Management).
export const RESTRICTED_ROLE_NAV: Record<string, string[]> = {
  "shop manager": ["/dashboard", "/inventory", "/analytics/inventory", "/pos", "/invoices", "/bills", "/expenses"],
  cashier: ["/dashboard", "/inventory", "/pos", "/expenses"],
  "warehouse manager": ["/dashboard", "/inventory", "/analytics/inventory", "/purchase-orders", "/expenses"],
  hr: ["/dashboard", "/team", "/expenses", "/payroll/employees", "/payroll/runs", "/payroll/loans", "/payroll/leave"],
  "payroll officer": ["/dashboard", "/payroll/employees", "/payroll/runs", "/payroll/loans", "/payroll/leave", "/expenses"],
  "payroll approver": ["/dashboard", "/payroll/employees", "/payroll/runs", "/payroll/loans", "/payroll/leave", "/expenses"],
  "accounts payable clerk": ["/dashboard", "/bills", "/purchase-orders", "/expenses", "/inventory", "/vendors"],
  "accounts receivable clerk": ["/dashboard", "/invoices", "/recurring-invoices", "/customers", "/expenses"],
  "external accountant": [
    "/dashboard",
    "/accounts",
    "/journals",
    "/banking",
    "/fixed-assets",
    "/invoices",
    "/bills",
    "/expenses",
    "/reports/executive",
    "/reports/ledger",
    "/reports/pnl",
    "/reports/balance-sheet",
    "/reports/cash-flow",
    "/reports/kpis",
    "/reports/aging",
    "/reports/budgets",
  ],
  viewer: [
    "/dashboard",
    "/reports/executive",
    "/reports/pnl",
    "/reports/balance-sheet",
    "/reports/cash-flow",
    "/reports/kpis",
  ],
  auditor: [
    "/dashboard",
    "/accounts",
    "/journals",
    "/banking",
    "/fixed-assets",
    "/invoices",
    "/bills",
    "/recurring-invoices",
    "/expenses",
    "/reports/executive",
    "/reports/ledger",
    "/reports/pnl",
    "/reports/balance-sheet",
    "/reports/cash-flow",
    "/reports/cash-flow-forecast",
    "/reports/kpis",
    "/reports/aging",
    "/reports/sales-channel",
    "/reports/branch-comparison",
    "/reports/landed-costs",
    "/reports/budgets",
    "/reports/analytics",
    "/audit-logs",
    "/help-assistant/activity",
    "/feedback",
  ],
};

// Roles blocked from Settings screens (Workspace Settings, Tax Rates,
// Fiscal Periods, Recurring Transactions) - both the route guard (App.tsx)
// and any UI entry point into /settings (Header's profile menu, etc.) must
// check this same set so a restricted role never sees a link that just
// bounces them back to /dashboard.
export const SETTINGS_RESTRICTED_ROLES = new Set([
  "shop manager", "cashier", "warehouse manager",
  "hr", "payroll officer", "payroll approver",
  "accounts payable clerk", "accounts receivable clerk",
  "auditor", "external accountant", "viewer",
]);

export function isSettingsRestricted(role: string | undefined): boolean {
  return SETTINGS_RESTRICTED_ROLES.has((role || "").toLowerCase().trim());
}

export function getVisibleHrefs(role: string | undefined): Set<string> | null {
  if (!role) return null;
  const allowed = RESTRICTED_ROLE_NAV[role.toLowerCase().trim()];
  return allowed ? new Set(allowed) : null;
}

/**
 * Filters navigationGroups down to what a given role/org-type/mode can
 * actually see, dropping any now-empty group.
 *
 * Priority order:
 * 1. Org-type filtering (NONPROFIT hides POS/Inventory, adds Funds).
 * 2. Role-based filtering (restricted roles like Cashier/Shop Manager/HR/
 *    Auditor see a fixed allowlist from RESTRICTED_ROLE_NAV — workspace mode
 *    is ignored for these roles since their nav is already minimal).
 * 3. Workspace mode filtering (Operations → simplified retail; Business →
 *    wholesale; Professional → full view). Only applies to unrestricted roles.
 */
export function getVisibleNavGroups(
  role: string | undefined,
  orgType?: string,
  mode: WorkspaceMode = 'professional',
): NavGroup[] {
  let groups = navigationGroups;

  if (orgType === "NONPROFIT") {
    groups = groups
      .map((group) => {
        if (group.sectionTitle === "INVENTORY & GODOWNS") return null;
        if (group.sectionTitle === "SALES & PURCHASES") {
          return { ...group, items: group.items.filter((item) => item.href !== "/pos") };
        }
        if (group.sectionTitle === "FINANCE & BANKING") {
          return { ...group, items: [...group.items, { name: "Funds", href: "/settings/funds", icon: Landmark }] };
        }
        return group;
      })
      .filter((group): group is NavGroup => group !== null);
  }

  // Restricted roles use the existing role allowlist only — mode doesn't apply.
  const visibleHrefs = getVisibleHrefs(role);
  if (visibleHrefs) {
    return groups
      .map((group) => ({ ...group, items: group.items.filter((item) => visibleHrefs.has(item.href)) }))
      .filter((group) => group.items.length > 0);
  }

  // Unrestricted roles: apply workspace mode filtering + label/section overrides.
  if (mode !== 'professional') {
    const hidden = mode === 'operations' ? OPERATIONS_HIDDEN : BUSINESS_HIDDEN;
    const sectionOverrides = MODE_SECTION_TITLES[mode];
    groups = groups
      .map((group) => {
        const items = group.items
          .filter((item) => !hidden.has(item.href))
          .map((item) => ({
            ...item,
            name: MODE_LABELS[item.href]?.[mode] ?? item.name,
          }));
        if (items.length === 0) return null;
        const sectionTitle = sectionOverrides[group.sectionTitle] ?? group.sectionTitle;
        return { sectionTitle, items };
      })
      .filter((group): group is NavGroup => group !== null);
  }

  return groups;
}
