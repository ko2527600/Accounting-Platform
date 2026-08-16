import { Router, Request, Response } from 'express';
import { prisma } from '../config/db';
import { withCurrentTenantDb } from '../database/tenantClient';
import { authenticateJwt } from '../middleware/authMiddleware';
import { tenantContextMiddleware } from '../middleware/tenantContextMiddleware';
import { requireRole } from '../middleware/rbacMiddleware';
import { requireTenantContext } from '../context/tenantContext';
import * as journalService from '../services/journalEntryService';
import * as accountRepository from '../repository/accountRepository';
import * as approvalWorkflowService from '../services/approvalWorkflowService';
import { ApprovalWorkflowServiceError } from '../services/approvalWorkflowService';
import * as fxRateService from '../services/fxRateService';
import { FxRateServiceError } from '../services/fxRateService';
import * as fundService from '../services/fundService';
import { FundServiceError } from '../services/fundService';
import { recordAuditLogTx, actorFromRequest, diffFields } from '../services/auditLogService';
import { assertWarehouseAccess, WarehouseAccessError } from '../services/warehouseAccessService';
import { receiveInventoryForBill, allocateLandedCostToBill } from '../services/vendorBillReceivingService';
import * as creditDebitNoteService from '../services/creditDebitNoteService';
import { CreditDebitNoteServiceError } from '../services/creditDebitNoteService';
import { JournalEntryServiceError } from '../services/journalEntryService';
import * as purchaseOrderService from '../services/purchaseOrderService';
import * as vendorBillPaymentService from '../services/vendorBillPaymentService';

const router = Router();

router.use(authenticateJwt);
router.use(tenantContextMiddleware);

/**
 * GET /api/v1/bills/vendors
 * Retrieves all vendors.
 */
router.get('/vendors', async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const vendors = await withCurrentTenantDb(prisma, async (client) => {
      return (client as any).vendor.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
      });
    });

    res.status(200).json({ success: true, data: { vendors } });
  } catch (error: any) {
    console.error('[Bills] Error fetching vendors:', error);
    res.status(500).json({ success: false, error: 'Failed to retrieve vendors.' });
  }
});

/**
 * POST /api/v1/bills/vendors
 * Adds a new vendor.
 */
router.post('/vendors', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const { name, email, phone, address } = req.body;
    if (!name || !email) {
      res.status(400).json({ success: false, error: 'Vendor name and email are required.' });
      return;
    }

    const created = await withCurrentTenantDb(prisma, async (client) => {
      return (client as any).vendor.create({
        data: { tenantId, name: name.trim(), email: email.trim().toLowerCase(), phone, address },
      });
    });

    res.status(201).json({ success: true, data: { vendor: created } });
  } catch (error: any) {
    console.error('[Bills] Error creating vendor:', error);
    res.status(500).json({ success: false, error: 'Failed to create vendor.' });
  }
});

/**
 * GET /api/v1/bills
 * Lists all vendor bills.
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const bills = await withCurrentTenantDb(prisma, async (client) => {
      return (client as any).vendorBill.findMany({
        where: { tenantId },
        include: { vendor: true, lines: { include: { item: true } }, warehouse: true },
        orderBy: { createdAt: 'desc' },
      });
    });

    res.status(200).json({ success: true, data: { bills } });
  } catch (error: any) {
    console.error('[Bills] Error fetching bills:', error);
    res.status(500).json({ success: false, error: 'Failed to retrieve vendor bills.' });
  }
});

/**
 * POST /api/v1/bills
 * Creates a vendor bill. Two shapes:
 *  - Simple/lump-sum bill (original behavior): { vendorId, amount, dueDate, currency }
 *  - Itemized purchase bill (new): { vendorId, items: [{itemId, quantity, unitCost}], warehouseId, dueDate, currency }
 *    - `amount` is derived from the line items (any client-sent `amount` is ignored) and
 *      the goods are received into `warehouseId` immediately - stock increments and each
 *      item's cost is recomputed as a moving average, since this represents real inventory
 *      arriving, independent of when the bill actually gets paid.
 */
