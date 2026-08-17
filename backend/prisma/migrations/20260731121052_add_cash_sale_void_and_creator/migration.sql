-- CreateEnum
CREATE TYPE "CashSaleStatus" AS ENUM ('COMPLETED', 'VOIDED');

-- DropIndex
DROP INDEX "tax_rates_code_idx";

-- AlterTable
ALTER TABLE "cash_sales" ADD COLUMN     "created_by_name" TEXT,
ADD COLUMN     "created_by_user_id" TEXT,
ADD COLUMN     "status" "CashSaleStatus" NOT NULL DEFAULT 'COMPLETED',
ADD COLUMN     "void_reason" TEXT,
ADD COLUMN     "voided_at" TIMESTAMP(3),
ADD COLUMN     "voided_by_name" TEXT,
ADD COLUMN     "voided_by_user_id" TEXT;

-- CreateIndex
CREATE INDEX "cash_sales_tenant_id_created_by_user_id_idx" ON "cash_sales"("tenant_id", "created_by_user_id");
