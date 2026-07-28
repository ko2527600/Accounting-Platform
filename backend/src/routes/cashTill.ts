import { Router, Request, Response } from 'express';
import { prisma } from '../config/db';
import { withCurrentTenantDb } from '../database/tenantClient';
import { authenticateJwt } from '../middleware/authMiddleware';
import { tenantContextMiddleware } from '../middleware/tenantContextMiddleware';
import { requireTenantContext } from '../context/tenantContext';
import { assertWarehouseAccess, getAccessibleWarehouseIds, WarehouseAccessError } from '../services/warehouseAccessService';

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
      if (warehouseId) {
        await assertWarehouseAccess(client, tenantId, req.user!.id, req.user!.role, String(warehouseId));
      }
      const accessibleIds = warehouseId ? null : await getAccessibleWarehouseIds(client, tenantId, req.user!.id, req.user!.role);

      return (client as any).cashTill.findFirst({
        where: {
          tenantId,
          ...(warehouseId && { warehouseId: String(warehouseId) }),
          ...(accessibleIds !== null && { warehouseId: { in: accessibleIds } }),
          status: 'OPEN',
        },
        include: { warehouse: true, sales: { include: { lines: true }, orderBy: { createdAt: 'desc' } } },
        orderBy: { openedAt: 'desc' },
      });
    });

    res.status(200).json({ success: true, data: { till } });
  } catch (error: any) {
    console.error('[CashTill] Error fetching current till:', error);
    if (error instanceof WarehouseAccessError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
      return;
    }
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
      await assertWarehouseAccess(client, tenantId, req.user!.id, req.user!.role, warehouseId);

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
    if (error instanceof WarehouseAccessError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to open cash till.' });
  }
});

/**
 * POST /api/v1/tills/sales
 * Records a physical cash sale, updates inventory stock, and posts revenue.
 */
/**
 * POST /api/v1/tills/sales
 * Records a real cash sale for a basket of one or more items in a single
 * transaction - one receipt, one cash-given/change calculation, one atomic
 * stock deduction across every line. Body: { tillId, items: [{itemId,
 * quantity}], cashGiven }.
 */
router.post('/sales', async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const { tillId, items, cashGiven } = req.body;

    if (!tillId || !Array.isArray(items) || items.length === 0 || cashGiven === undefined || cashGiven === null || cashGiven === '') {
      res.status(400).json({ success: false, error: 'Till ID, at least one cart item, and cash given are required.' });
      return;
    }
    for (const line of items) {
      if (!line || typeof line.itemId !== 'string' || !line.itemId) {
        res.status(400).json({ success: false, error: 'Every cart line must include an item ID.' });
        return;
      }
      if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
        res.status(400).json({
          success: false,
          error: `Invalid quantity for item ${line.itemId} - must be a whole number greater than zero.`,
        });
        return;
      }
    }

    const result = await withCurrentTenantDb(prisma, async (client) => {
      const till = await (client as any).cashTill.findFirst({
        where: { id: tillId, tenantId },
        include: { warehouse: true },
      });

      if (!till || till.status !== 'OPEN') {
        throw new Error('Cash till is not open or does not exist.');
      }

      await assertWarehouseAccess(client, tenantId, req.user!.id, req.user!.role, till.warehouseId);

      const itemIds = [...new Set(items.map((l: any) => l.itemId))];
      const foundItems = await (client as any).inventoryItem.findMany({ where: { id: { in: itemIds }, tenantId } });
      const itemsById = new Map(foundItems.map((it: any) => [it.id, it]));

      const missingId = itemIds.find((id: string) => !itemsById.has(id));
      if (missingId) {
        throw new Error('Inventory item not found.');
      }

      const stocks = await (client as any).warehouseStock.findMany({
        where: { warehouseId: till.warehouseId, itemId: { in: itemIds } },
      });
      const stockByItemId = new Map(stocks.map((s: any) => [s.itemId, s]));

      // Friendly pre-check for every line before touching anything - the
      // actual deduction below is still atomically guarded per line to
      // protect against a genuine concurrent race.
      for (const line of items) {
        const item = itemsById.get(line.itemId) as any;
        const stock = stockByItemId.get(line.itemId) as any;
        if (!stock || stock.quantityOnHand < line.quantity) {
          throw new Error(
            `Insufficient stock for ${item.name} in ${till.warehouse.name} (Available: ${stock?.quantityOnHand || 0} ${item.unitOfMeasure}).`
          );
        }
      }

      const totalAmount = items.reduce((sum: number, line: any) => {
        const item = itemsById.get(line.itemId) as any;
        return sum + Number(item.sellingPrice) * line.quantity;
      }, 0);

      const changeGiven = Number(cashGiven) - totalAmount;
      if (changeGiven < 0) {
        throw new Error(`Cash given (GH₵ ${cashGiven}) is less than total bill amount (GH₵ ${totalAmount.toFixed(2)}).`);
      }

      // 1. Deduct stock per line - atomic guarded decrement so two concurrent
      // sales of the same item can't both read the same stale quantity and
      // both succeed (lost-update / phantom-stock bug).
      for (const line of items) {
        const stock = stockByItemId.get(line.itemId) as any;
        const deduction = await (client as any).warehouseStock.updateMany({
          where: { id: stock.id, quantityOnHand: { gte: line.quantity } },
          data: { quantityOnHand: { decrement: line.quantity } },
        });
        if (deduction.count === 0) {
          const item = itemsById.get(line.itemId) as any;
          throw new Error(`Insufficient stock for ${item.name} (stock changed concurrently, please retry).`);
        }
      }

      // 2. Record the cash sale header and its lines.
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

      const lines = items.map((line: any) => {
        const item = itemsById.get(line.itemId) as any;
        return {
          itemId: line.itemId,
          itemName: item.name as string,
          itemSku: item.sku as string,
          quantity: line.quantity as number,
          unitPrice: Number(item.sellingPrice),
          lineTotal: Number(item.sellingPrice) * line.quantity,
        };
      });

      await (client as any).cashSaleLine.createMany({
        data: lines.map((l: any) => ({ tenantId, saleId: sale.id, ...l })),
      });

      // 3. Increment till total cash sales atomically - avoids losing concurrent
      // sales' contributions to the running total.
      await (client as any).cashTill.update({
        where: { id: tillId },
        data: { cashSalesTotal: { increment: totalAmount } },
      });

      return { sale, lines, totalAmount, changeGiven };
    });

    res.status(201).json({ success: true, message: 'Cash sale recorded successfully', data: result });
  } catch (error: any) {
    console.error('[CashTill] Error recording cash sale:', error);
    if (error instanceof WarehouseAccessError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
      return;
    }
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

      await assertWarehouseAccess(client, tenantId, req.user!.id, req.user!.role, till.warehouseId);

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
    if (error instanceof WarehouseAccessError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
      return;
    }
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
      const accessibleIds = await getAccessibleWarehouseIds(client, tenantId, req.user!.id, req.user!.role);
      const where: any = { tenantId };
      if (accessibleIds !== null) where.warehouseId = { in: accessibleIds };

      return (client as any).dailyCloseoutReport.findMany({
        where,
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
