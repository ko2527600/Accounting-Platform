-- All 6 tables below are unused today (no API surface exists yet), confirmed empty -
-- tenant_id is added as NOT NULL directly with no backfill/default needed.

-- tax_rates: add tenant_id, replace global-unique code with per-tenant-unique code
ALTER TABLE "tax_rates" ADD COLUMN "tenant_id" TEXT NOT NULL;
DROP INDEX "tax_rates_code_key";
CREATE INDEX "tax_rates_tenant_id_idx" ON "tax_rates"("tenant_id");
CREATE UNIQUE INDEX "tax_rates_tenant_id_code_key" ON "tax_rates"("tenant_id", "code");

-- fiscal_periods: add tenant_id, replace global-unique (fiscal_year, period_number) with per-tenant-unique
ALTER TABLE "fiscal_periods" ADD COLUMN "tenant_id" TEXT NOT NULL;
DROP INDEX "fiscal_periods_fiscal_year_period_number_key";
CREATE INDEX "fiscal_periods_tenant_id_idx" ON "fiscal_periods"("tenant_id");
CREATE UNIQUE INDEX "fiscal_periods_tenant_id_fiscal_year_period_number_key" ON "fiscal_periods"("tenant_id", "fiscal_year", "period_number");

-- budgets: add tenant_id
ALTER TABLE "budgets" ADD COLUMN "tenant_id" TEXT NOT NULL;
CREATE INDEX "budgets_tenant_id_idx" ON "budgets"("tenant_id");

-- recurring_transactions: add tenant_id
ALTER TABLE "recurring_transactions" ADD COLUMN "tenant_id" TEXT NOT NULL;
CREATE INDEX "recurring_transactions_tenant_id_idx" ON "recurring_transactions"("tenant_id");

-- approval_workflows: add tenant_id
ALTER TABLE "approval_workflows" ADD COLUMN "tenant_id" TEXT NOT NULL;
CREATE INDEX "approval_workflows_tenant_id_idx" ON "approval_workflows"("tenant_id");

-- approval_steps: add tenant_id
ALTER TABLE "approval_steps" ADD COLUMN "tenant_id" TEXT NOT NULL;
CREATE INDEX "approval_steps_tenant_id_idx" ON "approval_steps"("tenant_id");
