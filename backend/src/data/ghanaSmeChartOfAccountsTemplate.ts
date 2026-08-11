export interface ChartOfAccountsTemplateEntry {
  code: string;
  name: string;
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'COST_OF_SALES' | 'EXPENSE';
}

/**
 * A starting chart of accounts for a typical Ghanaian small/medium
 * business - covers cash/bank/mobile money, VAT/NHIL/GETFund payable
 * (matching TaxRate's Ghana VAT preset), and common trading-business expense
 * lines. Entirely editable/deletable afterward through the normal Chart of
 * Accounts page - this is a starting point, not a lock-in.
 */
export const GHANA_SME_CHART_OF_ACCOUNTS_TEMPLATE: ChartOfAccountsTemplateEntry[] = [
  // Assets
  { code: '1000', name: 'Cash on Hand', type: 'ASSET' },
  { code: '1010', name: 'Cash Till', type: 'ASSET' },
  { code: '1020', name: 'Bank Account', type: 'ASSET' },
  { code: '1030', name: 'Mobile Money Account', type: 'ASSET' },
  { code: '1100', name: 'Accounts Receivable', type: 'ASSET' },
  { code: '1200', name: 'Inventory', type: 'ASSET' },
  { code: '1500', name: 'Furniture & Equipment', type: 'ASSET' },

  // Liabilities
  { code: '2000', name: 'Accounts Payable', type: 'LIABILITY' },
  { code: '2100', name: 'VAT Payable', type: 'LIABILITY' },
  { code: '2110', name: 'NHIL Payable', type: 'LIABILITY' },
  { code: '2120', name: 'GETFund Levy Payable', type: 'LIABILITY' },
  { code: '2200', name: 'Staff Salaries Payable', type: 'LIABILITY' },
  { code: '2300', name: 'Short-Term Loans', type: 'LIABILITY' },

  // Equity
  { code: '3000', name: "Owner's Capital", type: 'EQUITY' },
  { code: '3010', name: "Owner's Drawings", type: 'EQUITY' },
  { code: '3900', name: 'Opening Balance Equity', type: 'EQUITY' },

  // Revenue
  { code: '4000', name: 'Sales Revenue', type: 'REVENUE' },
  { code: '4100', name: 'Service Revenue', type: 'REVENUE' },
  { code: '4900', name: 'Other Income', type: 'REVENUE' },

  // Cost of Sales
  { code: '5000', name: 'Cost of Goods Sold', type: 'COST_OF_SALES' },

  // Expenses
  { code: '6000', name: 'Rent Expense', type: 'EXPENSE' },
  { code: '6010', name: 'Utilities Expense', type: 'EXPENSE' },
  { code: '6020', name: 'Salaries & Wages Expense', type: 'EXPENSE' },
  { code: '6030', name: 'Transport & Fuel Expense', type: 'EXPENSE' },
  { code: '6040', name: 'Communication Expense', type: 'EXPENSE' },
  { code: '6050', name: 'Office Supplies Expense', type: 'EXPENSE' },
  { code: '6060', name: 'Bank Charges', type: 'EXPENSE' },
  { code: '6070', name: 'Repairs & Maintenance Expense', type: 'EXPENSE' },
  { code: '6900', name: 'Miscellaneous Expense', type: 'EXPENSE' },
];
