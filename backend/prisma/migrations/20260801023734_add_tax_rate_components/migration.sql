-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "tax_breakdown" JSONB;

-- AlterTable
ALTER TABLE "tax_rates" ADD COLUMN     "components" JSONB;
