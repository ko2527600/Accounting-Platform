import { Router, Request, Response } from 'express';
import { authenticateJwt } from '../middleware/authMiddleware';
import { tenantContextMiddleware } from '../middleware/tenantContextMiddleware';
import { requireRole } from '../middleware/rbacMiddleware';
import { requireTenantContext } from '../context/tenantContext';
import * as recurringInvoiceService from '../services/recurringInvoiceService';
import { RecurringInvoiceServiceError } from '../services/recurringInvoiceService';

const router = Router();

router.use(authenticateJwt);
router.use(tenantContextMiddleware);

router.get('/', requireRole('Viewer'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const recurringInvoices = await recurringInvoiceService.listRecurringInvoices(tenantId);
    res.status(200).json({ success: true, data: { recurringInvoices } });
  } catch (error: any) {
    console.error('[RecurringInvoices] Error listing:', error);
    res.status(500).json({ success: false, error: 'Failed to retrieve recurring invoices.' });
  }
});

router.post('/', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const { customerId, name, frequency, startDate, endDate, currency, dueInDays, taxRateId, items } = req.body;
    const recurringInvoice = await recurringInvoiceService.createRecurringInvoice(tenantId, {
      customerId,
      name,
      frequency,
      startDate,
      endDate,
      currency,
      dueInDays,
      taxRateId,
      items,
    });
    res.status(201).json({ success: true, message: 'Recurring invoice created.', data: { recurringInvoice } });
  } catch (error: any) {
    if (error instanceof RecurringInvoiceServiceError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
      return;
    }
    console.error('[RecurringInvoices] Error creating:', error);
    res.status(500).json({ success: false, error: 'Failed to create recurring invoice.' });
  }
});

/**
 * PUT /api/v1/recurring-invoices/:id/active
 * Pauses/resumes generation - the frontend's toggle. Not a general editor
 * (changing the template mid-flight would be ambiguous about whether
 * already-generated invoices should retroactively change) - deleting and
 * recreating is the path for real template edits, same simplification
 * RecurringTransaction's own UI doesn't need to make since it's a smaller edit surface.
 */
router.put('/:id/active', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const { isActive } = req.body;
    const recurringInvoice = await recurringInvoiceService.setRecurringInvoiceActive(tenantId, req.params.id, Boolean(isActive));
    res.status(200).json({ success: true, data: { recurringInvoice } });
  } catch (error: any) {
    if (error instanceof RecurringInvoiceServiceError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
      return;
    }
    console.error('[RecurringInvoices] Error updating active state:', error);
    res.status(500).json({ success: false, error: 'Failed to update recurring invoice.' });
  }
});

export default router;
