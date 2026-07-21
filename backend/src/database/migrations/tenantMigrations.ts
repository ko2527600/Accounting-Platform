export interface TenantMigration {
  version: number;
  name: string;
  sql: string;
}

/**
 * Array of all tenant schema migrations in sequential order.
 * Each migration is executed against an individual tenant schema.
 */
export const TENANT_MIGRATIONS: TenantMigration[] = [
  {
    version: 1,
    name: '001_initial_tenant_core_schema',
    sql: `
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";

      -- Schema migrations tracking table within tenant schema
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      -- Chart of Accounts table
      CREATE TABLE IF NOT EXISTS accounts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        code VARCHAR(50) NOT NULL UNIQUE,
        name VARCHAR(255) NOT NULL,
        type VARCHAR(50) NOT NULL,
        parent_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
        currency VARCHAR(10) DEFAULT 'USD',
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );

      -- Journal Entries table
      CREATE TABLE IF NOT EXISTS journal_entries (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        entry_number VARCHAR(100) NOT NULL UNIQUE,
        entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
        description TEXT,
        status VARCHAR(20) DEFAULT 'DRAFT',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );

      -- Journal Entry Lines table
      CREATE TABLE IF NOT EXISTS journal_entry_lines (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        journal_entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
        account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
        debit NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
        credit NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
        description TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );

      -- Ledger table
      CREATE TABLE IF NOT EXISTS ledgers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
        transaction_date DATE NOT NULL DEFAULT CURRENT_DATE,
        journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE SET NULL,
        debit NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
        credit NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
        balance NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
        description TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );

      -- Indexes for fast querying
      CREATE INDEX IF NOT EXISTS idx_accounts_code ON accounts(code);
      CREATE INDEX IF NOT EXISTS idx_journal_entries_date ON journal_entries(entry_date);
      CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_entry ON journal_entry_lines(journal_entry_id);
      CREATE INDEX IF NOT EXISTS idx_ledgers_account ON ledgers(account_id);
      CREATE INDEX IF NOT EXISTS idx_ledgers_date ON ledgers(transaction_date);
    `
  }
];
