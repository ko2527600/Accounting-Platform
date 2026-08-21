import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { cn } from "../../lib/utils";
import { useAuth } from "../../contexts/AuthContext";
import { useWorkspaceMode } from "../../contexts/WorkspaceModeContext";
import type { WorkspaceMode } from "../../contexts/WorkspaceModeContext";
import { getVisibleNavGroups, getVisibleHrefs } from "../../lib/navigation";
import { Settings, Lock, X, Mail } from "lucide-react";
import { useTenantSettings } from "../../hooks/useTenantSettings";
import { TIER_NAMES } from "../../types/tenant";
import type { TenantTier } from "../../types/tenant";

const MODE_LABELS: Record<WorkspaceMode, string> = {
  operations: "Simple",
  business: "Business",
  professional: "Full",
};

const MODE_TITLES: Record<WorkspaceMode, string> = {
  operations: "Simple view — daily retail tasks only",
  business: "Business view — sales, purchases, finance",
  professional: "Full view — complete accounting workspace",
};

const MODE_RANK: WorkspaceMode[] = ["operations", "business", "professional"];

const TIER_MAX_MODE: Record<number, WorkspaceMode> = {
  1: "operations",
  2: "business",
  3: "professional",
};

const TIER_BADGE_CLASS: Record<TenantTier, string> = {
  1: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
  2: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400",
  3: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
};

