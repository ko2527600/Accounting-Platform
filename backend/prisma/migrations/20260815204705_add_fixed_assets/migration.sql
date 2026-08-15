-- CreateEnum
CREATE TYPE "DepreciationMethod" AS ENUM ('STRAIGHT_LINE', 'REDUCING_BALANCE');

-- CreateEnum
CREATE TYPE "FixedAssetStatus" AS ENUM ('ACTIVE', 'FULLY_DEPRECIATED', 'DISPOSED');

-- CreateTable
CREATE TABLE "fixed_assets" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "serial_number" TEXT,
    "acquisition_date" TIMESTAMP(3) NOT NULL,
    "cost" DECIMAL(15,2) NOT NULL,
    "residual_value" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "depreciation_method" "DepreciationMethod" NOT NULL,
    "useful_life_months" INTEGER,
    "depreciation_rate_percent" DECIMAL(5,2),
    "accumulated_depreciation" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "last_depreciated_through" TIMESTAMP(3),
    "status" "FixedAssetStatus" NOT NULL DEFAULT 'ACTIVE',
    "disposal_date" TIMESTAMP(3),
    "disposal_notes" TEXT,
    "asset_account_id" TEXT NOT NULL,
    "payment_account_id" TEXT NOT NULL,
    "acquisition_journal_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fixed_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "depreciation_entries" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "fixed_asset_id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "net_book_value_after" DECIMAL(15,2) NOT NULL,
    "journal_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "depreciation_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fixed_assets_tenant_id_idx" ON "fixed_assets"("tenant_id");

-- CreateIndex
CREATE INDEX "fixed_assets_tenant_id_status_idx" ON "fixed_assets"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "depreciation_entries_tenant_id_idx" ON "depreciation_entries"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "depreciation_entries_fixed_asset_id_period_key" ON "depreciation_entries"("fixed_asset_id", "period");

-- AddForeignKey
ALTER TABLE "depreciation_entries" ADD CONSTRAINT "depreciation_entries_fixed_asset_id_fkey" FOREIGN KEY ("fixed_asset_id") REFERENCES "fixed_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