router.post('/', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const { vendorId, dueDate, currency = 'USD', items, warehouseId, fundId, purchaseOrderId } = req.body;

    if (!vendorId) {
      res.status(400).json({ success: false, error: 'Vendor ID is required.' });
      return;
    }

    // Optional link to the Purchase Order this bill fulfills (see
    // purchaseOrderService.ts's computePoVsBillVariance) - validated up
    // front like fundId below, and marks the PO BILLED once the bill is
    // actually created.
    let linkedPurchaseOrder: any = null;
    if (purchaseOrderId) {
      linkedPurchaseOrder = await withCurrentTenantDb(prisma, async (client) => {
        return (client as any).purchaseOrder.findFirst({ where: { id: purchaseOrderId, tenantId }, include: { lines: true } });
      });
      if (!linkedPurchaseOrder) {
        res.status(404).json({ success: false, error: 'Purchase Order not found.' });
        return;
      }
      if (linkedPurchaseOrder.status === 'CANCELLED') {
        res.status(400).json({ success: false, error: 'This Purchase Order is cancelled and cannot be billed against.' });
        return;
      }
    }

    // Optional restricted/unrestricted fund this bill's expense belongs to
    // (fund accounting for nonprofit tenants).
    if (fundId) {
      const fund = await fundService.getFundById(tenantId, fundId);
      if (!fund) {
        res.status(400).json({ success: false, error: `Fund with ID "${fundId}" not found.` });
        return;
      }
    }

    const isItemized = Array.isArray(items) && items.length > 0;

    if (isItemized) {
      if (!warehouseId) {
        res.status(400).json({ success: false, error: 'A warehouse is required to receive an itemized purchase.' });
        return;
      }
      for (const line of items) {
        if (!line || typeof line.itemId !== 'string' || !line.itemId) {
          res.status(400).json({ success: false, error: 'Every line item must include an item ID.' });
          return;
        }
        if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
          res.status(400).json({ success: false, error: `Invalid quantity for item ${line.itemId} - must be a whole number greater than zero.` });
          return;
        }
        if (typeof line.unitCost !== 'number' || line.unitCost < 0) {
          res.status(400).json({ success: false, error: `Invalid unit cost for item ${line.itemId}.` });
          return;
        }
      }
    } else if (!req.body.amount) {
      res.status(400).json({ success: false, error: 'Vendor ID and bill amount are required.' });
      return;
    }

    const amount = isItemized
      ? items.reduce((sum: number, l: any) => sum + l.quantity * l.unitCost, 0)
      : Number(req.body.amount);

    const billNumber = `BILL-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

    // Convert to the tenant's base currency at creation time, same as invoices -
    // the ledger is implicitly single-currency, so this is what actually gets posted on payment.
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    const baseCurrencyAmount = await fxRateService.convertAmount(amount, currency, tenant?.baseCurrency || 'USD');

    const created = await withCurrentTenantDb(prisma, async (client) => {
      // Verify the vendor actually belongs to this tenant before linking it.
      const vendor = await (client as any).vendor.findFirst({ where: { id: vendorId, tenantId } });
      if (!vendor) {
        throw new Error('Vendor not found.');
      }

      if (isItemized) {
        const warehouse = await (client as any).warehouse.findFirst({ where: { id: warehouseId, tenantId } });
        if (!warehouse) {
          throw new Error('Warehouse not found.');
        }
        await assertWarehouseAccess(client, tenantId, req.user!.id, req.user!.role, warehouseId);
      }

      const bill = await (client as any).vendorBill.create({
        data: {
          tenantId,
          billNumber,
          vendorId,
          amount,
          baseCurrencyAmount,
          dueDate: dueDate ? new Date(dueDate) : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
          currency,
          status: 'UNPAID',
          warehouseId: isItemized ? warehouseId : null,
          fundId: fundId || null,
          purchaseOrderId: purchaseOrderId || null,
          ...(isItemized && {
            lines: {
              create: items.map((l: any) => ({
                tenantId,
                itemId: l.itemId,
                quantity: l.quantity,
                unitCost: l.unitCost,
                lineTotal: l.quantity * l.unitCost,
              })),
            },
          }),
        },
        include: { vendor: true, lines: true },
      });

      let receivingResult: any[] = [];
      if (isItemized) {
        receivingResult = await receiveInventoryForBill(
          client,
          tenantId,
          warehouseId,
          items.map((l: any) => ({ itemId: l.itemId, quantity: l.quantity, unitCost: l.unitCost }))
        );

        await recordAuditLogTx(client, {
          action: 'VENDOR_BILL.ITEMS_RECEIVED',
          entity: 'VendorBill',
          entityId: bill.id,
          actor: actorFromRequest(req),
          details: `Received ${items.length} line item(s) into warehouse for bill ${bill.billNumber} (${amount.toFixed(2)} ${currency}).`,
        });
      }

      if (linkedPurchaseOrder) {
        await (client as any).purchaseOrder.update({ where: { id: linkedPurchaseOrder.id }, data: { status: 'BILLED' } });
      }

      return { bill, receivingResult };
    });

    let poVariance: ReturnType<typeof purchaseOrderService.computePoVsBillVariance> | null = null;
    if (linkedPurchaseOrder && isItemized) {
      const itemNames = await withCurrentTenantDb(prisma, async (client) => {
        const itemRows = await (client as any).inventoryItem.findMany({
          where: { id: { in: linkedPurchaseOrder.lines.map((l: any) => l.itemId) } },
        });
        return Object.fromEntries(itemRows.map((r: any) => [r.id, r.name]));
      });
      poVariance = purchaseOrderService.computePoVsBillVariance(
        linkedPurchaseOrder.lines.map((l: any) => ({ itemId: l.itemId, itemName: itemNames[l.itemId] || l.itemId, quantity: l.quantity, unitCost: Number(l.unitCost) })),
        items.map((l: any) => ({ itemId: l.itemId, quantity: l.quantity, unitCost: l.unitCost }))
      );
    }

    res.status(201).json({
      success: true,
      message: isItemized ? 'Vendor bill recorded and stock received.' : 'Vendor bill recorded',
      data: { bill: created.bill, receiving: created.receivingResult, poVariance },
    });
  } catch (error: any) {
    console.error('[Bills] Error creating bill:', error);
    if (error instanceof WarehouseAccessError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
      return;
    }
    if (error.message === 'Vendor not found.' || error.message === 'Warehouse not found.') {
      res.status(404).json({ success: false, error: error.message });
      return;
    }
    if (error.message?.includes('Inventory item') && error.message?.includes('not found')) {
      res.status(404).json({ success: false, error: error.message });
      return;
    }
    if (error instanceof FxRateServiceError || error instanceof FundServiceError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to create vendor bill.' });
  }
});

/**
 * POST /api/v1/bills/:id/landed-cost
 * Records a secondary bill (freight/customs/duty) tied to a primary itemized
 * purchase bill, and spreads its amount proportionally across the primary
 * bill's line items, adjusting each item's moving-average cost.
 */
router.post('/:id/landed-cost', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const { id: primaryBillId } = req.params;
    const { vendorId, amount, dueDate, currency = 'USD', description } = req.body;

    if (!vendorId || !amount || Number(amount) <= 0) {
      res.status(400).json({ success: false, error: 'Vendor ID and a positive amount are required.' });
      return;
    }

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    const baseCurrencyAmount = await fxRateService.convertAmount(Number(amount), currency, tenant?.baseCurrency || 'USD');
    const billNumber = `BILL-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

    const result = await withCurrentTenantDb(prisma, async (client) => {
      const vendor = await (client as any).vendor.findFirst({ where: { id: vendorId, tenantId } });
      if (!vendor) {
        throw new Error('Vendor not found.');
      }

      const landedCostBill = await (client as any).vendorBill.create({
        data: {
          tenantId,
          billNumber,
          vendorId,
          amount: Number(amount),
          baseCurrencyAmount,
          dueDate: dueDate ? new Date(dueDate) : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
          currency,
          status: 'UNPAID',
          billType: 'LANDED_COST',
          landedCostForBillId: primaryBillId,
        },
        include: { vendor: true },
      });

      const allocations = await allocateLandedCostToBill(client, tenantId, primaryBillId, Number(amount));

      await recordAuditLogTx(client, {
        action: 'VENDOR_BILL.LANDED_COST_ALLOCATED',
        entity: 'VendorBill',
        entityId: primaryBillId,
        actor: actorFromRequest(req),
        details: `Landed cost ${landedCostBill.billNumber} (${Number(amount).toFixed(2)} ${currency}${description ? `, ${description}` : ''}) allocated across ${allocations.length} line item(s).`,
      });

      return { landedCostBill, allocations };
    });

    res.status(201).json({
      success: true,
      message: 'Landed cost recorded and allocated across the purchase.',
      data: { bill: result.landedCostBill, allocations: result.allocations },
    });
  } catch (error: any) {
    console.error('[Bills] Error allocating landed cost:', error);
    if (error.message === 'Vendor not found.' || error.message === 'Primary bill not found.') {
      res.status(404).json({ success: false, error: error.message });
      return;
    }
    if (error instanceof FxRateServiceError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
      return;
    }
    res.status(400).json({ success: false, error: error.message || 'Failed to allocate landed cost.' });
  }
});

