-- Add wholesale_price to inventory_items (optional - null = no wholesale tier)
ALTER TABLE "inventory_items" ADD COLUMN IF NOT EXISTS "wholesale_price" DECIMAL(15,2);

-- Add customer_type to customers (RETAIL default, WHOLESALE for trade buyers)
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "customer_type" VARCHAR(20) NOT NULL DEFAULT 'RETAIL';

-- Add sale_type to cash_sales (RETAIL default, stamped at sale time for reporting)
ALTER TABLE "cash_sales" ADD COLUMN IF NOT EXISTS "sale_type" VARCHAR(20) NOT NULL DEFAULT 'RETAIL';
