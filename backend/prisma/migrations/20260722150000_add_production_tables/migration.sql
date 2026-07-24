-- CreateEnum for AuditAction (only if not exists)
DO $$ BEGIN
    CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'APPROVE', 'REJECT', 'POST', 'VOID');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum for CustomFieldType (only if not exists)
DO $$ BEGIN
    CREATE TYPE "CustomFieldType" AS ENUM ('TEXT', 'NUMBER', 'DATE', 'BOOLEAN', 'SELECT', 'MULTI_SELECT');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum for ReportType (only if not exists)
DO $$ BEGIN
    CREATE TYPE "ReportType" AS ENUM ('BALANCE_SHEET', 'INCOME_STATEMENT', 'CASH_FLOW', 'TRIAL_BALANCE', 'GENERAL_LEDGER', 'ACCOUNT_ACTIVITY', 'CUSTOM');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum for PeriodStatus (only if not exists)
DO $$ BEGIN
    CREATE TYPE "PeriodStatus" AS ENUM ('OPEN', 'CLOSED', 'LOCKED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum for RecurrenceFrequency (only if not exists)
DO $$ BEGIN
    CREATE TYPE "RecurrenceFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum for DocumentType (only if not exists)
DO $$ BEGIN
    CREATE TYPE "DocumentType" AS ENUM ('INVOICE', 'RECEIPT', 'CONTRACT', 'STATEMENT', 'OTHER');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum for ApprovalStatus (only if not exists)
DO $$ BEGIN
    CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateTable: audit_logs (only if not exists)
CREATE TABLE IF NOT EXISTS "audit_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "old_values" JSONB,
    "new_values" JSONB,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable: custom_fields (only if not exists)
CREATE TABLE IF NOT EXISTS "custom_fields" (
    "id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "field_name" TEXT NOT NULL,
    "field_label" TEXT NOT NULL,
    "field_type" "CustomFieldType" NOT NULL,
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "options" JSONB,
    "default_value" TEXT,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable: custom_field_values (only if not exists)
CREATE TABLE IF NOT EXISTS "custom_field_values" (
    "id" TEXT NOT NULL,
    "custom_field_id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "value" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_field_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable: report_definitions (only if not exists)
CREATE TABLE IF NOT EXISTS "report_definitions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "report_type" "ReportType" NOT NULL,
    "description" TEXT,
    "filters" JSONB,
    "columns" JSONB,
    "sort_order" JSONB,
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable: tax_rates (only if not exists)
CREATE TABLE IF NOT EXISTS "tax_rates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "rate" DECIMAL(5,4) NOT NULL,
    "description" TEXT,
    "account_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable: fiscal_periods (only if not exists)
CREATE TABLE IF NOT EXISTS "fiscal_periods" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fiscal_year" INTEGER NOT NULL,
    "period_number" INTEGER NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "status" "PeriodStatus" NOT NULL DEFAULT 'OPEN',
    "closed_at" TIMESTAMP(3),
    "closed_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fiscal_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable: budgets (only if not exists)
CREATE TABLE IF NOT EXISTS "budgets" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "fiscal_period_id" TEXT NOT NULL,
    "budget_amount" DECIMAL(15,2) NOT NULL,
    "actual_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "variance" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable: recurring_transactions (only if not exists)
CREATE TABLE IF NOT EXISTS "recurring_transactions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "frequency" "RecurrenceFrequency" NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3),
    "last_run" TIMESTAMP(3),
    "next_run" TIMESTAMP(3) NOT NULL,
    "template_data" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurring_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable: attached_documents (only if not exists)
CREATE TABLE IF NOT EXISTS "attached_documents" (
    "id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "document_type" "DocumentType" NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "mime_type" TEXT NOT NULL,
    "storage_url" TEXT NOT NULL,
    "uploaded_by" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attached_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable: approval_workflows (only if not exists)
CREATE TABLE IF NOT EXISTS "approval_workflows" (
    "id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "required_level" INTEGER NOT NULL,
    "current_level" INTEGER NOT NULL DEFAULT 0,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by" TEXT NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_workflows_pkey" PRIMARY KEY ("id")
);

-- CreateTable: approval_steps (only if not exists)
CREATE TABLE IF NOT EXISTS "approval_steps" (
    "id" TEXT NOT NULL,
    "workflow_id" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "approver_id" TEXT,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "comments" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_steps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (only if not exists)
CREATE INDEX IF NOT EXISTS "audit_logs_user_id_idx" ON "audit_logs"("user_id");
CREATE INDEX IF NOT EXISTS "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "audit_logs_action_idx" ON "audit_logs"("action");
CREATE INDEX IF NOT EXISTS "audit_logs_created_at_idx" ON "audit_logs"("created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "custom_fields_entity_type_field_name_key" ON "custom_fields"("entity_type", "field_name");
CREATE INDEX IF NOT EXISTS "custom_fields_entity_type_is_active_idx" ON "custom_fields"("entity_type", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "custom_field_values_custom_field_id_entity_id_key" ON "custom_field_values"("custom_field_id", "entity_id");
CREATE INDEX IF NOT EXISTS "custom_field_values_entity_id_idx" ON "custom_field_values"("entity_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "report_definitions_report_type_idx" ON "report_definitions"("report_type");
CREATE INDEX IF NOT EXISTS "report_definitions_created_by_idx" ON "report_definitions"("created_by");
CREATE INDEX IF NOT EXISTS "report_definitions_is_public_idx" ON "report_definitions"("is_public");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "tax_rates_code_key" ON "tax_rates"("code");
CREATE INDEX IF NOT EXISTS "tax_rates_code_idx" ON "tax_rates"("code");
CREATE INDEX IF NOT EXISTS "tax_rates_is_active_effective_from_effective_to_idx" ON "tax_rates"("is_active", "effective_from", "effective_to");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "fiscal_periods_fiscal_year_period_number_key" ON "fiscal_periods"("fiscal_year", "period_number");
CREATE INDEX IF NOT EXISTS "fiscal_periods_fiscal_year_idx" ON "fiscal_periods"("fiscal_year");
CREATE INDEX IF NOT EXISTS "fiscal_periods_status_idx" ON "fiscal_periods"("status");
CREATE INDEX IF NOT EXISTS "fiscal_periods_start_date_end_date_idx" ON "fiscal_periods"("start_date", "end_date");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "budgets_account_id_fiscal_period_id_key" ON "budgets"("account_id", "fiscal_period_id");
CREATE INDEX IF NOT EXISTS "budgets_account_id_idx" ON "budgets"("account_id");
CREATE INDEX IF NOT EXISTS "budgets_fiscal_period_id_idx" ON "budgets"("fiscal_period_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "recurring_transactions_is_active_next_run_idx" ON "recurring_transactions"("is_active", "next_run");
CREATE INDEX IF NOT EXISTS "recurring_transactions_frequency_idx" ON "recurring_transactions"("frequency");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "attached_documents_entity_type_entity_id_idx" ON "attached_documents"("entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "attached_documents_uploaded_by_idx" ON "attached_documents"("uploaded_by");
CREATE INDEX IF NOT EXISTS "attached_documents_document_type_idx" ON "attached_documents"("document_type");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "approval_workflows_entity_type_entity_id_idx" ON "approval_workflows"("entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "approval_workflows_status_idx" ON "approval_workflows"("status");
CREATE INDEX IF NOT EXISTS "approval_workflows_requested_by_idx" ON "approval_workflows"("requested_by");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "approval_steps_workflow_id_idx" ON "approval_steps"("workflow_id");
CREATE INDEX IF NOT EXISTS "approval_steps_approver_id_idx" ON "approval_steps"("approver_id");
CREATE INDEX IF NOT EXISTS "approval_steps_status_idx" ON "approval_steps"("status");

-- AddForeignKey (only if not exists)
DO $$ BEGIN
    ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_custom_field_id_fkey" FOREIGN KEY ("custom_field_id") REFERENCES "custom_fields"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey (only if not exists)
DO $$ BEGIN
    ALTER TABLE "budgets" ADD CONSTRAINT "budgets_fiscal_period_id_fkey" FOREIGN KEY ("fiscal_period_id") REFERENCES "fiscal_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey (only if not exists)
DO $$ BEGIN
    ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "approval_workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
