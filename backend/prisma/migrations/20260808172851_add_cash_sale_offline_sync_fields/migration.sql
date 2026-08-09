-- AlterTable
ALTER TABLE "cash_sales" ADD COLUMN     "client_occurred_at" TIMESTAMP(3),
ADD COLUMN     "client_txn_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "cash_sales_tenant_id_client_txn_id_key" ON "cash_sales"("tenant_id", "client_txn_id");

