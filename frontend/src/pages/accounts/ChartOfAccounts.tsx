import { useState, useMemo } from "react";
import { Plus, Search, Edit, History, Star } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAccounts } from "../../hooks/useAccounts";
import { useTenantSettings } from "../../hooks/useTenantSettings";
import { useToast } from "../../contexts/ToastContext";
import type { Account, AccountType, AccountDefaultRole } from "../../types/accounting";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Modal } from "../../components/ui/Modal";
import { Badge } from "../../components/ui/Badge";
import { AccountForm } from "../../components/accounts/AccountForm";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/Table";

const TYPE_COLORS: Record<AccountType, 'success' | 'warning' | 'danger' | 'default' | 'secondary'> = {
  Asset: 'success',
  Liability: 'danger',
  Equity: 'warning',
  Revenue: 'default',
  'Cost of Sales': 'warning',
  Expense: 'secondary',
};

const ACCOUNT_TYPES: AccountType[] = ['Asset', 'Liability', 'Equity', 'Revenue', 'Cost of Sales', 'Expense'];

// Which default-posting role(s) each account TYPE is eligible to hold - see
// backend accountService.ts's REASONABLE_TYPES_FOR_ROLE (the same mapping,
// enforced server-side too). ASSET and EXPENSE can each hold two distinct
// roles (a tenant might designate one ASSET account as the default CASH
// target and a different ASSET account as ACCUMULATED_DEPRECIATION), so
// this renders one independent toggle per applicable role rather than
// assuming a single role per type. Liability/Equity accounts can't hold any
// role, so they get no toggle at all.
const ROLES_FOR_TYPE: Partial<Record<AccountType, AccountDefaultRole[]>> = {
  Asset: ['CASH', 'ACCUMULATED_DEPRECIATION'],
  Revenue: ['REVENUE'],
  Expense: ['EXPENSE', 'DEPRECIATION_EXPENSE'],
  'Cost of Sales': ['EXPENSE'],
};
const ROLE_LABEL: Record<AccountDefaultRole, string> = {
  CASH: 'Default Cash Account',
  REVENUE: 'Default Revenue Account',
  EXPENSE: 'Default Expense Account',
  DEPRECIATION_EXPENSE: 'Default Depreciation Expense Account',
  ACCUMULATED_DEPRECIATION: 'Default Accumulated Depreciation Account',
};
const ROLE_SHORT_LABEL: Record<AccountDefaultRole, string> = {
  CASH: 'Default Cash',
  REVENUE: 'Default Revenue',
  EXPENSE: 'Default Expense',
  DEPRECIATION_EXPENSE: 'Default Depreciation Exp.',
  ACCUMULATED_DEPRECIATION: 'Default Accum. Depreciation',
};

