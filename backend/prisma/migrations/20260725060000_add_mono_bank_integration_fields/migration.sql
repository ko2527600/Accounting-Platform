-- AlterTable
ALTER TABLE "bank_accounts" ADD COLUMN     "institution_name" TEXT,
ADD COLUMN     "last_synced_at" TIMESTAMP(3),
ADD COLUMN     "mono_account_id" TEXT;

-- AlterTable
ALTER TABLE "bank_transactions" ADD COLUMN     "mono_transaction_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "bank_accounts_mono_account_id_key" ON "bank_accounts"("mono_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_transactions_mono_transaction_id_key" ON "bank_transactions"("mono_transaction_id");
