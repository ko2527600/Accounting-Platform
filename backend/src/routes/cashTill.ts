import { Router, Request, Response } from 'express';
import { prisma } from '../config/db';
import { withCurrentTenantDb } from '../database/tenantClient';
import { authenticateJwt } from '../middleware/authMiddleware';
import { tenantContextMiddleware } from '../middleware/tenantContextMiddleware';
import { requireTenantContext } from '../context/tenantContext';

const router = Router();

router.use(authenticateJwt);
router.use(tenantContextMiddleware);

/**
 * GET /api/v1/tills/current
 * Returns active open cash till for the current shop/user.
 */
router.get('/current', async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const { warehouseId } = req.query;

    const till = await withCurrentTenantDb(prisma, async (client) => {
      return (client as any).cashTill.findFirst({
        where: {
          tenantId,
          ...(warehouseId && { warehouseId: String(warehouseId) }),
          status: 'OPEN',
        },
        include: { warehouse: true, sales: true },
        orderBy: { openedAt: 'desc' },
      });
    });

    res.status(200).json({ success: true, data: { till } });
  } catch (error: any) {
    console.error('[CashTill] Error fetching current till:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch current cash till.' });
  }
});

/**
 * POST /api/v1/tills/open
 * Opens a physical cash drawer / till for a shop.
 */
