import { Router, Request, Response } from 'express';
import { prisma } from '../config/db';
import { withCurrentTenantDb } from '../database/tenantClient';
import { authenticateJwt } from '../middleware/authMiddleware';
import { tenantContextMiddleware } from '../middleware/tenantContextMiddleware';
import { requireTenantContext } from '../context/tenantContext';
import { assertWarehouseAccess, getAccessibleWarehouseIds, WarehouseAccessError } from '../services/warehouseAccessService';
import { verifyPassword } from '../utils/password';
import { recordAuditLog, actorFromRequest } from '../services/auditLogService';

// Roles that can authorize a void either by initiating it themselves or by
// stepping up to approve a Cashier-initiated one.
const VOID_AUTHORIZER_ROLES = ['Admin', 'Shop Manager', 'Accountant'];

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
          createdByUserId: req.user!.id,
          createdByName: req.user!.name || req.user!.email,
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
 * POST /api/v1/tills/sales/:id/void
 * Voids a completed cash sale: restores the deducted stock, reverses the
 * till's running cash total, and marks the sale VOIDED with a full audit
 * trail. Any Admin/Shop Manager/Accountant can void their own sale directly;
 * anyone else (e.g. a Cashier) must supply a manager's own credentials as a
 * step-up confirmation - this is the actual safeguard against a cashier
 * voiding a completed sale to quietly pocket the cash while stock and books
 * appear to reconcile.
 */
router.post('/sales/:id/void', async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const { id } = req.params;
    const { reason, managerEmail, managerPassword } = req.body;

    if (!reason || typeof reason !== 'string' || !reason.trim()) {
      res.status(400).json({ success: false, error: 'A reason is required to void a sale.' });
      return;
    }

    const result = await withCurrentTenantDb(prisma, async (client) => {
      const sale = await (client as any).cashSale.findFirst({
        where: { id, tenantId },
        include: { lines: true, till: { include: { warehouse: true } } },
      });
      if (!sale) throw new Error('Sale not found.');
      if (sale.status === 'VOIDED') throw new Error('This sale has already been voided.');

      await assertWarehouseAccess(client, tenantId, req.user!.id, req.user!.role, sale.till.warehouseId);

      if (sale.till.status !== 'OPEN') {
        throw new Error(
          'This sale belongs to a till that has already been closed and reconciled - it can no longer be voided. Use a stock adjustment to correct inventory instead.'
        );
      }

      const actingRole = req.user!.role;
      let authorizer: { id: string; name: string; role: string };

      if (VOID_AUTHORIZER_ROLES.includes(actingRole)) {
        // Self-authorizing manager/admin/accountant - no step-up needed.
        authorizer = { id: req.user!.id, name: req.user!.name || req.user!.email, role: actingRole };
      } else {
        // Cashier (or any other non-authorizer role) must supply a manager's
        // own credentials right here - the actual "manager PIN override"
        // equivalent for a web app.
        if (!managerEmail || !managerPassword) {
          throw new Error('A manager must confirm this void with their email and password.');
        }
        const manager = await prisma.user.findFirst({
          where: { email: String(managerEmail).trim().toLowerCase(), tenantId, isActive: true },
        });
        if (!manager || !verifyPassword(managerPassword, manager.password)) {
          throw new Error('Manager credentials are incorrect.');
        }
        if (!VOID_AUTHORIZER_ROLES.includes(manager.role)) {
          throw new Error('That account is not authorized to approve a void.');
        }
        authorizer = { id: manager.id, name: manager.name || manager.email, role: manager.role };
      }

      // Restore stock for every line.
      for (const line of sale.lines) {
        await (client as any).warehouseStock.updateMany({
          where: { warehouseId: sale.till.warehouseId, itemId: line.itemId },
          data: { quantityOnHand: { increment: line.quantity } },
        });
      }

      // Reverse the till's running cash-sales total.
      await (client as any).cashTill.update({
        where: { id: sale.tillId },
        data: { cashSalesTotal: { decrement: Number(sale.amount) } },
      });

      const voided = await (client as any).cashSale.update({
        where: { id: sale.id },
        data: {
          status: 'VOIDED',
          voidedAt: new Date(),
          voidedByUserId: authorizer.id,
          voidedByName: authorizer.name,
          voidReason: reason.trim(),
        },
      });

      return { voided, authorizer, originalAmount: Number(sale.amount) };
    });

    await recordAuditLog({
      action: 'CASH_SALE.VOIDED',
      entity: 'CashSale',
      entityId: result.voided.id,
      tenantId,
      actor: actorFromRequest(req),
      changes: { status: { from: 'COMPLETED', to: 'VOIDED' } },
      details: `Sale ${result.voided.receiptNo} (GH₵ ${result.originalAmount.toFixed(2)}) voided by ${req.user!.name || req.user!.email}, authorized by ${result.authorizer.name} (${result.authorizer.role}). Reason: ${result.voided.voidReason}`,
    });

    res.status(200).json({ success: true, message: 'Sale voided and stock restored.', data: { sale: result.voided } });
  } catch (error: any) {
    console.error('[CashTill] Error voiding sale:', error);
    if (error instanceof WarehouseAccessError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
      return;
    }
    const status = error.message?.includes('not found') ? 404 : 400;
    res.status(status).json({ success: false, error: error.message || 'Failed to void sale.' });
  }
});

/**
 * GET /api/v1/tills/void-stats
 * Per-cashier void-ratio report - surfaces potential fraud patterns
 * (someone voiding an unusually high share of their own sales) for a
 * manager/admin/accountant to review, rather than alerting on every void.
 */
router.get('/void-stats', async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    if (!VOID_AUTHORIZER_ROLES.includes(req.user!.role)) {
      res.status(403).json({ success: false, error: 'You do not have permission to view void statistics.' });
      return;
    }

    const { from, to } = req.query;

    const stats = await withCurrentTenantDb(prisma, async (client) => {
      const accessibleIds = await getAccessibleWarehouseIds(client, tenantId, req.user!.id, req.user!.role);

      const where: any = { tenantId };
      if (from || to) {
        where.createdAt = {};
        if (from) where.createdAt.gte = new Date(String(from));
        if (to) where.createdAt.lte = new Date(String(to));
      }
      if (accessibleIds !== null) {
        where.till = { warehouseId: { in: accessibleIds } };
      }

      const sales = await (client as any).cashSale.findMany({
        where,
        select: { createdByUserId: true, createdByName: true, status: true },
      });

      const byUser = new Map<string, { name: string; total: number; voided: number }>();
      for (const s of sales) {
        const key = s.createdByUserId || 'unknown';
        const entry = byUser.get(key) || { name: s.createdByName || 'Unknown', total: 0, voided: 0 };
        entry.total += 1;
        if (s.status === 'VOIDED') entry.voided += 1;
        byUser.set(key, entry);
      }

      const VOID_RATIO_ANOMALY_THRESHOLD = 0.15;
      const MIN_SAMPLE_SIZE = 5;

      return Array.from(byUser.entries())
        .map(([userId, v]) => {
          const ratio = v.total > 0 ? v.voided / v.total : 0;
          return {
            userId,
            name: v.name,
            totalSales: v.total,
            voidedSales: v.voided,
            voidRatio: Number(ratio.toFixed(4)),
            anomaly: v.total >= MIN_SAMPLE_SIZE && ratio >= VOID_RATIO_ANOMALY_THRESHOLD,
          };
        })
        .sort((a, b) => b.voidRatio - a.voidRatio);
    });

    res.status(200).json({ success: true, data: stats });
  } catch (error: any) {
    console.error('[CashTill] Error computing void stats:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to compute void statistics.' });
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
