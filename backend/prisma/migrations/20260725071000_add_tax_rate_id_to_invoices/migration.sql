-- Invoice: link to a real TaxRate row instead of a hardcoded flat percentage
ALTER TABLE "invoices" ADD COLUMN "tax_rate_id" TEXT;
CREATE INDEX "invoices_tax_rate_id_idx" ON "invoices"("tax_rate_id");
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tax_rate_id_fkey" FOREIGN KEY ("tax_rate_id") REFERENCES "tax_rates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
