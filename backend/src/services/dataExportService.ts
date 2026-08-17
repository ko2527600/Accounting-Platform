import { PrismaClient } from '@prisma/client';

/**
 * One entry per table included in a full-tenant data export. `tenantScoped`
 * distinguishes the two physical storage models this backend uses (see
 * withTenantDb): per-tenant-schema tables (Account/JournalEntry/
 * JournalEntryLine/Ledger - isolated by Postgres search_path, no tenantId
 * column at all) vs. shared-schema tables (everything else - one physical
 * table for all tenants, isolated by a `tenantId` filter). Both kinds are
 * reachable through the same withCurrentTenantDb client, since its
 * search_path includes both the tenant schema and `public`.
 */
export interface ExportTableDef {
  key: string;
  label: string;
  description: string;
  /**
   * The physical per-tenant-schema table to SELECT * FROM via raw SQL,
   * relying on the caller's SET LOCAL search_path (see withTenantDb). Set
   * for Account/JournalEntry/JournalEntryLine/Ledger only. These tables have
   * no `tenantId` column and, critically, are NEVER read through the Prisma
   * Client's model delegate (`client.account.findMany()`) anywhere in this
   * codebase (see accountRepository.ts/journalEntryRepository.ts/
   * ledgerRepository.ts) - Prisma's generated queries for these models
   * resolve against the schema in DATABASE_URL's `?schema=` param and do not
   * follow a transaction-scoped search_path override, so they silently
   * return zero rows against any other tenant's schema. Raw SQL has no such
   * limitation, which is exactly why every other reader of these tables uses it.
   */
  rawTable?: string;
  /** Prisma Client model delegate name, for ordinary shared-schema tables. */
  modelAccessor?: string;
  tenantScoped: boolean;
  /** Fields to drop from every row before it ever leaves the server - credentials/tokens, never partial business data. */
  redactFields?: string[];
}

