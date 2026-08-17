-- CreateTable
CREATE TABLE "teller_payment_requests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "phone_number" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GHS',
    "transaction_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "response_code" TEXT,
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teller_payment_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "teller_payment_requests_transaction_id_key" ON "teller_payment_requests"("transaction_id");

-- CreateIndex
CREATE INDEX "teller_payment_requests_tenant_id_idx" ON "teller_payment_requests"("tenant_id");

-- CreateIndex
CREATE INDEX "teller_payment_requests_invoice_id_idx" ON "teller_payment_requests"("invoice_id");

-- CreateIndex
CREATE INDEX "teller_payment_requests_status_idx" ON "teller_payment_requests"("status");

-- AddForeignKey
ALTER TABLE "teller_payment_requests" ADD CONSTRAINT "teller_payment_requests_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
