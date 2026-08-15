import { Router, Request, Response } from 'express';
import { prisma } from '../config/db';
import { withCurrentTenantDb } from '../database/tenantClient';
import { authenticateJwt } from '../middleware/authMiddleware';
import { tenantContextMiddleware } from '../middleware/tenantContextMiddleware';
import { requireRole } from '../middleware/rbacMiddleware';
import { requireTenantContext } from '../context/tenantContext';
import * as taxRateService from '../services/taxRateService';
import { TaxRateServiceError } from '../services/taxRateService';
import * as fundService from '../services/fundService';
import { FundServiceError } from '../services/fundService';
import * as approvalWorkflowService from '../services/approvalWorkflowService';
import { ApprovalWorkflowServiceError } from '../services/approvalWorkflowService';
import * as fxRateService from '../services/fxRateService';
import { FxRateServiceError } from '../services/fxRateService';
import { actorFromRequest } from '../services/auditLogService';
import * as creditDebitNoteService from '../services/creditDebitNoteService';
import { CreditDebitNoteServiceError } from '../services/creditDebitNoteService';
import { JournalEntryServiceError } from '../services/journalEntryService';
import * as invoicePaymentService from '../services/invoicePaymentService';
import { InvoicePaymentServiceError } from '../services/invoicePaymentService';
import * as invoiceEmailService from '../services/invoiceEmailService';
import { InvoiceEmailServiceError } from '../services/invoiceEmailService';
import { recordChange, notifyChange, invoiceToSyncPayload } from '../services/syncChangeLogService';

// Sentinel used to unwind a poisoned transaction cleanly on a clientTxnId
// race (see the POST / handler) - never surfaced to a caller directly.
class DuplicateInvoiceReplayError extends Error {}

// Thrown when an itemized invoice can't deduct the stock it requires
// (missing warehouse/item, insufficient quantity, or a genuine concurrent
// race losing the atomic guarded decrement) - caught in the POST / handler
// to surface the right status code instead of a generic 500.
class InvoiceStockError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'InvoiceStockError';
    this.statusCode = statusCode;
  }
}

const router = Router();

router.use(authenticateJwt);
router.use(tenantContextMiddleware);

/**
 * GET /api/v1/customers
 * Retrieves all customers.
 */
router.get('/customers', async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const customers = await withCurrentTenantDb(prisma, async (client) => {
      return (client as any).customer.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
      });
    });

    res.status(200).json({
      success: true,
      data: { customers },
    });
  } catch (error: any) {
    console.error('[Invoices] Error fetching customers:', error);
    res.status(500).json({ success: false, error: 'Failed to retrieve customers.' });
  }
});

/**
 * POST /api/v1/customers
 * Adds a new customer.
 */
router.post('/customers', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const { name, email, phone, address, creditLimit } = req.body;
    if (!name || !email) {
      res.status(400).json({ success: false, error: 'Customer name and email are required.' });
      return;
    }
    if (creditLimit !== undefined && creditLimit !== null && (typeof creditLimit !== 'number' || creditLimit < 0)) {
      res.status(400).json({ success: false, error: 'creditLimit must be a non-negative number, or null for no limit.' });
      return;
    }

    const created = await withCurrentTenantDb(prisma, async (client) => {
      return (client as any).customer.create({
        data: { tenantId, name: name.trim(), email: email.trim().toLowerCase(), phone, address, creditLimit: creditLimit ?? null },
      });
    });

    res.status(201).json({ success: true, data: { customer: created } });
  } catch (error: any) {
    console.error('[Invoices] Error creating customer:', error);
    res.status(500).json({ success: false, error: 'Failed to create customer.' });
  }
});

/**
 * PUT /api/v1/customers/:id
 * Updates a customer's contact details and/or credit limit.
 */
router.put('/customers/:id', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const { id } = req.params;
    const { name, email, phone, address, creditLimit } = req.body;

    if (creditLimit !== undefined && creditLimit !== null && (typeof creditLimit !== 'number' || creditLimit < 0)) {
      res.status(400).json({ success: false, error: 'creditLimit must be a non-negative number, or null for no limit.' });
      return;
    }

    const updated = await withCurrentTenantDb(prisma, async (client) => {
      const existing = await (client as any).customer.findFirst({ where: { id, tenantId } });
      if (!existing) return null;
      return (client as any).customer.update({
        where: { id },
        data: {
          ...(name !== undefined && { name: String(name).trim() }),
          ...(email !== undefined && { email: String(email).trim().toLowerCase() }),
          ...(phone !== undefined && { phone }),
          ...(address !== undefined && { address }),
          ...(creditLimit !== undefined && { creditLimit }),
        },
      });
    });

    if (!updated) {
      res.status(404).json({ success: false, error: 'Customer not found.' });
      return;
    }

    res.status(200).json({ success: true, data: { customer: updated } });
  } catch (error: any) {
    console.error('[Invoices] Error updating customer:', error);
    res.status(500).json({ success: false, error: 'Failed to update customer.' });
  }
});

