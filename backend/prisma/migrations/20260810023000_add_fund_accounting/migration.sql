-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "fund_id" TEXT;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "org_type" TEXT NOT NULL DEFAULT 'BUSINESS';

-- AlterTable
ALTER TABLE "vendor_bills" ADD COLUMN     "fund_id" TEXT;

-- CreateTable
CREATE TABLE "funds" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "is_restricted" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "funds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "funds_tenant_id_idx" ON "funds"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "funds_tenant_id_code_key" ON "funds"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "invoices_fund_id_idx" ON "invoices"("fund_id");

-- CreateIndex
CREATE INDEX "vendor_bills_fund_id_idx" ON "vendor_bills"("fund_id");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_fund_id_fkey" FOREIGN KEY ("fund_id") REFERENCES "funds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_bills" ADD CONSTRAINT "vendor_bills_fund_id_fkey" FOREIGN KEY ("fund_id") REFERENCES "funds"("id") ON DELETE SET NULL ON UPDATE CASCADE;
