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
      CREATE CONSTRAINT TRIGGER trg_check_journal_entry_balance
        AFTER INSERT OR UPDATE ON journal_entries
        DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW
        EXECUTE FUNCTION check_journal_entry_double_entry_balance();

      DROP TRIGGER IF EXISTS trg_check_journal_entry_line_balance ON journal_entry_lines;
      CREATE CONSTRAINT TRIGGER trg_check_journal_entry_line_balance
        AFTER INSERT OR UPDATE OR DELETE ON journal_entry_lines
        DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW
        EXECUTE FUNCTION check_journal_entry_double_entry_balance();
    `
  },
  {
    version: 3,
    name: '003_performance_indexing_and_trigger_optimizations',
    sql: `
      -- Composite & performance indexes for high-volume tenant schemas
      CREATE INDEX IF NOT EXISTS idx_ledgers_account_date ON ledgers(account_id, transaction_date, created_at);
      CREATE INDEX IF NOT EXISTS idx_journal_entries_status_date ON journal_entries(status, entry_date);
      CREATE INDEX IF NOT EXISTS idx_posted_journal_entries ON journal_entries(entry_date) WHERE status = 'POSTED';
      CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_account ON journal_entry_lines(account_id);
      CREATE INDEX IF NOT EXISTS idx_accounts_parent ON accounts(parent_id);
    `
  },
  {
    version: 4,
    name: '004_add_cash_equivalent_flag',
    sql: `
      -- Marks which ASSET accounts represent cash/bank/till balances, so the
      -- Cash Flow Statement can separate "cash itself" from every other
      -- account whose change in balance is a source or use of that cash.
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS is_cash_equivalent BOOLEAN NOT NULL DEFAULT false;

      -- Backfill existing accounts using the same Cash/Bank/Till naming
      -- convention already implicit across this codebase (e.g. the '1010'
      -- code used by invoices.ts/bills.ts default payment postings), so
      -- tenants get a working report immediately without manual setup.
      UPDATE accounts
      SET is_cash_equivalent = true
      WHERE type = 'ASSET'
        AND is_cash_equivalent = false
        AND (name ILIKE '%cash%' OR name ILIKE '%bank%' OR name ILIKE '%till%');

      CREATE INDEX IF NOT EXISTS idx_accounts_is_cash_equivalent ON accounts(is_cash_equivalent);
    `
  },
  {
    version: 5,
    name: '005_add_journal_entry_reversal_linkage',
    sql: `
      -- Traceability for auto-generated reversing entries created when a
      -- POSTED journal entry is voided. reversal_of_entry_id lives on the
      -- NEW reversal, pointing back to the entry it corrects;
      -- reversed_by_entry_id lives on the ORIGINAL, pointing forward to its
      -- reversal. Both nullable - normal entries never set them. No new
      -- status value: a reversed original still uses the existing VOID
      -- status (see journalEntryService.voidJournalEntry).
      ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS reversal_of_entry_id UUID REFERENCES journal_entries(id) ON DELETE SET NULL;
      ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS reversed_by_entry_id UUID REFERENCES journal_entries(id) ON DELETE SET NULL;

      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_reversal_not_self') THEN
          ALTER TABLE journal_entries ADD CONSTRAINT chk_reversal_not_self CHECK (reversal_of_entry_id IS NULL OR reversal_of_entry_id <> id);
        END IF;
      END $$;

      CREATE INDEX IF NOT EXISTS idx_journal_entries_reversal_of ON journal_entries(reversal_of_entry_id);
    `
  },
  {
    version: 6,
    name: '006_add_cost_of_sales_account_type',
    sql: `
      -- Adds a real Cost of Sales account type so tenants can post COGS
      -- and get a genuine Gross Profit line on the P&L (Revenue - Cost of
      -- Sales), rather than Cost of Sales being silently indistinguishable
      -- from ordinary Operating Expenses. accounts.type is a plain VARCHAR +
      -- CHECK (not a global Postgres enum, unlike journal_entries.status),
      -- so this is a simple additive constraint swap.
      ALTER TABLE accounts DROP CONSTRAINT IF EXISTS chk_account_type;
      ALTER TABLE accounts ADD CONSTRAINT chk_account_type CHECK (type IN ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE', 'COST_OF_SALES'));
    `
  },
  {
    version: 7,
    name: '007_add_fund_id_to_journal_lines_and_ledgers',
    sql: `
      -- Fund dimension for restricted-fund accounting (NGO/church/school
      -- tenants). fund_id is a bare nullable UUID column, not a real FK -
      -- Fund lives in the shared public.funds table (tenantId-scoped Prisma
      -- model), not this tenant's own schema, so it can't be a native FK
      -- across schemas. Existence/tenant-ownership is instead validated at
      -- the service layer before every write (see fundService.validateFundId),
      -- the same cross-schema-reference pattern TaxRate.accountId already
      -- uses in reverse. Nullable and purely additive - every existing
      -- line/ledger row is fund-less (general/unrestricted) and keeps
      -- working unchanged - NULL simply means "not tagged to any fund."
      ALTER TABLE journal_entry_lines ADD COLUMN IF NOT EXISTS fund_id UUID;
      ALTER TABLE ledgers ADD COLUMN IF NOT EXISTS fund_id UUID;

      CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_fund ON journal_entry_lines(fund_id);
      CREATE INDEX IF NOT EXISTS idx_ledgers_fund ON ledgers(fund_id);
    `
  },
  {
    version: 8,
    name: '008_add_account_client_txn_id',
    sql: `
      -- Client-generated dedup key for offline-queued/retried account
      -- creation (local-first sync pilot, see STATUS.md) - same
      -- clientTxnId pattern already proven by CashSale/Invoice, added here
      -- too since accounts.* lives in this per-tenant schema (raw SQL, not
      -- Prisma-managed) rather than the shared public schema.
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS client_txn_id UUID;

      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_accounts_client_txn_id') THEN
          ALTER TABLE accounts ADD CONSTRAINT uq_accounts_client_txn_id UNIQUE (client_txn_id);
        END IF;
      END $$;
    `
  },
  {
    version: 9,
    name: '009_add_account_default_role',
    sql: `
      -- Which single account the auto-posting services (invoice payments,
      -- credit/debit notes, vendor bill payments, expense reimbursements)
      -- should target for the generic "cash"/"revenue"/"expense" side of a
      -- transaction. Previously resolved by guessing a hardcoded account
      -- CODE ('1010'/'4010'/'5010') with an index-based fallback
      -- (accounts[1], accounts[accounts.length-1]) that silently posted to
      -- the WRONG account - e.g. crediting an ASSET account as if it were
      -- REVENUE - whenever a tenant's chart didn't happen to use those exact
      -- codes. The platform's own built-in Ghana SME starter template
      -- doesn't (Sales Revenue is coded 4000, not 4010, and no account is
      -- coded 5010 at all) - a real, silent revenue/cash-recognition bug for
      -- any tenant using that template unmodified. Explicit, tenant-visible
      -- designation instead of a magic-number coincidence.
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS default_role VARCHAR(20);

      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_account_default_role') THEN
          ALTER TABLE accounts ADD CONSTRAINT chk_account_default_role CHECK (default_role IN ('CASH', 'REVENUE', 'EXPENSE'));
        END IF;
      END $$;

      -- At most one account can hold a given role at a time.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_default_role_unique ON accounts(default_role) WHERE default_role IS NOT NULL;

      -- Retroactive backfill for every tenant that already exists, not just
      -- new signups - this bug was already live, so the fix must apply
      -- automatically the next time each tenant's schema is touched, same
      -- "no manual setup required" approach migration 004 used for
      -- is_cash_equivalent. Deterministic lowest-code pick per role - fully
      -- visible and changeable afterward in Chart of Accounts.
      UPDATE accounts SET default_role = 'CASH'
      WHERE id = (
        SELECT id FROM accounts WHERE type = 'ASSET' AND is_cash_equivalent = true ORDER BY code ASC LIMIT 1
      );

      UPDATE accounts SET default_role = 'REVENUE'
      WHERE id = (
        SELECT id FROM accounts WHERE type = 'REVENUE' ORDER BY code ASC LIMIT 1
      );

      -- Prefer an account that reads like a catch-all ("Miscellaneous...")
      -- over whatever merely has the lowest code, since this is the target
      -- for expense postings that have no more specific category.
      UPDATE accounts SET default_role = 'EXPENSE'
      WHERE id = (
        SELECT id FROM accounts WHERE type = 'EXPENSE' ORDER BY (name ILIKE '%miscellaneous%') DESC, code ASC LIMIT 1
      );
    `
  },
  {
    version: 10,
    name: '010_add_fixed_asset_support',
    sql: `
      -- migration 009 sized default_role VARCHAR(20), enough for CASH/
      -- REVENUE/EXPENSE but not 'ACCUMULATED_DEPRECIATION' (25 chars) -
      -- widen before it's ever written, rather than after a real 500 on the
      -- designation endpoint teaches us the hard way.
      ALTER TABLE accounts ALTER COLUMN default_role TYPE VARCHAR(30);

      -- Marks which ASSET accounts represent long-lived fixed assets
      -- (Vehicles, Equipment, Furniture, etc.) rather than ordinary
      -- working-capital assets - mirrors is_cash_equivalent's own design
      -- (multiple accounts can hold the flag, unlike default_role's
      -- at-most-one-per-role constraint). Drives the Cash Flow Statement's
      -- new Investing Activities section: a change in one of these accounts'
      -- balance is capex, not an ordinary operating working-capital swing.
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS is_fixed_asset BOOLEAN NOT NULL DEFAULT false;

      -- Two new default-posting roles for the Fixed Asset Management feature
      -- (see fixedAssetService.ts): DEPRECIATION_EXPENSE (the P&L expense
      -- side of a period's depreciation) and ACCUMULATED_DEPRECIATION (the
      -- contra-asset account depreciation credits). Unlike CASH/REVENUE/
      -- EXPENSE there is no legacy account-code convention to fall back to
      -- for these - a tenant must explicitly designate both via the same
      -- Chart of Accounts "Default Posting" mechanism before depreciation
      -- can post, same "clear error over silent wrong guess" philosophy as
      -- migration 009. Postgres has no ALTER CONSTRAINT for a CHECK clause,
      -- so the old constraint is dropped and recreated with the wider list.
      -- conrelid = 'accounts'::regclass scopes the pg_constraint lookup to
      -- THIS schema's own accounts table (resolved via search_path) -
      -- conname alone is not unique database-wide across every tenant
      -- schema, so a bare "WHERE conname = ..." check (as migration 009's
      -- own ADD-side check already does) can false-positive against some
      -- other tenant's identically-named constraint and either skip an add
      -- that should have happened or, as caught here, attempt to drop a
      -- constraint that was never actually added to this table.
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_account_default_role' AND conrelid = 'accounts'::regclass) THEN
          ALTER TABLE accounts DROP CONSTRAINT chk_account_default_role;
        END IF;
        ALTER TABLE accounts ADD CONSTRAINT chk_account_default_role
          CHECK (default_role IN ('CASH', 'REVENUE', 'EXPENSE', 'DEPRECIATION_EXPENSE', 'ACCUMULATED_DEPRECIATION'));
      END $$;
    `
  },
  {
    version: 11,
    name: '011_add_cogs_inventory_asset_roles',
    sql: `
      -- Two new default-posting roles for automatic COGS posting when goods
      -- are sold via POS or invoice:
      --   COGS            - the P&L debit side (Cost of Goods Sold / Cost of Sales)
      --   INVENTORY_ASSET - the balance-sheet credit side (Inventory asset account)
      -- Same "at-most-one-per-role" unique constraint as the existing roles.
      -- Widens the CHECK constraint (conrelid guard avoids the cross-tenant
      -- false-positive documented in migration 010).
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_account_default_role' AND conrelid = 'accounts'::regclass) THEN
          ALTER TABLE accounts DROP CONSTRAINT chk_account_default_role;
        END IF;
        ALTER TABLE accounts ADD CONSTRAINT chk_account_default_role
          CHECK (default_role IN ('CASH', 'REVENUE', 'EXPENSE', 'DEPRECIATION_EXPENSE', 'ACCUMULATED_DEPRECIATION', 'COGS', 'INVENTORY_ASSET'));
      END $$;

      -- Retroactive auto-designation for existing tenants: pick the lowest-code
      -- COST_OF_SALES account as COGS (if one exists and none is already
      -- designated), and the lowest-code ASSET account that is neither a cash
      -- equivalent nor a fixed asset as INVENTORY_ASSET.
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM accounts WHERE default_role = 'COGS') THEN
          UPDATE accounts SET default_role = 'COGS'
          WHERE id = (
            SELECT id FROM accounts WHERE type = 'COST_OF_SALES' ORDER BY code ASC LIMIT 1
          );
        END IF;

        IF NOT EXISTS (SELECT 1 FROM accounts WHERE default_role = 'INVENTORY_ASSET') THEN
          UPDATE accounts SET default_role = 'INVENTORY_ASSET'
          WHERE id = (
            SELECT id FROM accounts
            WHERE type = 'ASSET'
              AND is_cash_equivalent = false
              AND is_fixed_asset = false
              AND (name ILIKE '%inventor%' OR name ILIKE '%stock%' OR name ILIKE '%goods%')
            ORDER BY code ASC LIMIT 1
          );
        END IF;
      END $$;
    `
  },
  {
    version: 12,
    name: '012_add_payroll_tables',
    sql: `
      -- Widen the default_role CHECK to include Ghana Payroll posting roles.
      -- (conrelid guard avoids a cross-tenant false-positive where another
      -- tenant schema already dropped the old constraint during its own run.)
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_account_default_role' AND conrelid = 'accounts'::regclass) THEN
          ALTER TABLE accounts DROP CONSTRAINT chk_account_default_role;
        END IF;
        ALTER TABLE accounts ADD CONSTRAINT chk_account_default_role
          CHECK (default_role IN (
            'CASH', 'REVENUE', 'EXPENSE', 'DEPRECIATION_EXPENSE', 'ACCUMULATED_DEPRECIATION',
            'COGS', 'INVENTORY_ASSET',
            'SALARY_EXPENSE', 'EMPLOYER_SSNIT_EXPENSE', 'PAYE_PAYABLE', 'SSNIT_PAYABLE', 'NET_PAY_PAYABLE'
          ));
      END $$;

      -- Employees roster for payroll processing.
      CREATE TABLE IF NOT EXISTS employees (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        employee_number VARCHAR(50) NOT NULL UNIQUE,
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        email VARCHAR(255),
        phone VARCHAR(50),
        position VARCHAR(100),
        department VARCHAR(100),
        gross_salary NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
        date_of_joining DATE,
        date_of_leaving DATE,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );

      -- One payroll processing run per month.
      CREATE TABLE IF NOT EXISTS payroll_runs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        run_number VARCHAR(100) NOT NULL UNIQUE,
        period_month INTEGER NOT NULL,
        period_year INTEGER NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
        total_gross NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
        total_paye NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
        total_ssnit_employee NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
        total_ssnit_employer NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
        total_net_pay NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
        journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT chk_payroll_run_status CHECK (status IN ('DRAFT', 'POSTED', 'VOID')),
        CONSTRAINT chk_payroll_run_month CHECK (period_month BETWEEN 1 AND 12)
      );

      -- Per-employee payslip within a payroll run.
      CREATE TABLE IF NOT EXISTS payslips (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        payroll_run_id UUID NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
        employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
        gross_salary NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
        paye NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
        ssnit_employee NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
        ssnit_employer NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
        net_pay NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_payslip_run_employee UNIQUE (payroll_run_id, employee_id)
      );

      CREATE INDEX IF NOT EXISTS idx_employees_is_active ON employees(is_active);
      CREATE INDEX IF NOT EXISTS idx_payroll_runs_period ON payroll_runs(period_year, period_month);
      CREATE INDEX IF NOT EXISTS idx_payslips_run ON payslips(payroll_run_id);
      CREATE INDEX IF NOT EXISTS idx_payslips_employee ON payslips(employee_id);
    `
  }
];


