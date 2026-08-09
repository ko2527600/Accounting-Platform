import { Link, useLocation } from "react-router-dom";
import { cn } from "../../lib/utils";
import { useAuth } from "../../contexts/AuthContext";
import { getVisibleNavGroups, getVisibleHrefs } from "../../lib/navigation";
import { Settings } from "lucide-react";

export function Sidebar() {
  const location = useLocation();
  const { user } = useAuth();
  const visibleGroups = getVisibleNavGroups(user?.role);
  const isRestricted = getVisibleHrefs(user?.role) !== null;

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
                  key={item.name}
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

      {!isRestricted && (
        <div className="p-4 border-t border-secondary-200 dark:border-secondary-800">
          <Link
            to="/settings"
            className="group flex items-center px-3 py-2 text-xs font-medium rounded-lg text-secondary-600 hover:bg-secondary-50 hover:text-secondary-900 dark:text-secondary-400 dark:hover:bg-secondary-800 dark:hover:text-secondary-50 transition-all duration-200"
          >
            <Settings className="flex-shrink-0 -ml-1 mr-3 h-4 w-4 text-secondary-400 group-hover:text-secondary-500 dark:text-secondary-500 dark:group-hover:text-secondary-400" />
            Workspace Settings
          </Link>
        </div>
      )}
    </aside>
  );
}
