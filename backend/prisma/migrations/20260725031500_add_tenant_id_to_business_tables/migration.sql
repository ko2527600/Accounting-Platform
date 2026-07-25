-- DropIndex
DROP INDEX "cash_sales_receipt_no_key";

-- DropIndex
DROP INDEX "custom_fields_entity_type_field_name_key";

-- DropIndex
DROP INDEX "inventory_items_sku_key";

-- DropIndex
DROP INDEX "invoices_invoice_number_key";

-- DropIndex
DROP INDEX "stock_transfers_transfer_number_key";

-- DropIndex
DROP INDEX "vendor_bills_bill_number_key";

-- DropIndex
DROP INDEX "warehouses_code_key";

-- AlterTable
ALTER TABLE "bank_accounts" ADD COLUMN     "tenant_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "bank_transactions" ADD COLUMN     "tenant_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "cash_sales" ADD COLUMN     "tenant_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "cash_tills" ADD COLUMN     "tenant_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "custom_field_values" ADD COLUMN     "tenant_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "custom_fields" ADD COLUMN     "tenant_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "tenant_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "daily_closeout_reports" ADD COLUMN     "tenant_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "inventory_items" ADD COLUMN     "tenant_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "invoice_items" ADD COLUMN     "tenant_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "tenant_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "tenant_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "stock_transfer_items" ADD COLUMN     "tenant_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "stock_transfers" ADD COLUMN     "tenant_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "vendor_bills" ADD COLUMN     "tenant_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "vendors" ADD COLUMN     "tenant_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "warehouse_stocks" ADD COLUMN     "tenant_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "warehouses" ADD COLUMN     "tenant_id" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "bank_accounts_tenant_id_idx" ON "bank_accounts"("tenant_id");

-- CreateIndex
CREATE INDEX "bank_transactions_tenant_id_idx" ON "bank_transactions"("tenant_id");

-- CreateIndex
CREATE INDEX "cash_sales_tenant_id_idx" ON "cash_sales"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "cash_sales_tenant_id_receipt_no_key" ON "cash_sales"("tenant_id", "receipt_no");

-- CreateIndex
CREATE INDEX "cash_tills_tenant_id_idx" ON "cash_tills"("tenant_id");

-- CreateIndex
CREATE INDEX "custom_field_values_tenant_id_idx" ON "custom_field_values"("tenant_id");

-- CreateIndex
CREATE INDEX "custom_fields_tenant_id_idx" ON "custom_fields"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "custom_fields_tenant_id_entity_type_field_name_key" ON "custom_fields"("tenant_id", "entity_type", "field_name");

-- CreateIndex
CREATE INDEX "customers_tenant_id_idx" ON "customers"("tenant_id");

-- CreateIndex
CREATE INDEX "daily_closeout_reports_tenant_id_idx" ON "daily_closeout_reports"("tenant_id");

-- CreateIndex
CREATE INDEX "inventory_items_tenant_id_idx" ON "inventory_items"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_items_tenant_id_sku_key" ON "inventory_items"("tenant_id", "sku");

-- CreateIndex
CREATE INDEX "invoice_items_tenant_id_idx" ON "invoice_items"("tenant_id");

-- CreateIndex
CREATE INDEX "invoices_tenant_id_idx" ON "invoices"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_tenant_id_invoice_number_key" ON "invoices"("tenant_id", "invoice_number");

-- CreateIndex
CREATE INDEX "notifications_tenant_id_idx" ON "notifications"("tenant_id");

-- CreateIndex
CREATE INDEX "stock_transfer_items_tenant_id_idx" ON "stock_transfer_items"("tenant_id");

-- CreateIndex
CREATE INDEX "stock_transfers_tenant_id_idx" ON "stock_transfers"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_transfers_tenant_id_transfer_number_key" ON "stock_transfers"("tenant_id", "transfer_number");

-- CreateIndex
CREATE INDEX "vendor_bills_tenant_id_idx" ON "vendor_bills"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_bills_tenant_id_bill_number_key" ON "vendor_bills"("tenant_id", "bill_number");

-- CreateIndex
CREATE INDEX "vendors_tenant_id_idx" ON "vendors"("tenant_id");

-- CreateIndex
CREATE INDEX "warehouse_stocks_tenant_id_idx" ON "warehouse_stocks"("tenant_id");

-- CreateIndex
CREATE INDEX "warehouses_tenant_id_idx" ON "warehouses"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_tenant_id_code_key" ON "warehouses"("tenant_id", "code");

