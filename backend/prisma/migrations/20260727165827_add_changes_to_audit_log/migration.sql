-- Structured before/after diff for update-style audit events (e.g. journal
-- entry status DRAFT -> POSTED, account.isActive true -> false). Kept
-- alongside the existing free-text `details` column rather than replacing
-- it - `details` stays the human-readable one-liner, `changes` is the
-- machine-queryable structured version for entries that have one.
ALTER TABLE "audit_logs" ADD COLUMN "changes" JSONB;
