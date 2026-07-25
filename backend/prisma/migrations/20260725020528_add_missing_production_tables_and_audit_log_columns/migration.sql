/*
  Warnings:

  - You are about to drop the column `entity_type` on the `audit_logs` table. All the data in the column will be lost.
  - You are about to drop the column `new_values` on the `audit_logs` table. All the data in the column will be lost.
  - You are about to drop the column `old_values` on the `audit_logs` table. All the data in the column will be lost.
  - You are about to drop the column `user_agent` on the `audit_logs` table. All the data in the column will be lost.
  - Added the required column `entity` to the `audit_logs` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `action` on the `audit_logs` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- DropIndex
DROP INDEX "audit_logs_action_idx";

-- DropIndex
DROP INDEX "audit_logs_entity_type_entity_id_idx";

-- AlterTable
ALTER TABLE "audit_logs" DROP COLUMN "entity_type",
DROP COLUMN "new_values",
DROP COLUMN "old_values",
DROP COLUMN "user_agent",
ADD COLUMN     "details" TEXT,
ADD COLUMN     "entity" TEXT NOT NULL,
ADD COLUMN     "user_email" TEXT,
ALTER COLUMN "user_id" DROP NOT NULL,
DROP COLUMN "action",
ADD COLUMN     "action" TEXT NOT NULL,
ALTER COLUMN "entity_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "email_verification_token" TEXT,
ADD COLUMN     "is_email_verified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "is_phone_verified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "sms_verification_code" TEXT;

-- CreateTable
CREATE TABLE "invitations" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'Viewer',
    "token" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "account_number" TEXT NOT NULL,
    "bank_name" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "current_balance" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_transactions" (
    "id" TEXT NOT NULL,
    "bank_account_id" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "payee" TEXT NOT NULL,
    "description" TEXT,
    "posted_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'UNRECONCILED',
    "ledger_id" TEXT,

    CONSTRAINT "bank_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "issue_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_date" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "exchange_rate" DECIMAL(10,4) NOT NULL DEFAULT 1.0000,
    "subtotal" DECIMAL(15,2) NOT NULL,
    "tax" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "total" DECIMAL(15,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "journal_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_items" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL,
    "unit_price" DECIMAL(15,2) NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,

    CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendors" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_bills" (
    "id" TEXT NOT NULL,
    "bill_number" TEXT NOT NULL,
    "vendor_id" TEXT NOT NULL,
    "bill_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_date" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" TEXT NOT NULL DEFAULT 'UNPAID',
    "journal_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouses" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "location" TEXT,
    "manager_name" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_items" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'General',
    "unit_of_measure" TEXT NOT NULL DEFAULT 'pcs',
    "cost_price" DECIMAL(15,2) NOT NULL,
    "selling_price" DECIMAL(15,2) NOT NULL,
    "reorder_level" INTEGER NOT NULL DEFAULT 10,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouse_stocks" (
    "id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "quantity_on_hand" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "warehouse_stocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transfers" (
    "id" TEXT NOT NULL,
    "transfer_number" TEXT NOT NULL,
    "from_warehouse_id" TEXT NOT NULL,
    "to_warehouse_id" TEXT NOT NULL,
    "transfer_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transfer_items" (
    "id" TEXT NOT NULL,
    "transfer_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "stock_transfer_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_tills" (
    "id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "opened_by" TEXT NOT NULL,
    "opening_cash" DECIMAL(15,2) NOT NULL,
    "cash_sales_total" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "actual_ending_cash" DECIMAL(15,2),
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "cash_tills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_sales" (
    "id" TEXT NOT NULL,
    "till_id" TEXT NOT NULL,
    "receipt_no" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "cash_given" DECIMAL(15,2) NOT NULL,
    "change_given" DECIMAL(15,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_closeout_reports" (
    "id" TEXT NOT NULL,
    "till_id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "closed_by" TEXT NOT NULL,
    "opening_cash" DECIMAL(15,2) NOT NULL,
    "cash_sales" DECIMAL(15,2) NOT NULL,
    "expected_cash" DECIMAL(15,2) NOT NULL,
    "actual_cash" DECIMAL(15,2) NOT NULL,
    "discrepancy" DECIMAL(15,2) NOT NULL,
    "items_sold" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "closed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_closeout_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'SYSTEM',
    "read" BOOLEAN NOT NULL DEFAULT false,
    "link" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_key" ON "invitations"("token");

-- CreateIndex
CREATE INDEX "invitations_tenant_id_idx" ON "invitations"("tenant_id");

-- CreateIndex
CREATE INDEX "invitations_token_idx" ON "invitations"("token");

-- CreateIndex
CREATE INDEX "invitations_email_idx" ON "invitations"("email");

-- CreateIndex
CREATE INDEX "bank_transactions_bank_account_id_idx" ON "bank_transactions"("bank_account_id");

-- CreateIndex
CREATE INDEX "bank_transactions_status_idx" ON "bank_transactions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_invoice_number_key" ON "invoices"("invoice_number");

-- CreateIndex
CREATE INDEX "invoices_customer_id_idx" ON "invoices"("customer_id");

-- CreateIndex
CREATE INDEX "invoices_status_idx" ON "invoices"("status");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_bills_bill_number_key" ON "vendor_bills"("bill_number");

-- CreateIndex
CREATE INDEX "vendor_bills_vendor_id_idx" ON "vendor_bills"("vendor_id");

-- CreateIndex
CREATE INDEX "vendor_bills_status_idx" ON "vendor_bills"("status");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_code_key" ON "warehouses"("code");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_items_sku_key" ON "inventory_items"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "warehouse_stocks_warehouse_id_item_id_key" ON "warehouse_stocks"("warehouse_id", "item_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_transfers_transfer_number_key" ON "stock_transfers"("transfer_number");

-- CreateIndex
CREATE UNIQUE INDEX "cash_sales_receipt_no_key" ON "cash_sales"("receipt_no");

-- CreateIndex
CREATE UNIQUE INDEX "daily_closeout_reports_till_id_key" ON "daily_closeout_reports"("till_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_idx" ON "notifications"("user_id");

-- CreateIndex
CREATE INDEX "notifications_read_idx" ON "notifications"("read");

-- CreateIndex
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs"("entity");

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_bills" ADD CONSTRAINT "vendor_bills_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_stocks" ADD CONSTRAINT "warehouse_stocks_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_stocks" ADD CONSTRAINT "warehouse_stocks_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_from_warehouse_id_fkey" FOREIGN KEY ("from_warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_to_warehouse_id_fkey" FOREIGN KEY ("to_warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_items" ADD CONSTRAINT "stock_transfer_items_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "stock_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_tills" ADD CONSTRAINT "cash_tills_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_sales" ADD CONSTRAINT "cash_sales_till_id_fkey" FOREIGN KEY ("till_id") REFERENCES "cash_tills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_closeout_reports" ADD CONSTRAINT "daily_closeout_reports_till_id_fkey" FOREIGN KEY ("till_id") REFERENCES "cash_tills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_closeout_reports" ADD CONSTRAINT "daily_closeout_reports_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
