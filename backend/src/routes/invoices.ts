import { Router, Request, Response } from 'express';
import { prisma } from '../config/db';
import { withCurrentTenantDb } from '../database/tenantClient';
import { authenticateJwt } from '../middleware/authMiddleware';
import { tenantContextMiddleware } from '../middleware/tenantContextMiddleware';
import { requireRole } from '../middleware/rbacMiddleware';
import { requireTenantContext } from '../context/tenantContext';
import * as journalService from '../services/journalEntryService';

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
    const { customerId, dueDate, currency = 'USD', exchangeRate = 1.0, items } = req.body;

    if (!customerId || !items || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ success: false, error: 'Customer and at least one item are required.' });
      return;
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

    const tax = subtotal * 0.10; // 10% tax
    const total = subtotal + tax;

    const invoiceNumber = `INV-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

    const created = await withCurrentTenantDb(prisma, async (client) => {
      // Verify the customer actually belongs to this tenant before linking it,
      // so a caller can't attach an invoice to another tenant's customer record.
      const customer = await (client as any).customer.findFirst({ where: { id: customerId, tenantId } });
      if (!customer) {
        throw new Error('Customer not found.');
      }

      return (client as any).invoice.create({
        data: {
          tenantId,
          invoiceNumber,
          customerId,
          dueDate: dueDate ? new Date(dueDate) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          currency,
          exchangeRate,
          subtotal,
          tax,
          total,
          status: 'SENT',
          items: { create: itemData },
        },
        include: { customer: true, items: true },
      });
    });

    res.status(201).json({ success: true, message: 'Invoice created successfully', data: { invoice: created } });
  } catch (error: any) {
    console.error('[Invoices] Error creating invoice:', error);
    if (error.message === 'Customer not found.') {
      res.status(404).json({ success: false, error: error.message });
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
    const { tenantId } = requireTenantContext();
    const { id } = req.params;

    const invoice = await withCurrentTenantDb(prisma, async (client) => {
      return (client as any).invoice.findFirst({
        where: { id, tenantId },
        include: { customer: true },
      });
    });

    if (!invoice) {
      res.status(404).json({ success: false, error: 'Invoice not found.' });
      return;
    }

    if (invoice.status === 'PAID') {
      res.status(400).json({ success: false, error: 'Invoice is already paid.' });
      return;
    }

    // Find accounts for AR Posting (1010 Cash/Bank, 4010 Revenue or Accounts Receivable)
    const accounts = await withCurrentTenantDb(prisma, async (client) => (client as any).account.findMany());
    const cashAcc = accounts.find((a: any) => a.code === '1010') || accounts[0];
    const revenueAcc = accounts.find((a: any) => a.code === '4010') || accounts[1] || accounts[0];

    let journalId = null;
    if (cashAcc && revenueAcc) {
      const journal = await journalService.createJournalEntry({
        description: `Payment Received for Invoice ${invoice.invoiceNumber} (${invoice.customer.name})`,
        entryDate: new Date().toISOString().split('T')[0],
        status: 'POSTED',
        lines: [
          { accountId: cashAcc.id, debit: Number(invoice.total), credit: 0, description: `Cash Received - ${invoice.invoiceNumber}` },
          { accountId: revenueAcc.id, debit: 0, credit: Number(invoice.total), description: `Revenue - ${invoice.invoiceNumber}` },
        ],
      });
      journalId = journal.id;
    }

    const updated = await withCurrentTenantDb(prisma, async (client) => {
      return (client as any).invoice.update({
        where: { id },
        data: { status: 'PAID', journalId },
      });
    });

    res.status(200).json({
      success: true,
      message: 'Invoice marked as PAID and Journal Entry posted.',
      data: { invoice: updated },
    });
  } catch (error: any) {
    console.error('[Invoices] Error paying invoice:', error);
    res.status(500).json({ success: false, error: 'Failed to record invoice payment.' });
  }
});

export default router;
