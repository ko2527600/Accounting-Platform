-- Performance indexes for high-load hot paths
-- CONCURRENTLY avoids a full table lock on each large table.

CREATE INDEX CONCURRENTLY IF NOT EXISTS invoices_tenant_status_issue_date_idx
  ON invoices(tenant_id, status, issue_date);

CREATE INDEX CONCURRENTLY IF NOT EXISTS cash_sales_tenant_created_at_idx
  ON cash_sales(tenant_id, created_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS sync_change_log_tenant_occurred_at_idx
  ON sync_change_log(tenant_id, occurred_at);
