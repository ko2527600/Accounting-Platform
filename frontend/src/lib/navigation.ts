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
} from "lucide-react";

export interface NavItem {
  name: string;
  href: string;
  icon: any;
}

export interface NavGroup {
  sectionTitle: string;
  items: NavItem[];
}

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
      { name: "Expense Claims", href: "/expenses", icon: Wallet },
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
      { name: "Budgets", href: "/reports/budgets", icon: Target },
    ],
  },
  {
    sectionTitle: "ADMINISTRATION",
    items: [
      { name: "Approvals", href: "/approvals", icon: ShieldCheck },
      { name: "Audit Trail", href: "/audit-logs", icon: ShieldCheck },
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
  "shop manager": ["/dashboard", "/inventory", "/analytics/inventory", "/pos", "/expenses"],
  cashier: ["/dashboard", "/inventory", "/pos", "/expenses"],
  hr: ["/dashboard", "/team", "/expenses"],
  auditor: [
    "/dashboard",
    "/accounts",
    "/journals",
    "/banking",
    "/invoices",
    "/bills",
    "/expenses",
    "/reports/executive",
    "/reports/ledger",
    "/reports/pnl",
    "/reports/balance-sheet",
    "/reports/cash-flow",
    "/reports/cash-flow-forecast",
    "/reports/kpis",
    "/reports/budgets",
    "/audit-logs",
  ],
};

// Roles blocked from Settings screens (Workspace Settings, Tax Rates,
// Fiscal Periods, Recurring Transactions) - both the route guard (App.tsx)
// and any UI entry point into /settings (Header's profile menu, etc.) must
// check this same set so a restricted role never sees a link that just
// bounces them back to /dashboard.
export const SETTINGS_RESTRICTED_ROLES = new Set(["shop manager", "cashier", "hr", "auditor"]);

export function isSettingsRestricted(role: string | undefined): boolean {
  return SETTINGS_RESTRICTED_ROLES.has((role || "").toLowerCase().trim());
}

export function getVisibleHrefs(role: string | undefined): Set<string> | null {
  if (!role) return null;
  const allowed = RESTRICTED_ROLE_NAV[role.toLowerCase().trim()];
  return allowed ? new Set(allowed) : null;
}

/**
 * Filters navigationGroups down to what a given role/org-type can actually
 * see, dropping any now-empty group. Org-type filtering runs first (a
 * nonprofit tenant never sees POS/Inventory, and gets a Funds item under
 * Finance & Banking), then the existing role-based filtering applies on top
 * of that already-narrowed set - so e.g. a nonprofit's Shop Manager role
 * (an unlikely but plausible mixed-mode org) never sees POS/Inventory items
 * even before role filtering kicks in.
 */
export function getVisibleNavGroups(role: string | undefined, orgType?: string): NavGroup[] {
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

  const visibleHrefs = getVisibleHrefs(role);
  if (!visibleHrefs) return groups;
  return groups
    .map((group) => ({ ...group, items: group.items.filter((item) => visibleHrefs.has(item.href)) }))
    .filter((group) => group.items.length > 0);
}
