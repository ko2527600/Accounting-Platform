-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "tin" TEXT;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "gra_device_number" TEXT,
ADD COLUMN     "gra_security_key_encrypted" TEXT;
