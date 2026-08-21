-- Drop the single-column tenantId index (the composite covers its prefix)
DROP INDEX IF EXISTS "cash_tills_tenant_id_idx";

-- Create composite index for the common WHERE tenant_id = $1 AND status = 'OPEN' query
CREATE INDEX IF NOT EXISTS "cash_tills_tenant_id_status_idx" ON "cash_tills"("tenant_id", "status");
