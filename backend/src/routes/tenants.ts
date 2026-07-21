import { Router, Request, Response } from 'express';
import { prisma } from '../config/db';
import { onboardTenant, TenantOnboardingError } from '../services/tenantService';
import * as tenantRepository from '../repository/tenantRepository';

const router = Router();

/**
 * POST /api/v1/tenants/onboard
 * Registers a new tenant in public.tenants, provisions PostgreSQL schema (tenant_<slug>),
 * runs initial DDL migrations, registers tenant Admin user in public.users,
 * and returns tenant details and Admin JWT token.
 */
router.post('/onboard', async (req: Request, res: Response) => {
  try {
    const result = await onboardTenant(prisma, req.body);

    return res.status(201).json({
      success: true,
      message: 'Tenant onboarded successfully',
      data: result,
    });
  } catch (error: any) {
    if (error instanceof TenantOnboardingError) {
      return res.status(error.statusCode).json({
        success: false,
        error: error.message,
      });
    }

    console.error('[TenantOnboarding] Unexpected error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error during tenant onboarding',
    });
  }
});

/**
 * GET /api/v1/tenants
 * Lists all registered tenants.
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const tenants = await tenantRepository.listTenants(prisma);
    return res.status(200).json({
      success: true,
      data: { tenants },
    });
  } catch (error: any) {
    console.error('[TenantsList] Unexpected error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve tenants list',
    });
  }
});

export default router;
