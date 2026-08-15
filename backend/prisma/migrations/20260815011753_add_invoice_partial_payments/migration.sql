-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "amount_paid" DECIMAL(15,2) NOT NULL DEFAULT 0.00;

-- CreateTable
CREATE TABLE "invoice_payments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "base_currency_amount" DECIMAL(15,2) NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'MANUAL',
    "journal_id" TEXT,
    "recorded_by_user_id" TEXT,
    "recorded_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "invoice_payments_tenant_id_idx" ON "invoice_payments"("tenant_id");

-- CreateIndex
CREATE INDEX "invoice_payments_invoice_id_idx" ON "invoice_payments"("invoice_id");

-- AddForeignKey
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