router.post('/open', async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const { warehouseId, openingCash } = req.body;
    const userName = (req as any).user?.name || 'Shop Manager';

    if (!warehouseId || openingCash === undefined) {
      res.status(400).json({ success: false, error: 'Shop location and opening cash balance are required.' });
      return;
    }

    const createdTill = await withCurrentTenantDb(prisma, async (client) => {
      const warehouse = await (client as any).warehouse.findFirst({ where: { id: warehouseId, tenantId } });
      if (!warehouse) {
        throw new Error('Warehouse not found.');
      }

      // Close any previously open till for this warehouse
      await (client as any).cashTill.updateMany({
        where: { tenantId, warehouseId, status: 'OPEN' },
        data: { status: 'CLOSED', closedAt: new Date() },
      });

      return (client as any).cashTill.create({
        data: {
          tenantId,
          warehouseId,
          openedBy: userName,
          openingCash: Number(openingCash),
          status: 'OPEN',
        },
        include: { warehouse: true },
      });
    });

    res.status(201).json({ success: true, message: 'Cash till opened successfully', data: { till: createdTill } });
  } catch (error: any) {
    console.error('[CashTill] Error opening till:', error);
    if (error.message === 'Warehouse not found.') {
      res.status(404).json({ success: false, error: error.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to open cash till.' });
  }
});

/**
 * POST /api/v1/tills/sales
 * Records a physical cash sale, updates inventory stock, and posts revenue.
 */
router.post('/sales', async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const { tillId, itemId, quantity, cashGiven } = req.body;

    if (!tillId || !itemId || !quantity || !cashGiven) {
      res.status(400).json({ success: false, error: 'Till ID, item ID, quantity, and cash given are required.' });
      return;
    }

    const result = await withCurrentTenantDb(prisma, async (client) => {
      const till = await (client as any).cashTill.findFirst({
        where: { id: tillId, tenantId },
        include: { warehouse: true },
      });

      if (!till || till.status !== 'OPEN') {
        throw new Error('Cash till is not open or does not exist.');
      }

      const item = await (client as any).inventoryItem.findFirst({
        where: { id: itemId, tenantId },
      });

      if (!item) {
        throw new Error('Inventory item not found.');
      }

      // Check warehouse stock (existence / friendly error message only - the actual
      // deduction below is guarded atomically, same as inventory transfers).
      const stock = await (client as any).warehouseStock.findUnique({
        where: { warehouseId_itemId: { warehouseId: till.warehouseId, itemId } },
      });

      if (!stock || stock.quantityOnHand < quantity) {
        throw new Error(`Insufficient stock in ${till.warehouse.name} (Available: ${stock?.quantityOnHand || 0} ${item.unitOfMeasure}).`);
      }

      const totalAmount = Number(item.sellingPrice) * Number(quantity);
      const changeGiven = Number(cashGiven) - totalAmount;

      if (changeGiven < 0) {
        throw new Error(`Cash given (GH₵ ${cashGiven}) is less than total bill amount (GH₵ ${totalAmount}).`);
      }

      // 1. Deduct stock from shop warehouse - atomic guarded decrement so two
      // concurrent sales of the same item can't both read the same stale
      // quantity and both succeed (lost-update / phantom-stock bug).
      const deduction = await (client as any).warehouseStock.updateMany({
        where: { id: stock.id, quantityOnHand: { gte: Number(quantity) } },
        data: { quantityOnHand: { decrement: Number(quantity) } },
      });

      if (deduction.count === 0) {
        throw new Error(`Insufficient stock in ${till.warehouse.name} (stock changed concurrently, please retry).`);
      }

      // 2. Record cash sale
      const receiptNo = `REC-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
      const sale = await (client as any).cashSale.create({
        data: {
          tenantId,
          tillId,
          receiptNo,
          amount: totalAmount,
          cashGiven: Number(cashGiven),
          changeGiven,
        },
      });

      // 3. Increment till total cash sales atomically - avoids losing concurrent
      // sales' contributions to the running total.
      await (client as any).cashTill.update({
        where: { id: tillId },
        data: { cashSalesTotal: { increment: totalAmount } },
      });

      return { sale, item, totalAmount, changeGiven };
    });

    res.status(201).json({ success: true, message: 'Cash sale recorded successfully', data: result });
  } catch (error: any) {
    console.error('[CashTill] Error recording cash sale:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to record cash sale.' });
  }
});

/**
 * POST /api/v1/tills/close
 * Closes the daily cash till, calculates discrepancies (Over/Short), and generates DailyCloseoutReport.
 */
router.post('/close', async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const { tillId, actualEndingCash, notes } = req.body;
    const userName = (req as any).user?.name || 'Shop Manager';

    if (!tillId || actualEndingCash === undefined) {
      res.status(400).json({ success: false, error: 'Till ID and actual physical cash counted are required.' });
      return;
    }

    const report = await withCurrentTenantDb(prisma, async (client) => {
      const till = await (client as any).cashTill.findFirst({
        where: { id: tillId, tenantId },
        include: { sales: true, warehouse: true },
      });

      if (!till) throw new Error('Cash till not found.');

      const opening = Number(till.openingCash);
      const sales = Number(till.cashSalesTotal);
      const expected = opening + sales;
      const actual = Number(actualEndingCash);
      const discrepancy = actual - expected; // positive = Over, negative = Short

      // Mark till closed
      await (client as any).cashTill.update({
        where: { id: tillId },
        data: {
          status: 'CLOSED',
          actualEndingCash: actual,
          closedAt: new Date(),
        },
      });

      // Create Daily Closeout Report
      const report = await (client as any).dailyCloseoutReport.create({
        data: {
          tenantId,
          tillId,
          warehouseId: till.warehouseId,
          closedBy: userName,
          openingCash: opening,
          cashSales: sales,
          expectedCash: expected,
          actualCash: actual,
          discrepancy,
          itemsSold: till.sales?.length || 0,
          notes,
        },
        include: { warehouse: true },
      });

      // Automated Notification for Business Owner & Accountant
      const discText = discrepancy === 0 ? 'BALANCED' : discrepancy > 0 ? `OVER (+GH₵ ${discrepancy})` : `SHORT (-GH₵ ${Math.abs(discrepancy)})`;
      await (client as any).notification.create({
        data: {
          tenantId,
          title: `Till Closed: ${till.warehouse?.name}`,
          message: `${userName} closed daily cash drawer. Cash Sales: GH₵ ${sales}. Discrepancy: ${discText}.`,
          type: discrepancy !== 0 ? 'DISCREPANCY' : 'TILL_CLOSEOUT',
          link: '/reports/executive',
        },
      });

      // Trigger Private Android SMS Gateway Alert on Cash Shortage
      if (discrepancy < 0) {
        const { SmsService } = require('../services/smsService');
        SmsService.sendShortageAlert({
          shopName: till.warehouse?.name || 'Shop Location',
          staffName: userName,
          shortageAmount: `GH₵ ${Math.abs(discrepancy).toFixed(2)}`,
          recipientPhone: process.env.OWNER_PHONE_NUMBER || '+233200000000',
        }).catch((smsErr: any) => {
          console.error('[CashTill] Error dispatching SMS shortage alert:', smsErr);
        });
      }

      return report;
    });

    res.status(200).json({ success: true, message: 'Till closed and daily report generated', data: { report } });
  } catch (error: any) {
    console.error('[CashTill] Error closing till:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to close till.' });
  }
});

/**
 * GET /api/v1/tills/closeouts
 * Returns daily closeout reports across all shops for Owner & Accountant.
 */
router.get('/closeouts', async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const closeouts = await withCurrentTenantDb(prisma, async (client) => {
      return (client as any).dailyCloseoutReport.findMany({
        where: { tenantId },
        include: { warehouse: true, till: true },
        orderBy: { closedAt: 'desc' },
      });
    });

    res.status(200).json({ success: true, data: { closeouts } });
  } catch (error: any) {
    console.error('[CashTill] Error fetching closeouts:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch daily closeout reports.' });
  }
});

export default router;
