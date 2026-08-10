export type AccountType = 'Asset' | 'Liability' | 'Equity' | 'Revenue' | 'Expense' | 'Cost of Sales';
export type AccountStatus = 'Active' | 'Archived';

export interface Account {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  description?: string;
  status: AccountStatus;
  balance: number;
  currency: string;
  isCashEquivalent?: boolean;
  createdAt: string;
  updatedAt: string;
}

export type CreateAccountDTO = Omit<Account, 'id' | 'status' | 'balance' | 'createdAt' | 'updatedAt'>;
export type UpdateAccountDTO = Partial<CreateAccountDTO> & { status?: AccountStatus };

export type JournalStatus = 'Draft' | 'Posted' | 'Void';

export interface JournalLine {
  id: string;
  accountId: string;
  description?: string;
  debit: number;
  credit: number;
  fundId?: string;
}

export interface Fund {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  description: string | null;
  isRestricted: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface JournalEntry {
  id: string;
  entryNumber?: string;
  date: string;
  description: string;
  status: JournalStatus;
  lines: JournalLine[];
  totalDebit: number;
  totalCredit: number;
  createdAt: string;
  reversalOfEntryId?: string | null;
  reversedByEntryId?: string | null;
}

export type CreateJournalEntryDTO = Omit<JournalEntry, 'id' | 'status' | 'totalDebit' | 'totalCredit' | 'createdAt'>;
