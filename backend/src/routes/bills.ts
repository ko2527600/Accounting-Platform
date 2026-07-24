import { Router, Request, Response } from 'express';
import { prisma } from '../config/db';
import { withCurrentTenantDb } from '../database/tenantClient';
import { authenticateJwt } from '../middleware/authMiddleware';
import { tenantContextMiddleware } from '../middleware/tenantContextMiddleware';
import { requireRole } from '../middleware/rbacMiddleware';
import * as journalService from '../services/journalEntryService';

const router = Router();

router.use(authenticateJwt);
router.use(tenantContextMiddleware);

/**
 * GET /api/v1/bills/vendors
 * Retrieves all vendors.
 */
router.get('/vendors', async (req: Request, res: Response): Promise<void> => {
  try {
    const vendors = await withCurrentTenantDb(prisma, async (client) => {
      return (client as any).vendor.findMany({
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
    const { name, email, phone, address } = req.body;
    if (!name || !email) {
      res.status(400).json({ success: false, error: 'Vendor name and email are required.' });
      return;
    }

    const created = await withCurrentTenantDb(prisma, async (client) => {
      return (client as any).vendor.create({
        data: { name: name.trim(), email: email.trim().toLowerCase(), phone, address },
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
    const bills = await withCurrentTenantDb(prisma, async (client) => {
      return (client as any).vendorBill.findMany({
        include: { vendor: true },
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
 * Creates a vendor bill.
 */
router.post('/', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { vendorId, amount, dueDate, currency = 'USD' } = req.body;

    if (!vendorId || !amount) {
      res.status(400).json({ success: false, error: 'Vendor ID and bill amount are required.' });
      return;
    }

    const billCount = await withCurrentTenantDb(prisma, async (client) => (client as any).vendorBill.count());
    const billNumber = `BILL-${String(billCount + 5001).padStart(5, '0')}`;

    const created = await withCurrentTenantDb(prisma, async (client) => {
      return (client as any).vendorBill.create({
        data: {
          billNumber,
          vendorId,
          amount: Number(amount),
          dueDate: dueDate ? new Date(dueDate) : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
          currency,
          status: 'UNPAID',
        },
        include: { vendor: true },
      });
    });

    res.status(201).json({ success: true, message: 'Vendor bill recorded', data: { bill: created } });
  } catch (error: any) {
    console.error('[Bills] Error creating bill:', error);
    res.status(500).json({ success: false, error: 'Failed to create vendor bill.' });
  }
});

/**
 * POST /api/v1/bills/:id/pay
 * Pays vendor bill and posts AP Journal Entry.
 */
router.post('/:id/pay', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const bill = await withCurrentTenantDb(prisma, async (client) => {
      return (client as any).vendorBill.findUnique({
        where: { id },
        include: { vendor: true },
      });
    });

    if (!bill) {
      res.status(404).json({ success: false, error: 'Vendor bill not found.' });
      return;
    }

    if (bill.status === 'PAID') {
      res.status(400).json({ success: false, error: 'Vendor bill is already paid.' });
      return;
    }

    // Find accounts for AP Posting (5010 Expense, 1010 Cash/Bank)
    const accounts = await withCurrentTenantDb(prisma, async (client) => (client as any).account.findMany());
    const expenseAcc = accounts.find((a: any) => a.code === '5010') || accounts[accounts.length - 1] || accounts[0];
    const cashAcc = accounts.find((a: any) => a.code === '1010') || accounts[0];

    let journalId = null;
    if (expenseAcc && cashAcc) {
      const journal = await journalService.createJournalEntry({
        description: `Vendor Bill Payment for ${bill.billNumber} (${bill.vendor.name})`,
        entryDate: new Date().toISOString().split('T')[0],
        status: 'POSTED',
        lines: [
          { accountId: expenseAcc.id, debit: Number(bill.amount), credit: 0, description: `Expense - ${bill.billNumber}` },
          { accountId: cashAcc.id, debit: 0, credit: Number(bill.amount), description: `Cash Payment - ${bill.billNumber}` },
        ],
      });
      journalId = journal.id;
    }

    const updated = await withCurrentTenantDb(prisma, async (client) => {
      return (client as any).vendorBill.update({
        where: { id },
        data: { status: 'PAID', journalId },
      });
    });

    res.status(200).json({
      success: true,
      message: 'Vendor bill paid and Journal Entry posted.',
      data: { bill: updated },
    });
  } catch (error: any) {
    console.error('[Bills] Error paying bill:', error);
    res.status(500).json({ success: false, error: 'Failed to record bill payment.' });
  }
});

export default router;
