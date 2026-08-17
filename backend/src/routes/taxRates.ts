import { Router, Request, Response } from 'express';
import { authenticateJwt } from '../middleware/authMiddleware';
import { tenantContextMiddleware } from '../middleware/tenantContextMiddleware';
import { requireRole } from '../middleware/rbacMiddleware';
import { requireTenantContext } from '../context/tenantContext';
import * as taxRateService from '../services/taxRateService';
import { TaxRateServiceError } from '../services/taxRateService';
import { actorFromRequest } from '../services/auditLogService';

const router = Router();

router.use(authenticateJwt);
router.use(tenantContextMiddleware);

function handleError(res: Response, error: any, fallbackMessage: string): void {
  if (error instanceof TaxRateServiceError) {
    res.status(error.statusCode).json({ success: false, error: error.message });
    return;
  }
  console.error('[TaxRates] Error:', error);
  res.status(500).json({ success: false, error: fallbackMessage });
}

/**
 * GET /api/v1/tax-rates
 * Lists all tax rates for the active tenant. Shop Manager needs this too -
 * the invoice-creation form they now have access to (routes/invoices.ts)
 * lets a tenant pick a specific tax rate, and defaults to the active one
 * either way, so this list has to actually load for them.
 */
router.get('/', requireRole('Viewer', 'Shop Manager'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const taxRates = await taxRateService.listTaxRates(tenantId);
    res.status(200).json({ success: true, data: { taxRates } });
  } catch (error: any) {
    handleError(res, error, 'Failed to retrieve tax rates.');
  }
});

/**
 * GET /api/v1/tax-rates/:id
 */
router.get('/:id', requireRole('Viewer'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const taxRate = await taxRateService.getTaxRateById(tenantId, req.params.id);
    if (!taxRate) {
      res.status(404).json({ success: false, error: `Tax rate with ID "${req.params.id}" not found.` });
      return;
    }
    res.status(200).json({ success: true, data: { taxRate } });
  } catch (error: any) {
    handleError(res, error, 'Failed to retrieve tax rate.');
  }
});

/**
 * POST /api/v1/tax-rates
 * Creates a new tax rate. Access: Accountant role or higher.
 */
router.post('/', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const taxRate = await taxRateService.createTaxRate(tenantId, req.body, actorFromRequest(req));
    res.status(201).json({ success: true, message: 'Tax rate created successfully', data: { taxRate } });
  } catch (error: any) {
    handleError(res, error, 'Failed to create tax rate.');
  }
});

/**
 * PUT /api/v1/tax-rates/:id
 * Access: Accountant role or higher.
 */
router.put('/:id', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const taxRate = await taxRateService.updateTaxRate(tenantId, req.params.id, req.body, actorFromRequest(req));
    res.status(200).json({ success: true, message: 'Tax rate updated successfully', data: { taxRate } });
  } catch (error: any) {
    handleError(res, error, 'Failed to update tax rate.');
  }
});

/**
 * DELETE /api/v1/tax-rates/:id
 * Access: Accountant role or higher. Blocked if any invoice references it.
 */
router.delete('/:id', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    await taxRateService.deleteTaxRate(tenantId, req.params.id, actorFromRequest(req));
    res.status(200).json({ success: true, message: 'Tax rate deleted successfully' });
  } catch (error: any) {
    handleError(res, error, 'Failed to delete tax rate.');
  }
});

export default router;
