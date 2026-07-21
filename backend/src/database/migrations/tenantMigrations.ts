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
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT chk_account_type CHECK (type IN ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'))
      );

      -- Journal Entries table
      CREATE TABLE IF NOT EXISTS journal_entries (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        entry_number VARCHAR(100) NOT NULL UNIQUE,
        entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
        description TEXT,
        status VARCHAR(20) DEFAULT 'DRAFT',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT chk_journal_entry_status CHECK (status IN ('DRAFT', 'POSTED', 'VOID'))
      );

      -- Journal Entry Lines table
      CREATE TABLE IF NOT EXISTS journal_entry_lines (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        journal_entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
        account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
        debit NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
        credit NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
        description TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT chk_line_debit_non_negative CHECK (debit >= 0),
        CONSTRAINT chk_line_credit_non_negative CHECK (credit >= 0)
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
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT chk_ledger_debit_non_negative CHECK (debit >= 0),
        CONSTRAINT chk_ledger_credit_non_negative CHECK (credit >= 0)
      );

      -- Indexes for fast querying
      CREATE INDEX IF NOT EXISTS idx_accounts_code ON accounts(code);
      CREATE INDEX IF NOT EXISTS idx_journal_entries_date ON journal_entries(entry_date);
      CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_entry ON journal_entry_lines(journal_entry_id);
      CREATE INDEX IF NOT EXISTS idx_ledgers_account ON ledgers(account_id);
      CREATE INDEX IF NOT EXISTS idx_ledgers_date ON ledgers(transaction_date);
    `
  },
  {
    version: 2,
    name: '002_core_accounting_constraints_and_triggers',
    sql: `
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_account_type') THEN
          ALTER TABLE accounts ADD CONSTRAINT chk_account_type CHECK (type IN ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'));
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_journal_entry_status') THEN
          ALTER TABLE journal_entries ADD CONSTRAINT chk_journal_entry_status CHECK (status IN ('DRAFT', 'POSTED', 'VOID'));
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_line_debit_non_negative') THEN
          ALTER TABLE journal_entry_lines ADD CONSTRAINT chk_line_debit_non_negative CHECK (debit >= 0);
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_line_credit_non_negative') THEN
          ALTER TABLE journal_entry_lines ADD CONSTRAINT chk_line_credit_non_negative CHECK (credit >= 0);
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ledger_debit_non_negative') THEN
          ALTER TABLE ledgers ADD CONSTRAINT chk_ledger_debit_non_negative CHECK (debit >= 0);
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ledger_credit_non_negative') THEN
          ALTER TABLE ledgers ADD CONSTRAINT chk_ledger_credit_non_negative CHECK (credit >= 0);
        END IF;
      END $$;

      CREATE OR REPLACE FUNCTION check_journal_entry_double_entry_balance()
      RETURNS TRIGGER AS $$
      DECLARE
        v_total_debit NUMERIC(15, 2);
        v_total_credit NUMERIC(15, 2);
        v_status VARCHAR(20);
        v_entry_id UUID;
      BEGIN
        IF TG_TABLE_NAME = 'journal_entries' THEN
          v_entry_id := NEW.id;
          v_status := NEW.status;
        ELSE
          v_entry_id := NEW.journal_entry_id;
          SELECT status INTO v_status FROM journal_entries WHERE id = v_entry_id;
        END IF;

        IF v_status = 'POSTED' THEN
          SELECT COALESCE(SUM(debit), 0.00), COALESCE(SUM(credit), 0.00)
          INTO v_total_debit, v_total_credit
          FROM journal_entry_lines
          WHERE journal_entry_id = v_entry_id;

          IF v_total_debit <> v_total_credit THEN
            RAISE EXCEPTION 'Double-entry balance constraint failed: Total Debit (%) must equal Total Credit (%) for journal entry %',
              v_total_debit, v_total_credit, v_entry_id;
          END IF;

          IF v_total_debit = 0.00 AND v_total_credit = 0.00 THEN
            RAISE EXCEPTION 'Double-entry constraint failed: Journal entry % must have non-zero debit/credit lines before posting',
              v_entry_id;
          END IF;
        END IF;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_check_journal_entry_balance ON journal_entries;
      CREATE TRIGGER trg_check_journal_entry_balance
        AFTER INSERT OR UPDATE ON journal_entries
        FOR EACH ROW
        EXECUTE FUNCTION check_journal_entry_double_entry_balance();

      DROP TRIGGER IF EXISTS trg_check_journal_entry_line_balance ON journal_entry_lines;
      CREATE TRIGGER trg_check_journal_entry_line_balance
        AFTER INSERT OR UPDATE OR DELETE ON journal_entry_lines
        FOR EACH ROW
        EXECUTE FUNCTION check_journal_entry_double_entry_balance();
    `
  },
  {
    version: 3,
    name: '003_performance_indexing_and_trigger_optimizations',
    sql: `
      -- Composite & performance indexes for high-volume tenant schemas
      CREATE INDEX IF NOT EXISTS idx_ledgers_account_date ON ledgers(account_id, transaction_date);
      CREATE INDEX IF NOT EXISTS idx_journal_entries_status_date ON journal_entries(status, entry_date);
      CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_account ON journal_entry_lines(account_id);
      CREATE INDEX IF NOT EXISTS idx_accounts_parent ON accounts(parent_id);
    `
  }
];


