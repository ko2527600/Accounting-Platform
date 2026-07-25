-- Tenant: real base/home operating currency (previously entirely absent -
-- the Settings UI's "Base Currency" save was silently dropped server-side).
ALTER TABLE "tenants" ADD COLUMN "base_currency" TEXT NOT NULL DEFAULT 'USD';

-- Invoice/VendorBill: store the converted base-currency equivalent alongside
-- the existing native-currency amount, so posting to the ledger (which is
-- implicitly single-currency) can use the converted figure instead of the
-- raw native amount.
ALTER TABLE "invoices" ADD COLUMN "base_currency_amount" DECIMAL(15,2);
ALTER TABLE "vendor_bills" ADD COLUMN "base_currency_amount" DECIMAL(15,2);
