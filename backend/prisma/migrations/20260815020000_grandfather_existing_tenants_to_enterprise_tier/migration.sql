-- Introducing self-serve plan tiers (Shop/Business/Enterprise, gated via
-- requireTier() in tierEnforcementMiddleware.ts) must never take a feature
-- away from a business already using the platform. Every tenant that
-- exists at the moment this migration runs is bumped to Enterprise (3) -
-- unrestricted, exactly as if tiers had never been introduced for them.
-- Only tenants onboarding AFTER this migration runs get the real Shop (1)
-- default from application code (tenantService.ts's onboardTenant).
UPDATE "tenants" SET "tier" = 3 WHERE "tier" < 3;
