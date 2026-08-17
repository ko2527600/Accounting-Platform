-- DropForeignKey
ALTER TABLE "momo_payment_requests" DROP CONSTRAINT "momo_payment_requests_invoice_id_fkey";

-- DropForeignKey
ALTER TABLE "teller_payment_requests" DROP CONSTRAINT "teller_payment_requests_invoice_id_fkey";

-- AlterTable
ALTER TABLE "tenants" DROP COLUMN "momo_api_key_encrypted",
DROP COLUMN "momo_api_user",
DROP COLUMN "momo_subscription_key_encrypted",
DROP COLUMN "teller_api_key_encrypted",
DROP COLUMN "teller_api_username",
DROP COLUMN "teller_merchant_id";

-- DropTable
DROP TABLE "momo_payment_requests";

-- DropTable
DROP TABLE "teller_payment_requests";