export function ChartOfAccounts() {
  const { accounts, createAccount, updateAccount, setAccountDefaultRole } = useAccounts();
  const { settings } = useTenantSettings();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState<AccountType | "All">("All");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [settingRoleForId, setSettingRoleForId] = useState<string | null>(null);

  const handleToggleDefaultRole = async (account: Account, role: AccountDefaultRole) => {
    setSettingRoleForId(account.id);
    try {
      const nextRole = account.defaultRole === role ? null : role;
      await setAccountDefaultRole(account.id, nextRole);
      showToast(
        nextRole ? `"${account.name}" set as the ${ROLE_LABEL[role]}.` : `"${account.name}" is no longer the ${ROLE_LABEL[role]}.`,
        "success"
      );
    } catch (err: any) {
      showToast(err.response?.data?.error || "Failed to update default account.", "error");
    } finally {
      setSettingRoleForId(null);
    }
  };

  const filteredAccounts = useMemo(() => {
    return accounts.filter((acc) =>
      (typeFilter === "All" || acc.type === typeFilter) &&
      (acc.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        acc.code.includes(searchTerm))
    );
  }, [accounts, searchTerm, typeFilter]);

  const handleCreateOrEdit = async (data: any) => {
    if (selectedAccount) {
      await updateAccount(selectedAccount.id, data);
    } else {
      await createAccount(data);
    }
    setIsModalOpen(false);
  };

  const openEditModal = (account: Account) => {
    setSelectedAccount(account);
    setIsModalOpen(true);
  };

  const openCreateModal = () => {
    setSelectedAccount(null);
    setIsModalOpen(true);
  };

  // Always formats in the tenant's actual base currency (Settings > Currency
  // & Regional) rather than each account's own stored `currency` field -
  // that field is never surfaced to the user anywhere (no picker exists on
  // create or edit), so it silently drifted to a hardcoded "USD" default
  // regardless of what the tenant actually configured. The ledger is
  // single-currency by design, so every account should display in the same
  // currency as every other report in the app.
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: settings.baseCurrency,
    }).format(amount);
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-secondary-900 dark:text-secondary-50">
            Chart of Accounts
          </h2>
          <p className="text-secondary-500 dark:text-secondary-400 mt-1">
            Manage your general ledger accounts and structures.
          </p>
        </div>
        <Button onClick={openCreateModal}>
          <Plus className="mr-2 h-4 w-4" />
          New Account
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-secondary-400" />
          <Input
            placeholder="Search accounts..."
            className="pl-9 bg-white dark:bg-secondary-900"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as AccountType | "All")}
          className="flex h-10 rounded-md border border-secondary-300 bg-white px-3 py-2 text-sm text-secondary-900 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-secondary-700 dark:bg-secondary-900 dark:text-secondary-50"
          aria-label="Filter by Account Type"
        >
          <option value="All">All Types</option>
          {ACCOUNT_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      <div className="bg-white dark:bg-secondary-900 shadow-sm border border-secondary-200 dark:border-secondary-800 rounded-xl overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[100px]">Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead>Default Posting</TableHead>
              <TableHead className="w-[100px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredAccounts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center text-secondary-500">
                  No accounts found.
                </TableCell>
              </TableRow>
            ) : (
              filteredAccounts.map((account) => (
                <TableRow key={account.id} className="group">
                  <TableCell className="font-medium text-secondary-900 dark:text-secondary-100">
                    {account.code}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium text-secondary-900 dark:text-secondary-50 flex items-center gap-2">
                        {account.name}
                        {(account as any)._pending && (
                          <span className="text-[10px] font-normal text-amber-600 dark:text-amber-400" title="Saving to the cloud...">
                            Syncing...
                          </span>
                        )}
                        {(account as any)._failed && (
                          <span
                            className="text-[10px] font-normal text-red-600 dark:text-red-400"
                            title={(account as any)._failureReason || 'This change was rejected and needs your attention.'}
                          >
                            Needs attention
                          </span>
                        )}
                      </span>
                      {account.description && (
                        <span className="text-xs text-secondary-500 line-clamp-1">
                          {account.description}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={TYPE_COLORS[account.type]}>
                      {account.type}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCurrency(account.balance)}
                  </TableCell>
                  <TableCell>
                    {ROLES_FOR_TYPE[account.type]?.length ? (
                      <div className="flex flex-wrap items-center gap-1">
                        {ROLES_FOR_TYPE[account.type]!.map((role) => {
                          const isHeld = account.defaultRole === role;
                          return (
                            <button
                              key={role}
                              type="button"
                              disabled={settingRoleForId === account.id}
                              onClick={() => handleToggleDefaultRole(account, role)}
                              title={
                                isHeld
                                  ? `This is the ${ROLE_LABEL[role]} - relevant postings target this account automatically. Click to unset.`
                                  : `Click to make this the ${ROLE_LABEL[role]}.`
                              }
                              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
                                isHeld
                                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300"
                                  : "border border-dashed border-secondary-300 text-secondary-400 opacity-0 group-hover:opacity-100 hover:text-secondary-600 dark:border-secondary-700 dark:hover:text-secondary-300"
                              }`}
                            >
                              <Star className={`h-3 w-3 ${isHeld ? "fill-current" : ""}`} />
                              {isHeld ? ROLE_SHORT_LABEL[role] : `Set as ${ROLE_SHORT_LABEL[role].replace("Default ", "")}`}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <span className="text-xs text-secondary-400">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => navigate(`/audit-logs?entityId=${account.id}&entity=Account`)}
                        title="View this account's change history"
                      >
                        <History className="h-4 w-4 text-secondary-500" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEditModal(account)}
                      >
                        <Edit className="h-4 w-4 text-secondary-500" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={selectedAccount ? "Edit Account" : "Create New Account"}
        description={selectedAccount ? "Update the details for this ledger account." : "Add a new account to your chart of accounts."}
      >
        <AccountForm 
          initialData={selectedAccount} 
          onSubmit={handleCreateOrEdit} 
          onCancel={() => setIsModalOpen(false)} 
        />
      </Modal>
    </div>
  );
}
