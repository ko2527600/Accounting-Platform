-- Enforce append-only audit_logs at the database level. Immutability of the
-- audit trail must not depend on every code path remembering never to call
-- .update()/.delete() on this table - a bug, a future contributor, or a
-- compromised app process could otherwise silently rewrite history. A
-- BEFORE UPDATE/DELETE trigger blocks the operation unconditionally,
-- regardless of which DB role issues it (including the table owner, which
-- plain REVOKE cannot stop since owners bypass GRANT/REVOKE checks).
CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only: % is not permitted on this table (row id: %)',
    TG_OP,
    COALESCE(OLD.id, 'unknown');
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_prevent_update
  BEFORE UPDATE ON "audit_logs"
  FOR EACH ROW
  EXECUTE FUNCTION prevent_audit_log_mutation();

CREATE TRIGGER audit_logs_prevent_delete
  BEFORE DELETE ON "audit_logs"
  FOR EACH ROW
  EXECUTE FUNCTION prevent_audit_log_mutation();
