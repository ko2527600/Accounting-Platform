import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { prisma } from '../config/db';
import { authenticateJwt } from '../middleware/authMiddleware';
import { tenantContextMiddleware } from '../middleware/tenantContextMiddleware';
import { requireRole } from '../middleware/rbacMiddleware';
import { requireTenantContext } from '../context/tenantContext';
import { computeSubscriptionState } from '../middleware/subscriptionEnforcementMiddleware';
import { invalidateTenantCacheById } from '../cache/tenantCache';
import * as paystackService from '../services/paystackService';
import { PaystackServiceError } from '../services/paystackService';

const router = Router();

export const SUBSCRIPTION_PLANS = [
  {
    tier: 1,
    name: 'Shop',
    priceGhs: 105,
    seatLimit: 3,
    features: ['Point of Sale', 'Invoices & Bills', 'Inventory', 'Expense Claims', 'Sales Reports'],
  },
  {
    tier: 2,
    name: 'Business',
    priceGhs: 305,
    seatLimit: 10,
    features: ['Everything in Shop', 'Payroll (PAYE & SSNIT)', 'Bank Reconciliation', 'Approval Workflows', 'Budgets & Analytics'],
  },
  {
    tier: 3,
    name: 'Enterprise',
    priceGhs: 510,
    seatLimit: Infinity,
    features: ['Everything in Business', 'Unlimited team members', 'Custom Fields', 'Full Audit Trail', 'Priority Support'],
  },
];

// Status + plans endpoint (no enforcement middleware applied — always accessible)
router.get('/plans', (_req: Request, res: Response): void => {
  res.json({ success: true, plans: SUBSCRIPTION_PLANS });
});

// All remaining routes require authentication and tenant context.
// Subscription enforcement is intentionally NOT applied here so expired tenants can pay.
router.use(authenticateJwt);
router.use(tenantContextMiddleware);

/**
 * GET /api/v1/subscription/status
 * Returns the tenant's current subscription state, trial days remaining, plan info.
 */
