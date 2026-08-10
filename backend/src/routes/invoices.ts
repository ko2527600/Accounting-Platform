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
import { recordChange, notifyChange, invoiceToSyncPayload } from '../services/syncChangeLogService';

// Sentinel used to unwind a poisoned transaction cleanly on a clientTxnId
// race (see the POST / handler) - never surfaced to a caller directly.
class DuplicateInvoiceReplayError extends Error {}

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
    const { name, email, phone, address } = req.body;
    if (!name || !email) {
      res.status(400).json({ success: false, error: 'Customer name and email are required.' });
      return;
    }

    const created = await withCurrentTenantDb(prisma, async (client) => {
      return (client as any).customer.create({
        data: { tenantId, name: name.trim(), email: email.trim().toLowerCase(), phone, address },
      });
    });

    res.status(201).json({ success: true, data: { customer: created } });
  } catch (error: any) {
    console.error('[Invoices] Error creating customer:', error);
    res.status(500).json({ success: false, error: 'Failed to create customer.' });
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
    const { customerId, dueDate, currency = 'USD', exchangeRate = 1.0, items, taxRateId, fundId, clientTxnId } = req.body;

    if (!customerId || !items || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ success: false, error: 'Customer and at least one item are required.' });
      return;
    }
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
    const updated = await invoicePaymentService.markInvoicePaid(req.params.id, actor);

    res.status(200).json({
      success: true,
      message: 'Invoice marked as PAID and Journal Entry posted.',
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
