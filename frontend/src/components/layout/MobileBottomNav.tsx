import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Menu, X } from "lucide-react";
import { cn } from "../../lib/utils";
import { useAuth } from "../../contexts/AuthContext";
import { useWorkspaceMode } from "../../contexts/WorkspaceModeContext";
import { getVisibleNavGroups, getVisibleHrefs } from "../../lib/navigation";

// Preferred hrefs to pin in the bottom bar for users who have many nav items
const PINNED_HREFS = ["/dashboard", "/pos", "/inventory", "/invoices", "/expenses"];

// Short labels that fit in the tight bottom bar
const SHORT_NAMES: Record<string, string> = {
  "/dashboard":           "Home",
  "/pos":                 "Sell",
  "/inventory":           "Stock",
  "/invoices":            "Invoices",
  "/bills":               "Bills",
  "/expenses":            "Expenses",
  "/customers":           "Customers",
  "/purchase-orders":     "Orders",
  "/reports/executive":   "Reports",
  "/reports/pnl":         "P&L",
  "/analytics/inventory": "Analytics",
  "/team":                "Team",
  "/petty-cash":          "Petty Cash",
};

export function MobileBottomNav() {
  const location = useLocation();
  const { user } = useAuth();
  const { mode } = useWorkspaceMode();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const isRestricted = getVisibleHrefs(user?.role) !== null;
  const visibleGroups = getVisibleNavGroups(
    user?.role,
    user?.orgType,
    isRestricted ? "professional" : mode
  );
  const allItems = visibleGroups.flatMap((g) => g.items);

  // Decide what goes in the bar vs. the "More" drawer
  const MAX_BAR_ITEMS = 4; // +1 for "More" button when needed
  let barItems = allItems;
  let drawerItems: typeof allItems = [];

  if (allItems.length > 5) {
    // Pin preferred items; fill remaining bar slots from the front
    const pinned = PINNED_HREFS
      .map((h) => allItems.find((i) => i.href === h))
      .filter(Boolean) as typeof allItems;
    const rest = allItems.filter((i) => !PINNED_HREFS.includes(i.href));
    const combined = [...pinned, ...rest];
    barItems = combined.slice(0, MAX_BAR_ITEMS);
    drawerItems = combined.slice(MAX_BAR_ITEMS);
  }

  const showMore = drawerItems.length > 0;

  return (
    <>
      {/* Backdrop */}
      {drawerOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 md:hidden"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      {/* Slide-up drawer */}
      {drawerOpen && (
        <div className="fixed left-0 right-0 z-50 md:hidden bg-white dark:bg-secondary-900 rounded-t-2xl shadow-2xl border-t border-secondary-200 dark:border-secondary-800 max-h-[60vh] overflow-y-auto"
          style={{ bottom: "calc(56px + env(safe-area-inset-bottom, 0px))" }}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-secondary-200 dark:border-secondary-800">
            <span className="text-sm font-semibold text-secondary-900 dark:text-secondary-50">All pages</span>
            <button
              onClick={() => setDrawerOpen(false)}
              className="p-1.5 rounded-full hover:bg-secondary-100 dark:hover:bg-secondary-800 transition-colors"
            >
              <X className="h-4 w-4 text-secondary-500" />
            </button>
          </div>
          <div className="p-3 grid grid-cols-3 gap-2">
            {drawerItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.href;
              return (
                <Link
                  key={item.href}
                  to={item.href}
                  onClick={() => setDrawerOpen(false)}
                  className={cn(
                    "flex flex-col items-center gap-1.5 p-3 rounded-xl text-center transition-colors",
                    isActive
                      ? "bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300"
                      : "text-secondary-600 dark:text-secondary-400 active:bg-secondary-100 dark:active:bg-secondary-800"
                  )}
                >
                  <Icon className="h-5 w-5 flex-shrink-0" />
                  <span className="text-[10px] font-medium leading-tight line-clamp-2">
                    {SHORT_NAMES[item.href] ?? item.name}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Fixed bottom bar */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-40 md:hidden bg-white dark:bg-secondary-900 border-t border-secondary-200 dark:border-secondary-800"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="flex items-stretch h-14">
          {barItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.href;
            return (
              <Link
                key={item.href}
                to={item.href}
                className={cn(
                  "flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors min-w-0",
                  isActive
                    ? "text-primary-700 dark:text-primary-400"
                    : "text-secondary-500 dark:text-secondary-400"
                )}
              >
                <div className={cn(
                  "p-1.5 rounded-xl transition-colors",
                  isActive && "bg-primary-50 dark:bg-primary-900/30"
                )}>
                  <Icon className="h-5 w-5" />
                </div>
                <span className="text-[9px] font-semibold leading-none truncate max-w-full px-0.5">
                  {SHORT_NAMES[item.href] ?? item.name.split(" ")[0]}
                </span>
              </Link>
            );
          })}

          {showMore && (
            <button
              onClick={() => setDrawerOpen(!drawerOpen)}
              className={cn(
                "flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors",
                drawerOpen
                  ? "text-primary-700 dark:text-primary-400"
                  : "text-secondary-500 dark:text-secondary-400"
              )}
            >
              <div className={cn(
                "p-1.5 rounded-xl transition-colors",
                drawerOpen && "bg-primary-50 dark:bg-primary-900/30"
              )}>
                <Menu className="h-5 w-5" />
              </div>
              <span className="text-[9px] font-semibold leading-none">More</span>
            </button>
          )}
        </div>
      </nav>
    </>
  );
}
