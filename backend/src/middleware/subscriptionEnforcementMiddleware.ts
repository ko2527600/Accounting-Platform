import { Request, Response, NextFunction } from 'express';

export type SubscriptionState = 'ACTIVE' | 'TRIAL' | 'GRACE' | 'EXPIRED';

const GRACE_PERIOD_DAYS = 7;

export function computeSubscriptionState(
  subscriptionStatus: string | undefined,
  trialEndsAt: Date | null | undefined,
  subscriptionPaidUntil: Date | null | undefined,
): SubscriptionState {
  const now = Date.now();

  // Paid subscription still within its billing period.
  if (subscriptionStatus === 'ACTIVE' && subscriptionPaidUntil && subscriptionPaidUntil.getTime() > now) {
    return 'ACTIVE';
  }

  // Paid subscription just lapsed — apply the same 7-day grace window.
  if (subscriptionStatus === 'ACTIVE' && subscriptionPaidUntil) {
    const daysSinceLapse = (now - subscriptionPaidUntil.getTime()) / 86_400_000;
    if (daysSinceLapse <= GRACE_PERIOD_DAYS) return 'GRACE';
    return 'EXPIRED';
  }

  // No trial end date set — tenant created before trial tracking; allow through.
  if (subscriptionStatus === 'TRIAL' && !trialEndsAt) {
    return 'TRIAL';
  }

  // Trial still running.
  if (trialEndsAt && trialEndsAt.getTime() > now) {
    return 'TRIAL';
  }

  // Trial just ended but within the 7-day grace window.
  if (trialEndsAt) {
    const daysSinceTrialEnd = (now - trialEndsAt.getTime()) / 86_400_000;
    if (daysSinceTrialEnd <= GRACE_PERIOD_DAYS) {
      return 'GRACE';
    }
  }

  // No valid trial or payment.
  return 'EXPIRED';
}

/**
 * Middleware that enforces subscription state on every tenant-scoped request.
 *
 * - TRIAL / ACTIVE  → pass through
 * - GRACE           → allow GET requests; block writes with 402
 * - EXPIRED         → block all requests with 402
 *
 * Must be mounted AFTER tenantContextMiddleware. Routes under
 * /api/v1/subscription are excluded so expired tenants can still pay.
 */
export function subscriptionEnforcementMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Skip enforcement for subscription payment routes so expired tenants can pay.
  if (req.path.startsWith('/api/v1/subscription') || req.originalUrl.includes('/subscription')) {
    return next();
  }

  const context = req.tenantContext;
  if (!context) {
    return next();
  }

  const state = computeSubscriptionState(
    context.tenantSubscriptionStatus,
    context.tenantTrialEndsAt,
    context.tenantSubscriptionPaidUntil,
  );

  if (state === 'ACTIVE' || state === 'TRIAL') {
    return next();
  }

  const trialEndsAt = context.tenantTrialEndsAt;
  const graceEndsAt = trialEndsAt
    ? new Date(trialEndsAt.getTime() + GRACE_PERIOD_DAYS * 86_400_000)
    : null;

  if (state === 'GRACE') {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      return next();
    }
    res.status(402).json({
      success: false,
      error: 'Your free trial has ended. Your account is in read-only mode until you subscribe.',
      subscriptionRequired: true,
      state: 'GRACE',
      graceEndsAt: graceEndsAt?.toISOString() ?? null,
    });
    return;
  }

  // EXPIRED
  res.status(402).json({
    success: false,
    error: 'Your account is locked. Please subscribe to continue using Ledgio.',
    subscriptionRequired: true,
    state: 'EXPIRED',
  });
}