export const EXPORT_TABLES: ExportTableDef[] = [
  { key: 'accounts', label: 'Chart of Accounts', description: 'General ledger accounts (code, name, type, parent hierarchy).', rawTable: 'accounts', tenantScoped: false },
  { key: 'journal_entries', label: 'Journal Entries', description: 'Every journal voucher/entry header (date, description, status).', rawTable: 'journal_entries', tenantScoped: false },
  { key: 'journal_entry_lines', label: 'Journal Entry Lines', description: 'Debit/credit lines belonging to each journal entry.', rawTable: 'journal_entry_lines', tenantScoped: false },
  { key: 'ledgers', label: 'General Ledger', description: 'Posted ledger rows (the source of truth for account balances).', rawTable: 'ledgers', tenantScoped: false },
  { key: 'customers', label: 'Customers', description: 'Customer master records.', modelAccessor: 'customer', tenantScoped: true },
  { key: 'vendors', label: 'Vendors', description: 'Vendor/supplier master records.', modelAccessor: 'vendor', tenantScoped: true },
  { key: 'invoices', label: 'Invoices', description: 'Sales invoices, including tax breakdown and payment status.', modelAccessor: 'invoice', tenantScoped: true },
  { key: 'invoice_items', label: 'Invoice Line Items', description: 'Line items belonging to each invoice.', modelAccessor: 'invoiceItem', tenantScoped: true },
  { key: 'credit_notes', label: 'Credit Notes', description: 'Credit notes issued against invoices.', modelAccessor: 'creditNote', tenantScoped: true },
  { key: 'vendor_bills', label: 'Vendor Bills', description: 'Purchase bills received from vendors.', modelAccessor: 'vendorBill', tenantScoped: true },
  { key: 'vendor_bill_lines', label: 'Vendor Bill Line Items', description: 'Line items belonging to each vendor bill.', modelAccessor: 'vendorBillLine', tenantScoped: true },
  { key: 'debit_notes', label: 'Debit Notes', description: 'Debit notes issued against vendor bills.', modelAccessor: 'debitNote', tenantScoped: true },
  { key: 'warehouses', label: 'Warehouses', description: 'Warehouse/shop locations.', modelAccessor: 'warehouse', tenantScoped: true },
  { key: 'inventory_items', label: 'Inventory Items', description: 'Stocked product/SKU master records.', modelAccessor: 'inventoryItem', tenantScoped: true },
  { key: 'warehouse_stock', label: 'Warehouse Stock', description: 'Current on-hand quantity per item per warehouse.', modelAccessor: 'warehouseStock', tenantScoped: true },
  { key: 'stock_transfers', label: 'Stock Transfers', description: 'Inter-warehouse stock transfer headers.', modelAccessor: 'stockTransfer', tenantScoped: true },
  { key: 'stock_transfer_items', label: 'Stock Transfer Line Items', description: 'Line items belonging to each stock transfer.', modelAccessor: 'stockTransferItem', tenantScoped: true },
  { key: 'stock_adjustments', label: 'Stock Adjustments', description: 'Manual stock corrections, with reason and before/after quantity.', modelAccessor: 'stockAdjustment', tenantScoped: true },
  { key: 'cash_tills', label: 'Cash Tills', description: 'POS till open/close sessions.', modelAccessor: 'cashTill', tenantScoped: true },
  { key: 'cash_sales', label: 'Cash Sales (POS)', description: 'Point-of-sale cash sale transactions.', modelAccessor: 'cashSale', tenantScoped: true },
  { key: 'cash_sale_lines', label: 'Cash Sale Line Items', description: 'Line items belonging to each POS cash sale.', modelAccessor: 'cashSaleLine', tenantScoped: true },
  { key: 'daily_closeout_reports', label: 'Daily Till Closeouts', description: 'End-of-day till reconciliation reports.', modelAccessor: 'dailyCloseoutReport', tenantScoped: true },
  { key: 'tax_rates', label: 'Tax Rates', description: 'Configured tax rates (e.g. Ghana VAT/NHIL/GETFund) and their GL destinations.', modelAccessor: 'taxRate', tenantScoped: true },
  { key: 'funds', label: 'Funds', description: 'Restricted/unrestricted donor funds (nonprofit tenants).', modelAccessor: 'fund', tenantScoped: true },
  { key: 'fiscal_periods', label: 'Fiscal Periods', description: 'Accounting period open/close/lock status.', modelAccessor: 'fiscalPeriod', tenantScoped: true },
  { key: 'budgets', label: 'Budgets', description: 'Per-account budget targets by period.', modelAccessor: 'budget', tenantScoped: true },
  { key: 'recurring_transactions', label: 'Recurring Transactions', description: 'Scheduled recurring journal entries/invoices/bills.', modelAccessor: 'recurringTransaction', tenantScoped: true },
  { key: 'approval_workflows', label: 'Approval Workflows', description: 'Approval requests raised against entries/invoices/bills.', modelAccessor: 'approvalWorkflow', tenantScoped: true },
  { key: 'approval_steps', label: 'Approval Steps', description: 'Individual approve/reject decisions belonging to each workflow.', modelAccessor: 'approvalStep', tenantScoped: true },
  { key: 'bank_accounts', label: 'Bank Accounts', description: 'Connected bank accounts (Mono Connect).', modelAccessor: 'bankAccount', tenantScoped: true },
  { key: 'bank_transactions', label: 'Bank Transactions', description: 'Imported/synced bank transaction lines.', modelAccessor: 'bankTransaction', tenantScoped: true },
  { key: 'expense_claims', label: 'Expense Claims', description: 'Staff expense claims and their approval/reimbursement status.', modelAccessor: 'expenseClaim', tenantScoped: true },
  { key: 'custom_fields', label: 'Custom Fields', description: 'Tenant-defined custom field definitions.', modelAccessor: 'customField', tenantScoped: true },
  { key: 'custom_field_values', label: 'Custom Field Values', description: 'Values entered for each custom field on each record.', modelAccessor: 'customFieldValue', tenantScoped: true },
  { key: 'team_members', label: 'Team Members', description: 'User accounts on this tenant (login credentials and verification tokens are never included).', modelAccessor: 'user', tenantScoped: true, redactFields: ['password', 'emailVerificationToken', 'smsVerificationCode'] },
  { key: 'audit_logs', label: 'Audit Trail', description: 'The full, DB-enforced append-only history of who changed what, when, and why.', modelAccessor: 'auditLog', tenantScoped: true },
];

function redact(row: Record<string, any>, fields?: string[]): Record<string, any> {
  if (!fields || fields.length === 0) return row;
  const copy = { ...row };
  for (const field of fields) delete copy[field];
  return copy;
}

/** Fetches every table in EXPORT_TABLES for the current tenant, using the caller's already-tenant-scoped client (see withCurrentTenantDb). */
export async function collectTenantExportData(
  client: PrismaClient,
  tenantId: string
): Promise<Record<string, Record<string, any>[]>> {
  const result: Record<string, Record<string, any>[]> = {};
  for (const table of EXPORT_TABLES) {
    let rows: Record<string, any>[];
    if (table.rawTable) {
      rows = await (client as any).$queryRawUnsafe(`SELECT * FROM "${table.rawTable}"`);
    } else {
      const accessor = (client as any)[table.modelAccessor!];
      rows = table.tenantScoped
        ? await accessor.findMany({ where: { tenantId } })
        : await accessor.findMany();
    }
    result[table.key] = rows.map((row: Record<string, any>) => redact(row, table.redactFields));
  }
  return result;
}

/** Renders a value for CSV output: ISO timestamps for dates, JSON for nested objects/arrays, otherwise left as-is for the CSV escaper to stringify. */
export function csvCellValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value !== null && typeof value === 'object') return JSON.stringify(value);
  return value;
}

/** Converts one table's rows into (headers, rows) for buildCsv - headers are the union of keys across all rows, so an occasional sparse field doesn't get silently dropped. */
export function rowsToCsvTable(rows: Record<string, any>[]): { headers: string[]; rows: unknown[][] } {
  const headerSet = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) headerSet.add(key);
  }
  const headers = Array.from(headerSet);
  return {
    headers,
    rows: rows.map((row) => headers.map((h) => csvCellValue(row[h]))),
  };
}
