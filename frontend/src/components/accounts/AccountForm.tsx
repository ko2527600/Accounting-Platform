import { useState, useEffect } from "react";
import type { Account, AccountType, CreateAccountDTO, UpdateAccountDTO } from "../../types/accounting";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";

interface AccountFormProps {
  initialData?: Account | null;
  onSubmit: (data: CreateAccountDTO | UpdateAccountDTO) => Promise<void>;
  onCancel: () => void;
}

export function AccountForm({ initialData, onSubmit, onCancel }: AccountFormProps) {
  const [formData, setFormData] = useState<Partial<Account>>({
    code: "",
    name: "",
    type: "Asset",
    description: "",
  });
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (initialData) {
      setFormData(initialData);
    }
  }, [initialData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await onSubmit(formData as CreateAccountDTO | UpdateAccountDTO);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="code" className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
            Account Code
          </label>
          <Input
            id="code"
            required
            autoFocus
            value={formData.code}
            onChange={(e) => setFormData({ ...formData, code: e.target.value })}
            placeholder="e.g. 1000"
          />
        </div>
        <div>
          <label htmlFor="type" className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
            Account Type
          </label>
          <select
            id="type"
            required
            value={formData.type}
            onChange={(e) => setFormData({ ...formData, type: e.target.value as AccountType })}
            className="flex h-10 w-full rounded-md border border-secondary-300 bg-white px-3 py-2 text-sm text-secondary-900 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-secondary-700 dark:bg-secondary-900 dark:text-secondary-50"
          >
            <option value="Asset">Asset</option>
            <option value="Liability">Liability</option>
            <option value="Equity">Equity</option>
            <option value="Revenue">Revenue</option>
            <option value="Expense">Expense</option>
          </select>
        </div>
      </div>
      
      <div>
        <label htmlFor="name" className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
          Account Name
        </label>
        <Input
          id="name"
          required
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder="e.g. Cash and Cash Equivalents"
        />
      </div>

      <div>
        <label htmlFor="description" className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
          Description (Optional)
        </label>
        <textarea
          id="description"
          value={formData.description || ""}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          rows={3}
          className="flex w-full rounded-md border border-secondary-300 bg-white px-3 py-2 text-sm text-secondary-900 placeholder:text-secondary-400 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-secondary-700 dark:bg-secondary-900 dark:text-secondary-50 dark:placeholder:text-secondary-500"
          placeholder="Brief description of the account's purpose..."
        />
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t border-secondary-200 dark:border-secondary-800">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" isLoading={isLoading}>
          {initialData ? "Save Changes" : "Create Account"}
        </Button>
      </div>
    </form>
  );
}