/**
 * POST /api/v1/bills/:id/pay
 * Pays vendor bill and posts AP Journal Entry.
 */
router.post('/:id/pay', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const { id } = req.params;

    const updated = await vendorBillPaymentService.payVendorBill(tenantId, id, actorFromRequest(req));

    res.status(200).json({
      success: true,
      message: 'Vendor bill paid and Journal Entry posted.',
      data: { bill: updated },
    });
  } catch (error: any) {
    if (error instanceof vendorBillPaymentService.VendorBillPaymentServiceError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
      return;
    }
    console.error('[Bills] Error paying bill:', error);
    if (error instanceof ApprovalWorkflowServiceError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to record bill payment.' });
  }
});

/**
 * PUT /api/v1/bills/:id/schedule-payment
 * Sets or clears (null) the date this bill should be auto-paid on - see
 * vendorPaymentSchedulingCronService.ts's daily sweep.
 */
router.put('/:id/schedule-payment', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const { id } = req.params;
    const { scheduledPaymentDate } = req.body;

    const updated = await withCurrentTenantDb(prisma, async (client) => {
      const existing = await (client as any).vendorBill.findFirst({ where: { id, tenantId } });
      if (!existing) return null;
      if (existing.status === 'PAID') {
        throw new Error('Vendor bill is already paid.');
      }
      return (client as any).vendorBill.update({
        where: { id },
        data: { scheduledPaymentDate: scheduledPaymentDate ? new Date(scheduledPaymentDate) : null },
      });
    });

    if (!updated) {
      res.status(404).json({ success: false, error: 'Vendor bill not found.' });
      return;
    }

    res.status(200).json({ success: true, data: { bill: updated } });
  } catch (error: any) {
    if (error.message === 'Vendor bill is already paid.') {
      res.status(400).json({ success: false, error: error.message });
      return;
    }
    console.error('[Bills] Error scheduling payment:', error);
    res.status(500).json({ success: false, error: 'Failed to schedule payment.' });
  }
});

