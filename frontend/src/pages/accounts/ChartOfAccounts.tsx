import { useState, useMemo } from "react";
import { Plus, Search, Edit } from "lucide-react";
import { useAccounts } from "../../hooks/useAccounts";
import type { Account, AccountType } from "../../types/accounting";
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
  Expense: 'secondary',
};

export function ChartOfAccounts() {
  const { accounts, createAccount, updateAccount } = useAccounts();
  const [searchTerm, setSearchTerm] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);

  const filteredAccounts = useMemo(() => {
    return accounts.filter((acc) =>
      acc.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      acc.code.includes(searchTerm)
    );
  }, [accounts, searchTerm]);

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

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
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

      <div className="flex items-center">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-secondary-400" />
          <Input
            placeholder="Search accounts..."
            className="pl-9 bg-white dark:bg-secondary-900"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      <div className="bg-white dark:bg-secondary-900 shadow-sm border border-secondary-200 dark:border-secondary-800 rounded-xl overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[100px]">Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead className="w-[70px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredAccounts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center text-secondary-500">
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
                      <span className="font-medium text-secondary-900 dark:text-secondary-50">
                        {account.name}
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
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      onClick={() => openEditModal(account)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Edit className="h-4 w-4 text-secondary-500" />
                    </Button>
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
