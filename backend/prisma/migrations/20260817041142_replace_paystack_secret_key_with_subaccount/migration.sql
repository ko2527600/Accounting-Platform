/*
  Warnings:

  - You are about to drop the column `paystack_secret_key_encrypted` on the `tenants` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "tenants" DROP COLUMN "paystack_secret_key_encrypted",
ADD COLUMN     "paystack_account_name" TEXT,
ADD COLUMN     "paystack_account_number" TEXT,
ADD COLUMN     "paystack_bank_code" TEXT,
ADD COLUMN     "paystack_subaccount_code" TEXT;
