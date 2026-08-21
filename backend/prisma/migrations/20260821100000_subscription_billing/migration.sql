-- Add subscription billing fields to the tenants table.
-- New tenants start in TRIAL; existing tenants are grandfathered to ACTIVE.

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "subscription_status" TEXT NOT NULL DEFAULT 'TRIAL',
  ADD COLUMN IF NOT EXISTS "trial_ends_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "subscription_paid_until" TIMESTAMPTZ;

-- All tenants that existed before self-serve billing was introduced are
-- founding/pilot accounts. Mark them ACTIVE with no expiry so they continue
-- working without interruption regardless of what trial_ends_at says.
UPDATE "tenants"
SET "subscription_status" = 'ACTIVE'
WHERE "subscription_status" = 'TRIAL';
