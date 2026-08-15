-- CreateTable
CREATE TABLE "paystack_payment_requests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GHS',
    "authorization_url" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "paystack_payment_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "paystack_payment_requests_reference_key" ON "paystack_payment_requests"("reference");

-- CreateIndex
CREATE INDEX "paystack_payment_requests_tenant_id_idx" ON "paystack_payment_requests"("tenant_id");

-- CreateIndex
CREATE INDEX "paystack_payment_requests_invoice_id_idx" ON "paystack_payment_requests"("invoice_id");

-- CreateIndex
CREATE INDEX "paystack_payment_requests_status_idx" ON "paystack_payment_requests"("status");

-- AddForeignKey
ALTER TABLE "paystack_payment_requests" ADD CONSTRAINT "paystack_payment_requests_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
