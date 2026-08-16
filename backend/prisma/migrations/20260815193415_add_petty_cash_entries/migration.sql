-- CreateTable
CREATE TABLE "petty_cash_entries" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "entry_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "direction" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "petty_cash_account_id" TEXT NOT NULL,
    "counter_account_id" TEXT NOT NULL,
    "journal_id" TEXT,
    "recorded_by_user_id" TEXT,
    "recorded_by_email" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "petty_cash_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "petty_cash_entries_tenant_id_entry_date_idx" ON "petty_cash_entries"("tenant_id", "entry_date");

-- CreateIndex
CREATE INDEX "petty_cash_entries_tenant_id_petty_cash_account_id_idx" ON "petty_cash_entries"("tenant_id", "petty_cash_account_id");
