import { useEffect, useState } from "react";
import { Command } from "cmdk";
import { Search, Settings, Sun, Moon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { cn } from "../../lib/utils";
import { useTheme } from "../../contexts/ThemeContext";
import { useAuth } from "../../contexts/AuthContext";
import { getVisibleNavGroups, getVisibleHrefs } from "../../lib/navigation";

const ITEM_CLASSNAME =
  "flex items-center px-2 py-2 mt-1 rounded-md text-sm cursor-pointer aria-selected:bg-primary-50 aria-selected:text-primary-700 dark:aria-selected:bg-primary-900/50 dark:aria-selected:text-primary-300";

export function CommandMenu() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { setTheme } = useTheme();
  const { user } = useAuth();

  // Same source of truth (and same role-based filtering) as the sidebar, so
  // Cmd+K never offers a page a user's own sidebar hides from them.
  const navGroups = getVisibleNavGroups(user?.role, user?.orgType);
  // "Preferences" (/settings) is blocked for the same roles at the route
  // level (App.tsx's SETTINGS_RESTRICTED_ROLES) - offering it here would be
  // a dead-end navigation that immediately redirects.
  const canAccessSettings = getVisibleHrefs(user?.role) === null;

  // Toggle the menu when ⌘K is pressed
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const runCommand = (command: () => void) => {
    setOpen(false);
    command();
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      className={cn(
        "fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-xl z-50",
        "bg-white dark:bg-secondary-900 border border-secondary-200 dark:border-secondary-800 rounded-xl shadow-2xl overflow-hidden",
        "animate-in fade-in zoom-in-95 duration-200"
      )}
      label="Global Command Menu"
    >
      <div className="flex items-center border-b border-secondary-100 dark:border-secondary-800 px-3">
        <Search className="mr-2 h-4 w-4 shrink-0 text-secondary-500" />
        <Command.Input
          className="flex h-12 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-secondary-400 disabled:cursor-not-allowed disabled:opacity-50 text-secondary-900 dark:text-secondary-50"
          placeholder="Jump to a page or setting..."
        />
      </div>

      <Command.List className="max-h-[400px] overflow-y-auto p-2">
        <Command.Empty className="py-6 text-center text-sm text-secondary-500">
          No results found.
        </Command.Empty>

        {navGroups.map((group) => (
          <Command.Group
            key={group.sectionTitle}
            heading={group.sectionTitle}
            className="px-2 text-xs font-medium text-secondary-500 py-2"
          >
            {group.items.map((item) => {
              const Icon = item.icon;
              return (
                <Command.Item
                  key={item.href}
                  value={item.name}
                  onSelect={() => runCommand(() => navigate(item.href))}
                  className={ITEM_CLASSNAME}
                >
                  <Icon className="mr-2 h-4 w-4" />
                  {item.name}
                </Command.Item>
              );
            })}
          </Command.Group>
        ))}

        <Command.Group heading="Settings" className="px-2 text-xs font-medium text-secondary-500 py-2">
          {canAccessSettings && (
            <Command.Item onSelect={() => runCommand(() => navigate("/settings"))} className={ITEM_CLASSNAME}>
              <Settings className="mr-2 h-4 w-4" />
              Preferences
            </Command.Item>
          )}
          <Command.Item onSelect={() => runCommand(() => setTheme("light"))} className={ITEM_CLASSNAME}>
            <Sun className="mr-2 h-4 w-4" />
            Light Mode
          </Command.Item>
          <Command.Item onSelect={() => runCommand(() => setTheme("dark"))} className={ITEM_CLASSNAME}>
            <Moon className="mr-2 h-4 w-4" />
            Dark Mode
          </Command.Item>
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}
