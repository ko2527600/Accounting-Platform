import { useEffect, useState } from "react";
import { Command } from "cmdk";
import { Search, LayoutDashboard, BookOpen, FileSpreadsheet, PieChart, Settings, Sun, Moon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { cn } from "../../lib/utils";
import { useTheme } from "../../contexts/ThemeContext";

export function CommandMenu() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { setTheme } = useTheme();

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
          placeholder="Type a command or search..."
        />
      </div>
      
      <Command.List className="max-h-[300px] overflow-y-auto p-2">
        <Command.Empty className="py-6 text-center text-sm text-secondary-500">
          No results found.
        </Command.Empty>

        <Command.Group heading="Navigation" className="px-2 text-xs font-medium text-secondary-500 py-2">
          <Command.Item
            onSelect={() => runCommand(() => navigate("/"))}
            className="flex items-center px-2 py-2 mt-1 rounded-md text-sm cursor-pointer aria-selected:bg-primary-50 aria-selected:text-primary-700 dark:aria-selected:bg-primary-900/50 dark:aria-selected:text-primary-300"
          >
            <LayoutDashboard className="mr-2 h-4 w-4" />
            Dashboard
          </Command.Item>
          <Command.Item
            onSelect={() => runCommand(() => navigate("/accounts"))}
            className="flex items-center px-2 py-2 mt-1 rounded-md text-sm cursor-pointer aria-selected:bg-primary-50 aria-selected:text-primary-700 dark:aria-selected:bg-primary-900/50 dark:aria-selected:text-primary-300"
          >
            <BookOpen className="mr-2 h-4 w-4" />
            Chart of Accounts
          </Command.Item>
          <Command.Item
            onSelect={() => runCommand(() => navigate("/journals"))}
            className="flex items-center px-2 py-2 mt-1 rounded-md text-sm cursor-pointer aria-selected:bg-primary-50 aria-selected:text-primary-700 dark:aria-selected:bg-primary-900/50 dark:aria-selected:text-primary-300"
          >
            <FileSpreadsheet className="mr-2 h-4 w-4" />
            Journal Entries
          </Command.Item>
          <Command.Item
            onSelect={() => runCommand(() => navigate("/reports/ledger"))}
            className="flex items-center px-2 py-2 mt-1 rounded-md text-sm cursor-pointer aria-selected:bg-primary-50 aria-selected:text-primary-700 dark:aria-selected:bg-primary-900/50 dark:aria-selected:text-primary-300"
          >
            <BookOpen className="mr-2 h-4 w-4" />
            General Ledger
          </Command.Item>
          <Command.Item
            onSelect={() => runCommand(() => navigate("/reports/pnl"))}
            className="flex items-center px-2 py-2 mt-1 rounded-md text-sm cursor-pointer aria-selected:bg-primary-50 aria-selected:text-primary-700 dark:aria-selected:bg-primary-900/50 dark:aria-selected:text-primary-300"
          >
            <PieChart className="mr-2 h-4 w-4" />
            Profit & Loss
          </Command.Item>
        </Command.Group>

        <Command.Group heading="Settings" className="px-2 text-xs font-medium text-secondary-500 py-2">
          <Command.Item
            onSelect={() => runCommand(() => navigate("/settings"))}
            className="flex items-center px-2 py-2 mt-1 rounded-md text-sm cursor-pointer aria-selected:bg-primary-50 aria-selected:text-primary-700 dark:aria-selected:bg-primary-900/50 dark:aria-selected:text-primary-300"
          >
            <Settings className="mr-2 h-4 w-4" />
            Preferences
          </Command.Item>
          <Command.Item
            onSelect={() => runCommand(() => setTheme("light"))}
            className="flex items-center px-2 py-2 mt-1 rounded-md text-sm cursor-pointer aria-selected:bg-primary-50 aria-selected:text-primary-700 dark:aria-selected:bg-primary-900/50 dark:aria-selected:text-primary-300"
          >
            <Sun className="mr-2 h-4 w-4" />
            Light Mode
          </Command.Item>
          <Command.Item
            onSelect={() => runCommand(() => setTheme("dark"))}
            className="flex items-center px-2 py-2 mt-1 rounded-md text-sm cursor-pointer aria-selected:bg-primary-50 aria-selected:text-primary-700 dark:aria-selected:bg-primary-900/50 dark:aria-selected:text-primary-300"
          >
            <Moon className="mr-2 h-4 w-4" />
            Dark Mode
          </Command.Item>
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}
