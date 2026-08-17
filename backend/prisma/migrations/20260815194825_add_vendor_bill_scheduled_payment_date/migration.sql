-- AlterTable
ALTER TABLE "vendor_bills" ADD COLUMN     "scheduled_payment_date" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "vendor_bills_status_scheduled_payment_date_idx" ON "vendor_bills"("status", "scheduled_payment_date");
