export type AccountType = 'Asset' | 'Liability' | 'Equity' | 'Revenue' | 'Expense';
export type AccountStatus = 'Active' | 'Archived';

export interface Account {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  description?: string;
  status: AccountStatus;
  balance: number;
  createdAt: string;
  updatedAt: string;
}

export type CreateAccountDTO = Omit<Account, 'id' | 'status' | 'balance' | 'createdAt' | 'updatedAt'>;
export type UpdateAccountDTO = Partial<CreateAccountDTO> & { status?: AccountStatus };

export type JournalStatus = 'Draft' | 'Posted';

export interface JournalLine {
  id: string;
  accountId: string;
  description?: string;
  debit: number;
  credit: number;
}

export interface JournalEntry {
  id: string;
  date: string;
  description: string;
  status: JournalStatus;
  lines: JournalLine[];
  totalDebit: number;
  totalCredit: number;
  createdAt: string;
}

export type CreateJournalEntryDTO = Omit<JournalEntry, 'id' | 'status' | 'totalDebit' | 'totalCredit' | 'createdAt'>;