export function Sidebar() {
  const location = useLocation();
  const { user } = useAuth();
  const { mode, setMode } = useWorkspaceMode();
  const { settings } = useTenantSettings();
  const [upgradePanelFor, setUpgradePanelFor] = useState<WorkspaceMode | null>(null);

  const tier = (settings?.tier ?? 1) as TenantTier;
  const maxMode = TIER_MAX_MODE[tier] ?? "operations";
  const maxRank = MODE_RANK.indexOf(maxMode);

  const effectiveMode: WorkspaceMode = (() => {
    const curRank = MODE_RANK.indexOf(mode);
    return curRank <= maxRank ? mode : maxMode;
  })();

  const isRestricted = getVisibleHrefs(user?.role) !== null;
  const visibleGroups = getVisibleNavGroups(
    user?.role,
    user?.orgType,
    isRestricted ? "professional" : effectiveMode
  );

  function handleModeClick(m: WorkspaceMode) {
    const rank = MODE_RANK.indexOf(m);
    if (rank <= maxRank) {
      setMode(m);
      setUpgradePanelFor(null);
    } else {
      setUpgradePanelFor(m === upgradePanelFor ? null : m);
    }
  }

  return (
    <aside className="w-64 bg-white dark:bg-secondary-900 border-r border-secondary-200 dark:border-secondary-800 hidden md:flex flex-col transition-colors duration-200">
      <div className="h-16 flex items-center px-6 border-b border-secondary-200 dark:border-secondary-800">
        <h1 className="text-2xl font-bold bg-gradient-to-r from-primary-500 to-primary-700 bg-clip-text text-transparent">
          Ledgio
        </h1>
      </div>

      <nav className="flex-1 px-4 py-4 space-y-6 overflow-y-auto">
        {visibleGroups.map((group) => (
          <div key={group.sectionTitle} className="space-y-1">
            <h3 className="px-3 text-[10px] font-bold tracking-wider text-secondary-400 dark:text-secondary-500 uppercase">
              {group.sectionTitle}
            </h3>
            {group.items.map((item) => {
              const isActive = location.pathname === item.href;
              const Icon = item.icon;

              return (
                <Link
                  key={item.href}
                  to={item.href}
                  className={cn(
                    "group flex items-center px-3 py-2 text-xs font-medium rounded-lg transition-all duration-200",
                    isActive
                      ? "bg-primary-50 text-primary-700 dark:bg-primary-900/50 dark:text-primary-300 font-bold shadow-sm"
                      : "text-secondary-600 hover:bg-secondary-50 hover:text-secondary-900 dark:text-secondary-400 dark:hover:bg-secondary-800 dark:hover:text-secondary-50"
                  )}
                >
                  <Icon
                    className={cn(
                      "flex-shrink-0 -ml-1 mr-3 h-4 w-4 transition-colors",
                      isActive
                        ? "text-primary-700 dark:text-primary-300"
                        : "text-secondary-400 group-hover:text-secondary-500 dark:text-secondary-500 dark:group-hover:text-secondary-400"
                    )}
                  />
                  {item.name}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="p-4 border-t border-secondary-200 dark:border-secondary-800 space-y-3">
        {!isRestricted && (
          <div>
            <p className="px-1 mb-1.5 text-[10px] font-bold tracking-wider text-secondary-400 dark:text-secondary-500 uppercase">
              Upgrade
            </p>

            {/* Current plan badge */}
            <div className="mb-2 px-1">
              <span className={cn(
                "inline-block text-[10px] font-bold rounded px-2 py-0.5 tracking-wide",
                TIER_BADGE_CLASS[tier]
              )}>
                {TIER_NAMES[tier].toUpperCase()} PLAN
              </span>
            </div>

            {/* View mode buttons (gated by tier) */}
            <div className="flex gap-1">
              {(["operations", "business", "professional"] as WorkspaceMode[]).map((m) => {
                const rank = MODE_RANK.indexOf(m);
                const allowed = rank <= maxRank;
                return (
                  <button
                    key={m}
                    onClick={() => handleModeClick(m)}
                    title={allowed ? MODE_TITLES[m] : `Upgrade to ${m === "business" ? "Business" : "Enterprise"} to unlock this view`}
                    className={cn(
                      "flex-1 text-[10px] font-semibold rounded py-1 transition-all flex items-center justify-center gap-0.5",
                      !allowed
                        ? "text-secondary-400 dark:text-secondary-600 cursor-pointer hover:bg-secondary-100 dark:hover:bg-secondary-800"
                        : effectiveMode === m
                          ? "bg-primary-100 text-primary-700 dark:bg-primary-900/60 dark:text-primary-300"
                          : "text-secondary-500 hover:bg-secondary-100 dark:text-secondary-400 dark:hover:bg-secondary-800"
                    )}
                  >
                    {!allowed && <Lock className="h-2.5 w-2.5 flex-shrink-0" aria-hidden />}
                    {MODE_LABELS[m]}
                  </button>
                );
              })}
            </div>

            {/* Inline upgrade panel */}
            {upgradePanelFor !== null && (
              <div className="mt-2 rounded-lg border border-secondary-200 dark:border-secondary-700 bg-secondary-50 dark:bg-secondary-800 p-3 text-xs space-y-2">
                <div className="flex items-start justify-between gap-1">
                  <p className="font-semibold text-secondary-900 dark:text-secondary-50 leading-tight">
                    {upgradePanelFor === "business" ? "Upgrade to Business" : "Upgrade to Enterprise"}
                  </p>
                  <button
                    onClick={() => setUpgradePanelFor(null)}
                    aria-label="Dismiss upgrade info"
                    className="text-secondary-400 hover:text-secondary-600 flex-shrink-0 mt-0.5"
                  >
                    <X className="h-3 w-3" aria-hidden />
                  </button>
                </div>
                <p className="text-secondary-500 dark:text-secondary-400 leading-relaxed">
                  {upgradePanelFor === "business"
                    ? "Unlock payroll, budgets, bank sync, approval workflows and more."
                    : "Custom pricing, unlimited seats, and dedicated 24/7 SLA support."}
                </p>
                <a
                  href={
                    upgradePanelFor === "business"
                      ? "mailto:support@ledgio.app?subject=Upgrade%20to%20Business%20Plan"
                      : "mailto:support@ledgio.app?subject=Upgrade%20to%20Enterprise%20Plan"
                  }
                  className="flex items-center gap-1.5 w-full justify-center rounded-md bg-primary-600 hover:bg-primary-700 text-white font-medium py-1.5 transition-colors"
                >
                  <Mail className="h-3 w-3" aria-hidden />
                  Contact us to upgrade
                </a>
              </div>
            )}
          </div>
        )}

        {!isRestricted && (
          <Link
            to="/settings"
            className="group flex items-center px-3 py-2 text-xs font-medium rounded-lg text-secondary-600 hover:bg-secondary-50 hover:text-secondary-900 dark:text-secondary-400 dark:hover:bg-secondary-800 dark:hover:text-secondary-50 transition-all duration-200"
          >
            <Settings className="flex-shrink-0 -ml-1 mr-3 h-4 w-4 text-secondary-400 group-hover:text-secondary-500 dark:text-secondary-500 dark:group-hover:text-secondary-400" />
            Workspace Settings
          </Link>
        )}
      </div>
    </aside>
  );
}
