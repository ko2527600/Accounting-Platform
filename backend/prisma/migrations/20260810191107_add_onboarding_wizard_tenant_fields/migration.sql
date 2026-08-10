-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "business_type" TEXT,
ADD COLUMN     "gra_tin" TEXT,
ADD COLUMN     "is_live" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "vat_registered" BOOLEAN NOT NULL DEFAULT false;
