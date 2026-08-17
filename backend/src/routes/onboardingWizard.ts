import { Router, Request, Response } from 'express';
import { authenticateJwt } from '../middleware/authMiddleware';
import { tenantContextMiddleware } from '../middleware/tenantContextMiddleware';
import { requireRole } from '../middleware/rbacMiddleware';
import { requireTenantContext } from '../context/tenantContext';
import { actorFromRequest } from '../services/auditLogService';
import * as onboardingWizardService from '../services/onboardingWizardService';

const router = Router();

router.use(authenticateJwt);
router.use(tenantContextMiddleware);

/**
 * GET /api/v1/onboarding/status
 * The completion checklist the wizard (and a persistent "setup" banner
 * elsewhere in the app) renders from - computed live from real tenant data,
 * never a set-once-and-forget flag.
 */
router.get('/status', async (_req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const status = await onboardingWizardService.getOnboardingStatus(tenantId);
    res.status(200).json({ success: true, data: status });
  } catch (error: any) {
    if (error instanceof onboardingWizardService.OnboardingWizardServiceError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
      return;
    }
    console.error('[OnboardingWizard] Error fetching status:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch onboarding status.' });
  }
});

/**
 * PUT /api/v1/onboarding/business-profile
 * Step 1: business type, VAT/GRA status, currency.
 */
router.put('/business-profile', requireRole('Admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    await onboardingWizardService.updateBusinessProfile(tenantId, req.body);
    const status = await onboardingWizardService.getOnboardingStatus(tenantId);
    res.status(200).json({ success: true, data: status });
  } catch (error: any) {
    if (error instanceof onboardingWizardService.OnboardingWizardServiceError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
      return;
    }
    console.error('[OnboardingWizard] Error updating business profile:', error);
    res.status(500).json({ success: false, error: 'Failed to update business profile.' });
  }
});

/**
 * GET /api/v1/onboarding/chart-of-accounts-template
 * Step 2: the Ghana SME default chart of accounts, for the client to review
 * and edit before seeding.
 */
router.get('/chart-of-accounts-template', requireRole('Admin'), async (_req: Request, res: Response): Promise<void> => {
  res.status(200).json({ success: true, data: onboardingWizardService.getChartOfAccountsTemplate() });
});

/**
 * POST /api/v1/onboarding/chart-of-accounts/seed
 * Bulk-creates the (possibly edited) chart of accounts list.
 */
router.post('/chart-of-accounts/seed', requireRole('Admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { accounts } = req.body;
    const result = await onboardingWizardService.seedChartOfAccounts(accounts, actorFromRequest(req));
    res.status(201).json({ success: true, data: result });
  } catch (error: any) {
    if (error instanceof onboardingWizardService.OnboardingWizardServiceError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
      return;
    }
    console.error('[OnboardingWizard] Error seeding chart of accounts:', error);
    res.status(500).json({ success: false, error: 'Failed to seed chart of accounts.' });
  }
});

/**
 * POST /api/v1/onboarding/opening-balances
 * Step 3, the hard trial-balance gate: rejects with the exact debit/credit
 * totals unless they match exactly - see onboardingWizardService for why
 * this is not a soft warning.
 */
router.post('/opening-balances', requireRole('Admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const result = await onboardingWizardService.postOpeningBalances(tenantId, req.body, actorFromRequest(req));
    res.status(201).json({ success: true, data: result });
  } catch (error: any) {
    if (error instanceof onboardingWizardService.OnboardingWizardServiceError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
      return;
    }
    console.error('[OnboardingWizard] Error posting opening balances:', error);
    res.status(500).json({ success: false, error: 'Failed to post opening balances.' });
  }
});

export default router;
