-- Convert all indefinitely-grandfathered tenants (ACTIVE with no paid-until date)
-- to TRIAL with a 30-day notice window. After 30 days they enter the standard
-- 7-day grace period, then lock until they subscribe.
UPDATE tenants
SET
  subscription_status = 'TRIAL',
  trial_ends_at       = NOW() + INTERVAL '30 days'
WHERE subscription_status = 'ACTIVE'
  AND subscription_paid_until IS NULL;