/**
 * GET /api/v1/bills/:id/debit-notes
 * Lists all debit notes issued against a vendor bill.
 */
router.get('/:id/debit-notes', async (req: Request, res: Response): Promise<void> => {
  try {
    const notes = await creditDebitNoteService.listDebitNotesForBill(req.params.id);
    res.status(200).json({ success: true, data: { debitNotes: notes } });
  } catch (error: any) {
    console.error('[Bills] Error listing debit notes:', error);
    res.status(500).json({ success: false, error: 'Failed to retrieve debit notes.' });
  }
});

/**
 * POST /api/v1/bills/:id/debit-notes
 * Issues a Debit Note against a vendor bill (returned goods, overcharge, vendor credit).
 * Reduces the bill's amount if unpaid; posts a reversing journal entry if already paid.
 */
router.post('/:id/debit-notes', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const actor = actorFromRequest(req);
    const note = await creditDebitNoteService.createDebitNote(req.params.id, req.body, actor);
    res.status(201).json({ success: true, message: 'Debit note issued successfully.', data: { debitNote: note } });
  } catch (error: any) {
    if (error instanceof CreditDebitNoteServiceError || error instanceof JournalEntryServiceError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
      return;
    }
    console.error('[Bills] Error issuing debit note:', error);
    res.status(500).json({ success: false, error: 'Failed to issue debit note.' });
  }
});

export default router;
