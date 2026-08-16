import { Router, Request, Response } from 'express';
import { authenticateJwt } from '../middleware/authMiddleware';
import { tenantContextMiddleware } from '../middleware/tenantContextMiddleware';
import { requireRole } from '../middleware/rbacMiddleware';
import { requireTenantContext } from '../context/tenantContext';
import * as purchaseOrderService from '../services/purchaseOrderService';
import { PurchaseOrderServiceError } from '../services/purchaseOrderService';

const router = Router();

router.use(authenticateJwt);
router.use(tenantContextMiddleware);

router.get('/', requireRole('Viewer'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const purchaseOrders = await purchaseOrderService.listPurchaseOrders(tenantId);
    res.status(200).json({ success: true, data: { purchaseOrders } });
  } catch (error: any) {
    console.error('[PurchaseOrders] Error listing:', error);
    res.status(500).json({ success: false, error: 'Failed to retrieve purchase orders.' });
  }
});

router.get('/:id', requireRole('Viewer'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const purchaseOrder = await purchaseOrderService.getPurchaseOrderById(tenantId, req.params.id);
    if (!purchaseOrder) {
      res.status(404).json({ success: false, error: 'Purchase Order not found.' });
      return;
    }
    res.status(200).json({ success: true, data: { purchaseOrder } });
  } catch (error: any) {
    console.error('[PurchaseOrders] Error fetching:', error);
    res.status(500).json({ success: false, error: 'Failed to retrieve purchase order.' });
  }
});

router.post('/', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const { vendorId, expectedDate, currency, warehouseId, notes, lines } = req.body;
    const purchaseOrder = await purchaseOrderService.createPurchaseOrder({
      tenantId,
      vendorId,
      expectedDate,
      currency,
      warehouseId,
      notes,
      lines,
    });
    res.status(201).json({ success: true, message: 'Purchase Order created.', data: { purchaseOrder } });
  } catch (error: any) {
    if (error instanceof PurchaseOrderServiceError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
      return;
    }
    console.error('[PurchaseOrders] Error creating:', error);
    res.status(500).json({ success: false, error: 'Failed to create purchase order.' });
  }
});

/**
 * PUT /api/v1/purchase-orders/:id/status
 * Manual status transitions (DRAFT -> SENT, or -> CANCELLED). "BILLED" is
 * set automatically by POST /bills when a bill is created against this PO
 * (see purchaseOrderId handling in routes/bills.ts), not settable here.
 */
router.put('/:id/status', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const { status } = req.body;
    if (status === 'BILLED') {
      res.status(400).json({ success: false, error: 'BILLED is set automatically when a bill is created from this PO, not manually.' });
      return;
    }
    const purchaseOrder = await purchaseOrderService.updatePurchaseOrderStatus(tenantId, req.params.id, status);
    res.status(200).json({ success: true, data: { purchaseOrder } });
  } catch (error: any) {
    if (error instanceof PurchaseOrderServiceError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
      return;
    }
    console.error('[PurchaseOrders] Error updating status:', error);
    res.status(500).json({ success: false, error: 'Failed to update purchase order status.' });
  }
});

/**
 * POST /api/v1/purchase-orders/generate-for-reorder
 * Body: { warehouseId }. Drafts one PO per vendor covering every item in
 * that warehouse at or below its reorder threshold - see
 * purchaseOrderService.generateReorderPurchaseOrders for the exact rule.
 * On-demand only, not a background job - the frontend has a button for it.
 */
router.post('/generate-for-reorder', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const { warehouseId } = req.body;
    if (!warehouseId) {
      res.status(400).json({ success: false, error: 'warehouseId is required.' });
      return;
    }
    const result = await purchaseOrderService.generateReorderPurchaseOrders(tenantId, warehouseId);
    res.status(201).json({
      success: true,
      message: result.created.length > 0
        ? `${result.created.length} Purchase Order(s) drafted.`
        : 'No low-stock items with a preferred vendor found.',
      data: result,
    });
  } catch (error: any) {
    if (error instanceof PurchaseOrderServiceError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
      return;
    }
    console.error('[PurchaseOrders] Error generating reorder POs:', error);
    res.status(500).json({ success: false, error: 'Failed to generate reorder purchase orders.' });
  }
});

export default router;
