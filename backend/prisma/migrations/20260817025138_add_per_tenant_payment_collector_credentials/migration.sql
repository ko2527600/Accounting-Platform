-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "momo_api_key_encrypted" TEXT,
ADD COLUMN     "momo_api_user" TEXT,
ADD COLUMN     "momo_subscription_key_encrypted" TEXT,
ADD COLUMN     "paystack_secret_key_encrypted" TEXT,
ADD COLUMN     "teller_api_key_encrypted" TEXT,
ADD COLUMN     "teller_api_username" TEXT,
ADD COLUMN     "teller_merchant_id" TEXT;
