import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

/**
 * The three subscription plans a tenant can be on (Tenant.tier: 1/2/3).
 * One number drives both feature access (requireTier() below) and team
 * seat limits (tenants.ts's POST /invite) rather than treating "how much
 * can this business do" and "how many people can it add" as separate
 * concepts - every real SaaS plan bundles both together anyway.
 *
 * Every tenant that already existed before self-serve plans shipped was
 * grandfathered to Enterprise (migration 20260815020000) - only tenants
 * onboarding from this point forward start on Shop and can actually hit
 * one of these gates. There is no self-serve billing yet: a tenant's tier
 * is set by a platform admin (Admin Core Engine console) until a payment
 * processor is wired up.
 */
export const TENANT_PLANS: Record<number, { name: string; seatLimit: number }> = {
  1: { name: 'Shop', seatLimit: 3 },
  2: { name: 'Business', seatLimit: 10 },
  3: { name: 'Enterprise', seatLimit: Infinity },
};

export function planName(tier: number): string {
  return TENANT_PLANS[tier]?.name || `Tier ${tier}`;
}

export function seatLimitForTier(tier: number): number {
  return TENANT_PLANS[tier]?.seatLimit ?? TENANT_PLANS[1].seatLimit;
}

/**
 * Express middleware factory gating a route (or, via router.use, a whole
 * route file) behind a minimum plan tier. `featureLabel` is a human name
 * (e.g. "Bank Reconciliation") surfaced in the error so the frontend can
 * render a real "Upgrade to Business to unlock X" message instead of a
 * generic 403.
 */
export function requireTier(requiredTier: number, featureLabel: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const context = req.tenantContext;
    if (!context) {
      res.status(400).json({
        success: false,
        error: 'This endpoint requires an active tenant context to enforce plan restrictions.',
      });
      return;
    }

    const currentTier = context.tenantTier !== undefined ? context.tenantTier : 1;

    if (currentTier < requiredTier) {
      logger.warn('Plan tier block', {
        requestId: req.headers['x-request-id'] as string,
        tenantSlug: context.tenantSlug,
        currentTier,
        requiredTier,
        featureLabel,
        path: req.originalUrl,
      });

      res.status(403).json({
        success: false,
        error: `${featureLabel} requires the ${planName(requiredTier)} plan or higher. Your business is currently on the ${planName(currentTier)} plan.`,
        upgradeRequired: true,
        currentTier,
        requiredTier,
        currentPlanName: planName(currentTier),
        requiredPlanName: planName(requiredTier),
        featureLabel,
      });
      return;
    }

    next();
  };
}