/**
 * GET /api/v1/invoices
 * Lists all invoices.
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const invoices = await withCurrentTenantDb(prisma, async (client) => {
      return (client as any).invoice.findMany({
        where: { tenantId },
        include: { customer: true, items: true },
        orderBy: { createdAt: 'desc' },
      });
    });

    res.status(200).json({ success: true, data: { invoices } });
  } catch (error: any) {
    console.error('[Invoices] Error fetching invoices:', error);
    res.status(500).json({ success: false, error: 'Failed to retrieve invoices.' });
  }
});

/**
 * POST /api/v1/invoices
 * Creates a new invoice.
 */
router.post('/', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const { customerId, dueDate, currency = 'USD', exchangeRate = 1.0, items, taxRateId, fundId, warehouseId, clientTxnId } = req.body;

    if (!customerId || !items || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ success: false, error: 'Customer and at least one item are required.' });
      return;
    }
    // Itemized invoice (deducts real stock at issue time) vs. a plain
    // "Simple Invoice" line-item-only-in-name record: mirrors
    // VendorBill's Simple/Itemized toggle on the purchase side.
    // warehouseId is what makes this itemized - a line without a matching
    // inventoryItemId still posts fine (e.g. a service line on an otherwise
    // itemized invoice), it just has nothing to deduct.
    const isItemized = Boolean(warehouseId);
    if (clientTxnId !== undefined && (typeof clientTxnId !== 'string' || !clientTxnId)) {
      res.status(400).json({ success: false, error: 'clientTxnId, if provided, must be a non-empty string.' });
      return;
    }

    // Optional restricted/unrestricted fund this invoice's revenue belongs
    // to (fund accounting for nonprofit tenants) - same inline
    // validate-or-400 shape as taxRateId below.
    if (fundId) {
      const fund = await fundService.getFundById(tenantId, fundId);
      if (!fund) {
        res.status(400).json({ success: false, error: `Fund with ID "${fundId}" not found.` });
        return;
      }
    }

    let subtotal = 0;
    const itemData = items.map((it: any) => {
      const qty = Number(it.quantity) || 1;
      const price = Number(it.unitPrice) || 0;
      const amt = qty * price;
      subtotal += amt;
      return {
        tenantId,
        description: it.description || 'Service/Product',
        quantity: qty,
        unitPrice: price,
        amount: amt,
        ...(isItemized && it.inventoryItemId ? { inventoryItemId: it.inventoryItemId } : {}),
      };
    });

    const issueDate = new Date();

    // Resolve the real tax rate to apply - either the one explicitly requested,
    // or the tenant's single active default for this date. No hardcoded percentage.
    let resolvedTaxRateId: string | null = null;
    let tax = 0;
    // Snapshot of each named levy's own amount (and destination GL account,
    // if the tax rate has one configured) at issue time (e.g. Ghana's
    // VAT/NHIL/GETFund) - null when the rate has no layered breakdown, so
    // existing simple tax rates are entirely unaffected. Snapshotting
    // accountId here (not just re-reading it off the TaxRate at payment
    // time) means a later edit to which account a levy posts to never
    // rewrites the accounting history of what was actually charged/posted
    // on this invoice - same reasoning as the amount itself being snapshotted.
    let taxBreakdown: { name: string; rate: number; amount: number; accountId?: string }[] | null = null;

    function buildBreakdown(rateRecord: { components: any }, base: number) {
      if (!rateRecord.components || !Array.isArray(rateRecord.components)) return null;
      return rateRecord.components.map((c: { name: string; rate: number; accountId?: string }) => ({
        name: c.name,
        rate: c.rate,
        amount: Math.round(base * c.rate * 100) / 100,
        ...(c.accountId ? { accountId: c.accountId } : {}),
      }));
    }

    if (taxRateId) {
      const explicitRate = await taxRateService.getTaxRateById(tenantId, taxRateId);
      if (!explicitRate) {
        res.status(400).json({ success: false, error: `Tax rate with ID "${taxRateId}" not found.` });
        return;
      }
      resolvedTaxRateId = explicitRate.id;
      tax = subtotal * Number(explicitRate.rate);
      taxBreakdown = buildBreakdown(explicitRate, subtotal);
    } else {
      const defaultRate = await taxRateService.resolveDefaultTaxRate(tenantId, issueDate);
      if (defaultRate) {
        resolvedTaxRateId = defaultRate.id;
        tax = subtotal * Number(defaultRate.rate);
        taxBreakdown = buildBreakdown(defaultRate, subtotal);
      }
      // No active tax rate configured for this tenant/date: tax stays 0
      // rather than silently guessing a percentage.
    }
    const total = subtotal + tax;

    // Customer credit limit (optional, null means no limit) - blocks outright
    // rather than just warning, matching this app's existing pattern of
    // hard-gating real business rules in code (insufficient stock, the
    // trial-balance onboarding gate). Checked against every other
    // outstanding invoice's balance due (total - amountPaid), not the raw
    // total, so a customer paying down old invoices genuinely frees up
    // headroom rather than being permanently blocked by history.
    const customerForLimit: any = await withCurrentTenantDb(prisma, async (client) => {
      return (client as any).customer.findFirst({ where: { id: customerId, tenantId } });
    });
    if (!customerForLimit) {
      res.status(404).json({ success: false, error: 'Customer not found.' });
      return;
    }
    // Skip the check entirely for an idempotent retry (same clientTxnId
    // already created an invoice) - the request below will just return that
    // existing invoice, not create a new charge, so there's nothing new to
    // check against the limit, and re-checking here would double-count that
    // invoice's own total against itself.
    const isReplay = clientTxnId
      ? Boolean(
          await withCurrentTenantDb(prisma, (client) =>
            (client as any).invoice.findFirst({ where: { tenantId, clientTxnId }, select: { id: true } })
          )
        )
      : false;

    if (!isReplay && customerForLimit.creditLimit !== null && customerForLimit.creditLimit !== undefined) {
      const outstandingInvoices: any[] = await withCurrentTenantDb(prisma, async (client) => {
        return (client as any).invoice.findMany({
          where: { tenantId, customerId, status: { in: ['SENT', 'PARTIALLY_PAID'] } },
          select: { total: true, amountPaid: true },
        });
      });
      const currentOutstanding = outstandingInvoices.reduce(
        (sum: number, inv: any) => sum + (Number(inv.total) - Number(inv.amountPaid)),
        0
      );
      const limit = Number(customerForLimit.creditLimit);
      if (currentOutstanding + total > limit) {
        res.status(400).json({
          success: false,
          error: `This invoice would push ${customerForLimit.name}'s outstanding balance to ${(currentOutstanding + total).toFixed(2)}, over their credit limit of ${limit.toFixed(2)} (currently owes ${currentOutstanding.toFixed(2)}).`,
        });
        return;
      }
    }

    // Convert to the tenant's base currency at creation time so the ledger
    // (implicitly single-currency) can post the right figure on payment,
    // rather than the raw amount in whatever currency the invoice was billed in.
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    const baseCurrencyAmount = await fxRateService.convertAmount(total, currency, tenant?.baseCurrency || 'USD');

    const invoiceNumber = `INV-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

    let replayed = false;
    let syncSeq: bigint | null = null;
    let created: any;
    try {
      created = await withCurrentTenantDb(prisma, async (client) => {
        // Idempotency fast path - a retried offline-queued create (same
        // clientTxnId) returns the invoice an earlier attempt already made,
        // instead of creating a second one. Mirrors CashSale's clientTxnId
        // pattern, generalized here (see STATUS.md, local-first sync pilot).
        if (clientTxnId) {
          const existing = await (client as any).invoice.findFirst({
            where: { tenantId, clientTxnId },
            include: { customer: true, items: true, taxRate: true },
          });
          if (existing) {
            replayed = true;
            return existing;
          }
        }

        // Verify the customer actually belongs to this tenant before linking it,
        // so a caller can't attach an invoice to another tenant's customer record.
        const customer = await (client as any).customer.findFirst({ where: { id: customerId, tenantId } });
        if (!customer) {
          throw new Error('Customer not found.');
        }

        let stockDeducted = false;
        if (isItemized) {
          const warehouse = await (client as any).warehouse.findFirst({ where: { id: warehouseId, tenantId } });
          if (!warehouse) {
            throw new InvoiceStockError('Warehouse not found.', 404);
          }

          const stockLines = itemData
            .map((it: any, i: number) => ({ inventoryItemId: it.inventoryItemId as string | undefined, quantity: Number(items[i].quantity) || 1, description: it.description }))
            .filter((l: any) => l.inventoryItemId);

          if (stockLines.length > 0) {
            const itemIds = [...new Set(stockLines.map((l: any) => l.inventoryItemId))];
            const invItems = await (client as any).inventoryItem.findMany({ where: { id: { in: itemIds }, tenantId } });
            const itemsById = new Map(invItems.map((it: any) => [it.id, it]));
            const missingId = itemIds.find((id) => !itemsById.has(id));
            if (missingId) {
              throw new InvoiceStockError('Inventory item not found.', 404);
            }

            const stocks = await (client as any).warehouseStock.findMany({
              where: { warehouseId, itemId: { in: itemIds } },
            });
            const stockByItemId = new Map(stocks.map((s: any) => [s.itemId, s]));

            // Friendly pre-check for every line before touching anything - the
            // actual deduction below is still atomically guarded per line to
            // protect against a genuine concurrent race (mirrors
            // cashTill.ts's POST /tills/sales stock-deduction pattern).
            for (const line of stockLines) {
              const item = itemsById.get(line.inventoryItemId) as any;
              const stock = stockByItemId.get(line.inventoryItemId) as any;
              if (!stock || stock.quantityOnHand < line.quantity) {
                throw new InvoiceStockError(
                  `Insufficient stock for ${item.name} in ${warehouse.name} (Available: ${stock?.quantityOnHand || 0} ${item.unitOfMeasure}).`,
                  400
                );
              }
            }

            for (const line of stockLines) {
              const stock = stockByItemId.get(line.inventoryItemId) as any;
              const deduction = await (client as any).warehouseStock.updateMany({
                where: { id: stock.id, quantityOnHand: { gte: line.quantity } },
                data: { quantityOnHand: { decrement: line.quantity } },
              });
              if (deduction.count === 0) {
                const item = itemsById.get(line.inventoryItemId) as any;
                throw new InvoiceStockError(`Insufficient stock for ${item?.name || line.inventoryItemId} - another sale just took the remaining units.`, 409);
              }
            }
            stockDeducted = true;
          }
        }

        let invoice;
        try {
          invoice = await (client as any).invoice.create({
            data: {
              tenantId,
              invoiceNumber,
              customerId,
              issueDate,
              dueDate: dueDate ? new Date(dueDate) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
              currency,
              exchangeRate,
              subtotal,
              tax,
              taxRateId: resolvedTaxRateId,
              taxBreakdown,
              total,
              baseCurrencyAmount,
              fundId: fundId || null,
              warehouseId: isItemized ? warehouseId : null,
              stockDeducted,
              status: 'SENT',
              clientTxnId: clientTxnId || null,
              items: { create: itemData },
            },
            include: { customer: true, items: true, taxRate: true },
          });
        } catch (error: any) {
          // A concurrent retry racing on the SAME clientTxnId can lose the
          // fast-path check above (Read Committed isolation - both can start
          // before either commits). Once Postgres rejects this INSERT the
          // whole transaction is poisoned (can't run further queries in it),
          // so recovery can't happen here inline - throw a sentinel so this
          // transaction rolls back cleanly, then look the winner up in a
          // FRESH transaction below (same two-phase pattern cashTill.ts's
          // DuplicateSaleReplayError uses).
          if (error.code === 'P2002' && clientTxnId && error.meta?.target?.includes?.('client_txn_id')) {
            throw new DuplicateInvoiceReplayError();
          }
          throw error;
        }

        // The transactional outbox entry - must stay inside this same
        // transaction (see syncChangeLogService.recordChange) so a client can
        // never observe a committed invoice that never got logged.
        syncSeq = await recordChange(client, {
          tenantId,
          entityType: 'Invoice',
          entityId: invoice.id,
          operation: 'CREATE',
          payload: invoiceToSyncPayload(invoice),
        });

        return invoice;
      });
    } catch (raceError: any) {
      if (raceError instanceof DuplicateInvoiceReplayError) {
        // The winning transaction is guaranteed committed by now (Postgres
        // blocked our INSERT until it resolved) - a fresh transaction here
        // is safe and will find it.
        replayed = true;
        created = await withCurrentTenantDb(prisma, async (client) => {
          return (client as any).invoice.findFirst({
            where: { tenantId, clientTxnId },
            include: { customer: true, items: true, taxRate: true },
          });
        });
      } else {
        throw raceError;
      }
    }

    if (syncSeq !== null) {
      notifyChange({
        tenantId,
        entityType: 'Invoice',
        entityId: created.id,
        operation: 'CREATE',
        payload: invoiceToSyncPayload(created),
        sequence: syncSeq,
      });
    }

    res.status(replayed ? 200 : 201).json({ success: true, message: 'Invoice created successfully', data: { invoice: created } });
  } catch (error: any) {
    console.error('[Invoices] Error creating invoice:', error);
    if (error instanceof InvoiceStockError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
      return;
    }
    if (error.message === 'Customer not found.') {
      res.status(404).json({ success: false, error: error.message });
      return;
    }
    if (error instanceof TaxRateServiceError || error instanceof FxRateServiceError || error instanceof FundServiceError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to create invoice.' });
  }
});

/**
 * POST /api/v1/invoices/:id/pay
 * Marks invoice as PAID and triggers automatic AR Journal Entry posting.
 */
router.post('/:id/pay', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const actor = actorFromRequest(req);
    // `amount` is optional - omitted (or the existing no-body call every
    // pre-partial-payment client still makes) pays off whatever remains.
    const { amount } = req.body || {};
    const updated = await invoicePaymentService.recordInvoicePayment(req.params.id, actor, {
      amount: amount !== undefined ? Number(amount) : undefined,
    });

    res.status(200).json({
      success: true,
      message: updated.status === 'PAID' ? 'Invoice marked as PAID and Journal Entry posted.' : 'Partial payment recorded and Journal Entry posted.',
      data: { invoice: updated },
    });
  } catch (error: any) {
    if (error instanceof InvoicePaymentServiceError || error instanceof ApprovalWorkflowServiceError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
      return;
    }
    console.error('[Invoices] Error paying invoice:', error);
    res.status(500).json({ success: false, error: 'Failed to record invoice payment.' });
  }
});

/**
 * GET /api/v1/invoices/:id/payments
 * Full payment history for an invoice, newest first.
 */
router.get('/:id/payments', async (req: Request, res: Response): Promise<void> => {
  try {
    const payments = await invoicePaymentService.listPaymentsForInvoice(req.params.id);
    res.status(200).json({ success: true, data: { payments } });
  } catch (error: any) {
    console.error('[Invoices] Error listing payments:', error);
    res.status(500).json({ success: false, error: 'Failed to retrieve payment history.' });
  }
});

/**
 * POST /api/v1/invoices/:id/send
 * Emails the invoice (PDF attached) to its customer and stamps `emailedAt`.
 * Safe to call more than once - each call is a real re-send, not blocked by
 * a prior send.
 */
router.post('/:id/send', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const actor = actorFromRequest(req);
    const updated = await invoiceEmailService.sendInvoiceEmail(req.params.id, actor);
    res.status(200).json({
      success: true,
      message: `Invoice emailed to ${updated.customer.email}.`,
      data: { invoice: updated },
    });
  } catch (error: any) {
    if (error instanceof InvoiceEmailServiceError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
      return;
    }
    console.error('[Invoices] Error emailing invoice:', error);
    res.status(500).json({ success: false, error: 'Failed to email invoice.' });
  }
});

/**
 * GET /api/v1/invoices/:id/credit-notes
 * Lists all credit notes issued against an invoice.
 */
router.get('/:id/credit-notes', async (req: Request, res: Response): Promise<void> => {
  try {
    const notes = await creditDebitNoteService.listCreditNotesForInvoice(req.params.id);
    res.status(200).json({ success: true, data: { creditNotes: notes } });
  } catch (error: any) {
    console.error('[Invoices] Error listing credit notes:', error);
    res.status(500).json({ success: false, error: 'Failed to retrieve credit notes.' });
  }
});

/**
 * POST /api/v1/invoices/:id/credit-notes
 * Issues a Credit Note against an invoice (returned goods, overcharge, discount).
 * Reduces the invoice's total if unpaid; posts a reversing journal entry if already paid.
 */
router.post('/:id/credit-notes', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const actor = actorFromRequest(req);
    const note = await creditDebitNoteService.createCreditNote(req.params.id, req.body, actor);
    res.status(201).json({ success: true, message: 'Credit note issued successfully.', data: { creditNote: note } });
  } catch (error: any) {
    if (error instanceof CreditDebitNoteServiceError || error instanceof JournalEntryServiceError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
      return;
    }
    console.error('[Invoices] Error issuing credit note:', error);
    res.status(500).json({ success: false, error: 'Failed to issue credit note.' });
  }
});

export default router;
