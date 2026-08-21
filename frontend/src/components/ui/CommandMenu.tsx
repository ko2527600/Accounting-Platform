import { useEffect, useState, useCallback } from "react";
import { Command } from "cmdk";
import {
  Search, Settings, Sun, Moon,
  User, FileText, Building2, Package, BookOpen, FileSpreadsheet, Loader2,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { cn } from "../../lib/utils";
import { useTheme } from "../../contexts/ThemeContext";
import { useAuth } from "../../contexts/AuthContext";
import { useWorkspaceMode } from "../../contexts/WorkspaceModeContext";
import { getVisibleNavGroups, getVisibleHrefs } from "../../lib/navigation";
import api from "../../lib/api";

const ITEM_CLASSNAME =
  "flex items-center px-2 py-2 mt-1 rounded-md text-sm cursor-pointer aria-selected:bg-primary-50 aria-selected:text-primary-700 dark:aria-selected:bg-primary-900/50 dark:aria-selected:text-primary-300";

type SearchResultType = 'customer' | 'invoice' | 'vendor' | 'item' | 'account' | 'journal';

interface SearchResult {
  type: SearchResultType;
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

const TYPE_ICON: Record<SearchResultType, React.ElementType> = {
  customer: User,
  invoice: FileText,
  vendor: Building2,
  item: Package,
  account: BookOpen,
  journal: FileSpreadsheet,
};

const TYPE_LABEL: Record<SearchResultType, string> = {
  customer: 'Customer',
  invoice: 'Invoice',
  vendor: 'Vendor',
  item: 'Item',
  account: 'Account',
  journal: 'Journal',
};

const TYPE_BADGE: Record<SearchResultType, string> = {
  customer: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  invoice: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  vendor: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  item: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  account: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  journal: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
};

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export function CommandMenu() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const navigate = useNavigate();
  const { setTheme } = useTheme();
  const { user } = useAuth();
  const { mode } = useWorkspaceMode();

  const navGroups = getVisibleNavGroups(user?.role, user?.orgType, mode);
  const canAccessSettings = getVisibleHrefs(user?.role) === null;

  const debouncedQuery = useDebounce(query, 280);

  const fetchResults = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults([]);
      return;
    }
    setIsSearching(true);
    try {
      const res = await api.get('/search', { params: { q } });
      setResults(res.data?.data?.results ?? []);
    } catch {
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  }, []);

  useEffect(() => {
    fetchResults(debouncedQuery);
  }, [debouncedQuery, fetchResults]);

  // Reset search state when menu closes
  useEffect(() => {
    if (!open) {
      setQuery('');
      setResults([]);
    }
  }, [open]);

  // Toggle on ⌘K / Ctrl+K
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  const runCommand = (command: () => void) => {
    setOpen(false);
    command();
  };

  const hasQuery = query.length >= 2;

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      className={cn(
        'fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-xl z-50',
        'bg-white dark:bg-secondary-900 border border-secondary-200 dark:border-secondary-800 rounded-xl shadow-2xl overflow-hidden',
        'animate-in fade-in zoom-in-95 duration-200'
      )}
      label="Global Command Menu"
      shouldFilter={!hasQuery}
    >
      <div className="flex items-center border-b border-secondary-100 dark:border-secondary-800 px-3">
        {isSearching ? (
          <Loader2 className="mr-2 h-4 w-4 shrink-0 text-secondary-400 animate-spin" aria-hidden />
        ) : (
          <Search className="mr-2 h-4 w-4 shrink-0 text-secondary-500" aria-hidden />
        )}
        <Command.Input
          className="flex h-12 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-secondary-400 disabled:cursor-not-allowed disabled:opacity-50 text-secondary-900 dark:text-secondary-50"
          placeholder="Search or jump to a page… (Cmd+K)"
          value={query}
          onValueChange={setQuery}
        />
      </div>

      <Command.List className="max-h-[440px] overflow-y-auto p-2">
        <Command.Empty className="py-6 text-center text-sm text-secondary-500">
          {hasQuery && !isSearching ? 'No results found.' : 'Start typing to search data or navigate…'}
        </Command.Empty>

        {/* Real search results */}
        {hasQuery && results.length > 0 && (
          <Command.Group
            heading="SEARCH RESULTS"
            className="px-2 text-xs font-medium text-secondary-500 py-2"
          >
            {results.map((r) => {
              const Icon = TYPE_ICON[r.type];
              return (
                <Command.Item
                  key={`${r.type}-${r.id}`}
                  value={`${r.type} ${r.title} ${r.subtitle}`}
                  onSelect={() => runCommand(() => navigate(r.href))}
                  className={ITEM_CLASSNAME}
                >
                  <Icon className="mr-2 h-4 w-4 shrink-0 text-secondary-400" aria-hidden />
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-secondary-900 dark:text-secondary-50">{r.title}</span>
                    {r.subtitle && (
                      <span className="ml-2 text-xs text-secondary-500 truncate">{r.subtitle}</span>
                    )}
                  </div>
                  <span
                    className={cn(
                      'ml-2 text-xs px-1.5 py-0.5 rounded font-medium shrink-0',
                      TYPE_BADGE[r.type]
                    )}
                  >
                    {TYPE_LABEL[r.type]}
                  </span>
                </Command.Item>
              );
            })}
          </Command.Group>
        )}

        {/* Nav shortcuts — always shown when no query, or below results with query */}
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
                  <Icon className="mr-2 h-4 w-4" aria-hidden />
                  {item.name}
                </Command.Item>
              );
            })}
          </Command.Group>
        ))}

        <Command.Group heading="Settings" className="px-2 text-xs font-medium text-secondary-500 py-2">
          {canAccessSettings && (
            <Command.Item
              onSelect={() => runCommand(() => navigate('/settings'))}
              className={ITEM_CLASSNAME}
            >
              <Settings className="mr-2 h-4 w-4" aria-hidden />
              Preferences
            </Command.Item>
          )}
          <Command.Item
            onSelect={() => runCommand(() => setTheme('light'))}
            className={ITEM_CLASSNAME}
          >
            <Sun className="mr-2 h-4 w-4" aria-hidden />
            Light Mode
          </Command.Item>
          <Command.Item
            onSelect={() => runCommand(() => setTheme('dark'))}
            className={ITEM_CLASSNAME}
          >
            <Moon className="mr-2 h-4 w-4" aria-hidden />
            Dark Mode
          </Command.Item>
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}