router.get('/status', async (req: Request, res: Response): Promise<void> => {
  try {
    const context = req.tenantContext!;
    const tenant = await prisma.tenant.findUnique({
      where: { id: context.tenantId },
      select: { tier: true, subscriptionStatus: true, trialEndsAt: true, subscriptionPaidUntil: true },
    });
    if (!tenant) {
      res.status(404).json({ success: false, error: 'Tenant not found.' });
      return;
    }

    const state = computeSubscriptionState(tenant.subscriptionStatus, tenant.trialEndsAt, tenant.subscriptionPaidUntil);

    const now = Date.now();
    const trialDaysRemaining = tenant.trialEndsAt
      ? Math.max(0, Math.ceil((tenant.trialEndsAt.getTime() - now) / 86_400_000))
      : null;
    const graceDaysRemaining =
      state === 'GRACE' && tenant.trialEndsAt
        ? Math.max(0, Math.ceil((tenant.trialEndsAt.getTime() + 7 * 86_400_000 - now) / 86_400_000))
        : null;

    const plan = SUBSCRIPTION_PLANS.find((p) => p.tier === tenant.tier) ?? SUBSCRIPTION_PLANS[0];

    res.json({
      success: true,
      state,
      subscriptionStatus: tenant.subscriptionStatus,
      tier: tenant.tier,
      planName: plan.name,
      priceGhs: plan.priceGhs,
      trialEndsAt: tenant.trialEndsAt?.toISOString() ?? null,
      trialDaysRemaining,
      graceDaysRemaining,
      subscriptionPaidUntil: tenant.subscriptionPaidUntil?.toISOString() ?? null,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v1/subscription/initialize
 * Initialises a Paystack checkout for a subscription payment.
 * Body: { planTier: 1 | 2 | 3 }
 */
router.post('/initialize', requireRole('Admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    if (!paystackService.isPaystackConfigured()) {
      res.status(503).json({ success: false, error: 'Payment processing is not configured for this environment.' });
      return;
    }

    const { planTier } = req.body as { planTier: number };
    const plan = SUBSCRIPTION_PLANS.find((p) => p.tier === Number(planTier));
    if (!plan) {
      res.status(400).json({ success: false, error: 'Invalid plan tier. Must be 1, 2, or 3.' });
      return;
    }

    const context = requireTenantContext();
    const tenant = await prisma.tenant.findUnique({
      where: { id: context.tenantId },
      select: { id: true },
    });
    if (!tenant) {
      res.status(404).json({ success: false, error: 'Tenant not found.' });
      return;
    }

    const user = (req as any).user;
    const reference = `sub_${context.tenantId}_${planTier}_${Date.now()}`;
    const callbackUrl = process.env.PAYSTACK_SUBSCRIPTION_CALLBACK_URL || process.env.APP_URL || '';

    const result = await paystackService.initializeTransaction({
      email: user.email,
      amount: plan.priceGhs,
      currency: 'GHS',
      reference,
      callbackUrl: callbackUrl ? `${callbackUrl}?tab=subscription&ref=${reference}` : undefined,
    });

    res.json({ success: true, authorizationUrl: result.authorizationUrl, reference: result.reference, plan });
  } catch (err: any) {
    if (err instanceof PaystackServiceError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v1/subscription/verify
 * Verifies a Paystack reference and activates the subscription.
 * Body: { reference: string, planTier: 1 | 2 | 3 }
 */
router.post('/verify', requireRole('Admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    if (!paystackService.isPaystackConfigured()) {
      res.status(503).json({ success: false, error: 'Payment processing is not configured for this environment.' });
      return;
    }

    const { reference, planTier } = req.body as { reference: string; planTier: number };
    if (!reference) {
      res.status(400).json({ success: false, error: 'Payment reference is required.' });
      return;
    }

    const plan = SUBSCRIPTION_PLANS.find((p) => p.tier === Number(planTier));
    if (!plan) {
      res.status(400).json({ success: false, error: 'Invalid plan tier.' });
      return;
    }

    const verification = await paystackService.verifyTransaction(reference);
    if (verification.status !== 'success') {
      res.status(400).json({ success: false, error: `Payment not successful. Status: ${verification.status}.` });
      return;
    }

    const context = requireTenantContext();
    const subscriptionPaidUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const tenant = await prisma.tenant.findUnique({ where: { id: context.tenantId }, select: { tier: true } });
    const newTier = plan.tier > (tenant?.tier ?? 1) ? plan.tier : (tenant?.tier ?? 1);

    await prisma.tenant.update({
      where: { id: context.tenantId },
      data: {
        subscriptionStatus: 'ACTIVE',
        subscriptionPaidUntil,
        tier: newTier,
      },
    });

    await invalidateTenantCacheById(context.tenantId);

    res.json({
      success: true,
      message: `Subscription activated. Your ${plan.name} plan is active until ${subscriptionPaidUntil.toLocaleDateString('en-GB')}.`,
      subscriptionPaidUntil: subscriptionPaidUntil.toISOString(),
      tier: newTier,
      planName: plan.name,
    });
  } catch (err: any) {
    if (err instanceof PaystackServiceError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v1/subscription/webhook
 * Paystack webhook receiver for async charge.success events.
 * Validates HMAC-SHA512 signature before acting.
 */
router.post('/webhook', async (req: Request, res: Response): Promise<void> => {
  try {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret) {
      res.status(503).json({ success: false, error: 'Not configured.' });
      return;
    }

    const signature = req.headers['x-paystack-signature'] as string;
    const rawBody = JSON.stringify(req.body);
    const expected = crypto.createHmac('sha512', secret).update(rawBody).digest('hex');

    if (!signature || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      res.status(400).json({ success: false, error: 'Invalid webhook signature.' });
      return;
    }

    const event = req.body as { event: string; data: any };
    if (event.event !== 'charge.success') {
      res.json({ success: true, ignored: true });
      return;
    }

    const metadata = event.data?.metadata as { tenantId?: string; planTier?: number } | undefined;
    if (!metadata?.tenantId || !metadata?.planTier) {
      res.json({ success: true, ignored: true });
      return;
    }

    const plan = SUBSCRIPTION_PLANS.find((p) => p.tier === Number(metadata.planTier));
    if (!plan) {
      res.json({ success: true, ignored: true });
      return;
    }

    const subscriptionPaidUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const existing = await prisma.tenant.findUnique({ where: { id: metadata.tenantId }, select: { tier: true } });
    const newTier = plan.tier > (existing?.tier ?? 1) ? plan.tier : (existing?.tier ?? 1);

    await prisma.tenant.update({
      where: { id: metadata.tenantId },
      data: {
        subscriptionStatus: 'ACTIVE',
        subscriptionPaidUntil,
        tier: newTier,
      },
    });

    await invalidateTenantCacheById(metadata.tenantId);

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
