import { Router, Request, Response } from 'express';
import { prisma } from '../config/db';
import { withCurrentTenantDb } from '../database/tenantClient';
import { authenticateJwt } from '../middleware/authMiddleware';
import { tenantContextMiddleware } from '../middleware/tenantContextMiddleware';
import { requireRole } from '../middleware/rbacMiddleware';
import { requireTenantContext } from '../context/tenantContext';
import { assertWarehouseAccess, getAccessibleWarehouseIds, WarehouseAccessError } from '../services/warehouseAccessService';
import { verifyPassword } from '../utils/password';
import { recordAuditLog, recordAuditLogTx, actorFromRequest, AuditActor } from '../services/auditLogService';
import { SmsService } from '../services/smsService';
import * as accountRepository from '../repository/accountRepository';
import * as journalService from '../services/journalEntryService';
import { sendWhatsAppReceipt } from '../services/whatsAppReceiptService';

/**
 * Posts the real Cash/Revenue journal entry for a completed POS cash sale
 * and stamps its id onto the CashSale row - called as a separate step after
 * the sale's own atomic stock-deduction transaction commits (same
 * two-step "domain transaction, then journal posting" pattern used by
 * reimburseExpenseClaim/recordInvoicePayment), never nested inside it, since
 * journalEntryService opens its own top-level transaction. A failure here is
 * deliberately swallowed rather than thrown - the sale, its stock deduction,
 * and the cash already collected are all real and must not be rolled back or
 * reported as a failed request just because revenue posting hit a snag; the
 * missing journalId is picked up on the next clientTxnId replay (see the
 * `!result.sale.journalId` check at each call site below).
 */
async function postCashSaleRevenue(
  sale: { id: string; amount: any; receiptNo: string; createdByName?: string | null },
  actor: AuditActor
): Promise<string | null> {
  try {
    const [accounts, saleLines] = await Promise.all([
      withCurrentTenantDb(prisma, (client) => accountRepository.listAccounts(client)),
      withCurrentTenantDb(prisma, (client) =>
        (client as any).cashSaleLine.findMany({
          where: { saleId: sale.id },
        })
      ),
    ]);

    const itemIds: string[] = (saleLines as any[]).map((l: any) => l.itemId).filter(Boolean);
    const inventoryItems: any[] = itemIds.length > 0
      ? (await withCurrentTenantDb(prisma, (client) =>
          (client as any).inventoryItem.findMany({
            where: { id: { in: itemIds } },
            select: { id: true, costPrice: true },
          })
        ) as any[])
      : [];
    const costByItemId = new Map<string, number>(
      inventoryItems.map((item: any) => [item.id, Number(item.costPrice)])
    );

    const cashAcc = accountRepository.resolveDefaultAccount(accounts, 'CASH') || accounts[0];
    const revenueAcc = accountRepository.resolveDefaultAccount(accounts, 'REVENUE') || accounts[0];
    if (!cashAcc || !revenueAcc) {
      console.error(`[CashTill] Cannot post revenue for sale ${sale.receiptNo} - no Cash/Revenue account configured.`);
      return null;
    }

    const amount = Number(sale.amount);
    const lines: { accountId: string; debit: number; credit: number; description: string }[] = [
      { accountId: cashAcc.id, debit: amount, credit: 0, description: `Cash received - ${sale.receiptNo}` },
      { accountId: revenueAcc.id, debit: 0, credit: amount, description: `Sales revenue - ${sale.receiptNo}` },
    ];

    // COGS: Debit Cost of Goods Sold / Credit Inventory Asset for every line
    // that has a recorded cost price. Only posted when both accounts are
    // designated — silently omitted otherwise so existing tenants without the
    // designation don't break.
    const cogsAcc = accountRepository.resolveDefaultAccount(accounts, 'COGS');
    const invAcc = accountRepository.resolveDefaultAccount(accounts, 'INVENTORY_ASSET');
    if (cogsAcc && invAcc && Array.isArray(saleLines) && saleLines.length > 0) {
      const totalCost = (saleLines as any[]).reduce((sum: number, l: any) => {
        const cost = costByItemId.get(l.itemId) ?? 0;
        return sum + cost * Number(l.quantity);
      }, 0);
      const cogs = Math.round(totalCost * 100) / 100;
      if (cogs > 0) {
        lines.push({ accountId: cogsAcc.id, debit: cogs, credit: 0, description: `COGS - ${sale.receiptNo}` });
        lines.push({ accountId: invAcc.id, debit: 0, credit: cogs, description: `Inventory - ${sale.receiptNo}` });
      }
    }

    const journal = await journalService.createJournalEntry(
      {
        description: `POS Cash Sale ${sale.receiptNo}${sale.createdByName ? ` (${sale.createdByName})` : ''}`,
        entryDate: new Date().toISOString().split('T')[0],
        status: 'POSTED',
        lines,
      },
      actor
    );

    await withCurrentTenantDb(prisma, (client) =>
      (client as any).cashSale.update({ where: { id: sale.id }, data: { journalId: journal.id } })
    );

    return journal.id;
  } catch (error: any) {
    console.error(`[CashTill] Failed to post revenue journal for sale ${sale.receiptNo}:`, error);
    return null;
  }
}

// Roles that can authorize a void either by initiating it themselves or by
// stepping up to approve a Cashier-initiated one.
const VOID_AUTHORIZER_ROLES = ['Admin', 'Shop Manager', 'Accountant'];

// Sentinel thrown when a POST /tills/sales retry/replay collides with an
// already-committed sale sharing the same clientTxnId. Caught outside the
// transaction so the loser's own (already-applied) stock decrement rolls
// back cleanly, then the winning sale is re-fetched in a fresh transaction
// once it's guaranteed committed.
class DuplicateSaleReplayError extends Error {
  constructor() {
    super('Duplicate sale replay - clientTxnId already recorded.');
    this.name = 'DuplicateSaleReplayError';
  }
}

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
    const { tillId, items, cashGiven, clientTxnId, clientOccurredAt, saleType, customerPhone, customerName } = req.body;
    const resolvedSaleType = saleType === 'WHOLESALE' ? 'WHOLESALE' : 'RETAIL';

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
    if (clientTxnId !== undefined && (typeof clientTxnId !== 'string' || !clientTxnId)) {
      res.status(400).json({ success: false, error: 'clientTxnId, if provided, must be a non-empty string.' });
      return;
    }

    let result;
    try {
      result = await withCurrentTenantDb(prisma, async (client) => {
        const till = await (client as any).cashTill.findFirst({
          where: { id: tillId, tenantId },
          include: { warehouse: true },
        });

        if (!till || till.status !== 'OPEN') {
          throw new Error('Cash till is not open or does not exist.');
        }

        await assertWarehouseAccess(client, tenantId, req.user!.id, req.user!.role, till.warehouseId);

        // Fast-path: a simple sequential retry (the common case - e.g. an
        // offline-queued sale being replayed, or a double-tap submit) hits
        // this before redoing any stock work. This is an optimization only,
        // not the safety net - see the P2002 handling below for why.
        if (clientTxnId) {
          const existing = await (client as any).cashSale.findFirst({
            where: { tenantId, clientTxnId },
            include: { lines: true },
          });
          if (existing) {
            return { sale: existing, lines: existing.lines, totalAmount: Number(existing.amount), changeGiven: Number(existing.changeGiven), replayed: true };
          }
        }

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

        const effectivePriceFor = (item: any): number => {
          if (resolvedSaleType === 'WHOLESALE' && item.wholesalePrice !== null && item.wholesalePrice !== undefined) {
            return Number(item.wholesalePrice);
          }
          return Number(item.sellingPrice);
        };

        const totalAmount = items.reduce((sum: number, line: any) => {
          const item = itemsById.get(line.itemId) as any;
          return sum + effectivePriceFor(item) * line.quantity;
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
        let sale;
        try {
          sale = await (client as any).cashSale.create({
            data: {
              tenantId,
              tillId,
              receiptNo,
              amount: totalAmount,
              cashGiven: Number(cashGiven),
              changeGiven,
              createdByUserId: req.user!.id,
              createdByName: req.user!.name || req.user!.email,
              clientTxnId: clientTxnId || null,
              clientOccurredAt: clientOccurredAt ? new Date(clientOccurredAt) : null,
              saleType: resolvedSaleType,
              customerName: customerName ? String(customerName).trim() : null,
              customerPhone: customerPhone ? String(customerPhone).trim() : null,
            },
          });
        } catch (createError: any) {
          // A concurrent request racing on the SAME clientTxnId can lose this
          // unique-constraint check even after passing the fast-path findFirst
          // above (Read Committed isolation - both can start before either
          // commits). Postgres blocks this INSERT until the winner resolves,
          // so by the time we get here the winner is guaranteed committed or
          // rolled back. Throw a sentinel so this whole transaction rolls back
          // cleanly (including this request's own stock decrement above) -
          // swallowing this here and returning 200 would let Prisma commit the
          // transaction anyway, silently double-deducting stock.
          if (createError.code === 'P2002' && clientTxnId && createError.meta?.target?.includes?.('client_txn_id')) {
            throw new DuplicateSaleReplayError();
          }
          throw createError;
        }

        const lines = items.map((line: any) => {
          const item = itemsById.get(line.itemId) as any;
          const price = effectivePriceFor(item);
          return {
            itemId: line.itemId,
            itemName: item.name as string,
            itemSku: item.sku as string,
            quantity: line.quantity as number,
            unitPrice: price,
            lineTotal: price * line.quantity,
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

        return { sale, lines, totalAmount, changeGiven, replayed: false };
    });
    } catch (raceError: any) {
      if (raceError instanceof DuplicateSaleReplayError) {
        // The winning transaction is guaranteed committed by now (Postgres
        // blocked our INSERT until it resolved) - a fresh transaction here
        // is safe and will find it.
        result = await withCurrentTenantDb(prisma, async (client) => {
          const existing = await (client as any).cashSale.findFirst({
            where: { tenantId, clientTxnId },
            include: { lines: true },
          });
          return { sale: existing, lines: existing.lines, totalAmount: Number(existing.amount), changeGiven: Number(existing.changeGiven), replayed: true };
        });
      } else {
        throw raceError;
      }
    }

    // Post revenue outside the stock-deduction transaction (see
    // postCashSaleRevenue's own comment) - covers a brand-new sale and, via
    // the same journalId check, self-heals a prior attempt that recorded
    // the sale but never got as far as posting its revenue.
    if (!result.sale.journalId) {
      const journalId = await postCashSaleRevenue(result.sale, actorFromRequest(req));
      if (journalId) result.sale.journalId = journalId;
    }

    // Fire-and-forget WhatsApp receipt if customer phone was provided
    const phone = result.sale.customerPhone || customerPhone;
    if (phone && !result.replayed) {
      const { tenantName } = requireTenantContext();
      sendWhatsAppReceipt(String(phone), {
        receiptNo: result.sale.receiptNo,
        businessName: tenantName || 'Store',
        items: result.lines.map((l: any) => ({
          name: l.itemName,
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice),
          lineTotal: Number(l.lineTotal),
        })),
        totalAmount: result.totalAmount,
        cashGiven: Number(cashGiven),
        changeGiven: result.changeGiven,
        dateTime: new Date().toLocaleString('en-GH', { timeZone: 'Africa/Accra' }),
      });
    }

    res.status(result.replayed ? 200 : 201).json({ success: true, message: 'Cash sale recorded successfully', data: result });
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
 * POST /api/v1/tills/sales/sync-failures
 * Records that a locally-queued offline sale definitively failed to sync
 * (e.g. a real stock conflict discovered only once connectivity returned -
 * there's no server-side offline stock reservation, so this is a genuine
 * possible outcome, not a bug). Deliberately creates no CashSale row - no sale was
 * ever actually completed server-side. This is a best-effort, fire-and-forget
 * call from the frontend once its sync loop gives up retrying a given sale,
 * so a manager on ANY device (not just the terminal that queued it) has
 * visibility via the audit log - a completed cash sale with real money
 * already collected must never be silently invisible outside one browser's
 * local IndexedDB.
 */
router.post('/sales/sync-failures', async (req: Request, res: Response): Promise<void> => {
  try {
    const { clientTxnId, reason, saleSnapshot } = req.body;
    if (!clientTxnId || typeof clientTxnId !== 'string') {
      res.status(400).json({ success: false, error: 'clientTxnId is required.' });
      return;
    }
    if (!reason || typeof reason !== 'string') {
      res.status(400).json({ success: false, error: 'reason is required.' });
      return;
    }

    await recordAuditLog({
      action: 'CASH_SALE.SYNC_FAILED',
      entity: 'CashSale',
      entityId: clientTxnId,
      actor: actorFromRequest(req),
      details: reason,
      changes: { saleSnapshot: { from: null, to: saleSnapshot ?? null } },
    });

    res.status(200).json({ success: true, message: 'Sync failure recorded for manual reconciliation.' });
  } catch (error: any) {
    console.error('[CashTill] Error recording sync failure:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to record sync failure.' });
  }
});

/**
 * Posts the reversing journal entry (Debit Revenue / Credit Cash) for a
 * voided POS sale that had already posted revenue, and stamps its id onto
 * the CashSale row as voidJournalId. Same "own journal entry for the
 * reversal" convention as creditDebitNoteService's revenue-reversal handling
 * (not journalEntryService.voidJournalEntry, which is the generic
 * journal-entries-page mechanism) and the same "called after the mutating
 * transaction commits, failure swallowed rather than thrown" shape as
 * postCashSaleRevenue above, for the same reasons.
 */
async function postCashSaleVoidReversal(
  sale: { id: string; amount: any; receiptNo: string },
  actor: AuditActor
): Promise<string | null> {
  try {
    const [accounts, saleLines] = await Promise.all([
      withCurrentTenantDb(prisma, (client) => accountRepository.listAccounts(client)),
      withCurrentTenantDb(prisma, (client) =>
        (client as any).cashSaleLine.findMany({
          where: { saleId: sale.id },
        })
      ),
    ]);

    const itemIds: string[] = (saleLines as any[]).map((l: any) => l.itemId).filter(Boolean);
    const inventoryItems: any[] = itemIds.length > 0
      ? (await withCurrentTenantDb(prisma, (client) =>
          (client as any).inventoryItem.findMany({
            where: { id: { in: itemIds } },
            select: { id: true, costPrice: true },
          })
        ) as any[])
      : [];
    const costByItemId = new Map<string, number>(
      inventoryItems.map((item: any) => [item.id, Number(item.costPrice)])
    );

    const cashAcc = accountRepository.resolveDefaultAccount(accounts, 'CASH') || accounts[0];
    const revenueAcc = accountRepository.resolveDefaultAccount(accounts, 'REVENUE') || accounts[0];
    if (!cashAcc || !revenueAcc) {
      console.error(`[CashTill] Cannot post void reversal for sale ${sale.receiptNo} - no Cash/Revenue account configured.`);
      return null;
    }

    const amount = Number(sale.amount);
    const lines: { accountId: string; debit: number; credit: number; description: string }[] = [
      { accountId: revenueAcc.id, debit: amount, credit: 0, description: `Revenue reversal - ${sale.receiptNo}` },
      { accountId: cashAcc.id, debit: 0, credit: amount, description: `Cash paid out - ${sale.receiptNo}` },
    ];

    // Reverse COGS: Credit COGS / Debit Inventory (goods returned to stock)
    const cogsAcc = accountRepository.resolveDefaultAccount(accounts, 'COGS');
    const invAcc = accountRepository.resolveDefaultAccount(accounts, 'INVENTORY_ASSET');
    if (cogsAcc && invAcc && Array.isArray(saleLines) && saleLines.length > 0) {
      const totalCost = (saleLines as any[]).reduce((sum: number, l: any) => {
        const cost = costByItemId.get(l.itemId) ?? 0;
        return sum + cost * Number(l.quantity);
      }, 0);
      const cogs = Math.round(totalCost * 100) / 100;
      if (cogs > 0) {
        lines.push({ accountId: invAcc.id, debit: cogs, credit: 0, description: `Inventory restored - ${sale.receiptNo}` });
        lines.push({ accountId: cogsAcc.id, debit: 0, credit: cogs, description: `COGS reversal - ${sale.receiptNo}` });
      }
    }

    const journal = await journalService.createJournalEntry(
      {
        description: `Void reversal for POS Cash Sale ${sale.receiptNo}`,
        entryDate: new Date().toISOString().split('T')[0],
        status: 'POSTED',
        lines,
      },
      actor
    );

    await withCurrentTenantDb(prisma, (client) =>
      (client as any).cashSale.update({ where: { id: sale.id }, data: { voidJournalId: journal.id } })
    );

    return journal.id;
  } catch (error: any) {
    console.error(`[CashTill] Failed to post void reversal journal for sale ${sale.receiptNo}:`, error);
    return null;
  }
}

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

      await recordAuditLogTx(client, {
        action: 'CASH_SALE.VOIDED',
        entity: 'CashSale',
        entityId: voided.id,
        tenantId,
        actor: actorFromRequest(req),
        changes: { status: { from: 'COMPLETED', to: 'VOIDED' } },
        details: `Sale ${voided.receiptNo} (GH₵ ${Number(sale.amount).toFixed(2)}) voided by ${req.user!.name || req.user!.email}, authorized by ${authorizer.name} (${authorizer.role}). Reason: ${voided.voidReason}`,
      });

      return { voided, authorizer, originalAmount: Number(sale.amount), originalJournalId: sale.journalId as string | null };
    });

    // Only a sale that actually posted revenue needs a reversal - a sale
    // voided before its own journal posting caught up (see
    // postCashSaleRevenue) has nothing in the ledger to reverse.
    if (result.originalJournalId) {
      const voidJournalId = await postCashSaleVoidReversal(
        { id: result.voided.id, amount: result.originalAmount, receiptNo: result.voided.receiptNo },
        actorFromRequest(req)
      );
      if (voidJournalId) result.voided.voidJournalId = voidJournalId;
    }

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
        // Bucket by clientOccurredAt (when a synced offline sale actually
        // happened) when present, falling back to createdAt (true row-insert
        // time) for every sale that never carried one - i.e. every sale
        // recorded before offline sync existed, and every online sale today.
        const range: any = {};
        if (from) range.gte = new Date(String(from));
        if (to) range.lte = new Date(String(to));
        where.OR = [
          { clientOccurredAt: range },
          { clientOccurredAt: null, createdAt: range },
        ];
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
 * POST /api/v1/tills/backfill-revenue
 * One-time-per-sale repair for the historical gap where POST /tills/sales
 * never posted a journal entry at all (fixed above, but only for sales
 * recorded after that fix deployed - an existing COMPLETED sale's journalId
 * stays null forever unless something explicitly posts it). Finds every
 * COMPLETED sale for this tenant with no journalId and posts its Cash/Revenue
 * entry now, via the same postCashSaleRevenue() used for new sales. Safe to
 * call repeatedly - a sale that already has a journalId is never touched
 * again, so this is idempotent and cheap on a second run.
 */
router.post('/backfill-revenue', requireRole('Admin', 'Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const actor = actorFromRequest(req);

    const unposted: any[] = await withCurrentTenantDb(prisma, (client) =>
      (client as any).cashSale.findMany({
        where: { tenantId, status: 'COMPLETED', journalId: null },
        orderBy: { createdAt: 'asc' },
      })
    );

    let backfilled = 0;
    let failed = 0;
    for (const sale of unposted) {
      const journalId = await postCashSaleRevenue(sale, actor);
      if (journalId) backfilled++;
      else failed++;
    }

    res.status(200).json({
      success: true,
      message: backfilled > 0
        ? `Backfilled revenue for ${backfilled} sale(s) that predate automatic posting.`
        : 'No missing revenue postings found.',
      data: { checked: unposted.length, backfilled, failed },
    });
  } catch (error: any) {
    console.error('[CashTill] Error backfilling missing revenue:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to backfill missing revenue.' });
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

    // Looked up once, outside the tenant-schema transaction below - Tenant
    // lives in the public schema, not per-tenant, same reason GET/PUT
    // /tenants/current query it via the un-scoped `prisma` client rather
    // than the search_path-scoped `client` the transaction callback gets.
    const tenantForAlert = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { bossPhone: true } });

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

      // Trigger Private Android SMS Gateway Alert to the tenant's configured
      // boss number on every close (not just shortages) - the owner gets a
      // running SMS record of every shift's cash count without opening the
      // app. Skipped entirely (not sent to a shared fallback number) when
      // this tenant hasn't configured a boss phone in Settings.
      if (tenantForAlert?.bossPhone) {
        SmsService.sendTillCloseAlert({
          shopName: till.warehouse?.name || 'Shop Location',
          staffName: userName,
          cashSales: `GH₵ ${sales.toFixed(2)}`,
          expectedCash: `GH₵ ${expected.toFixed(2)}`,
          actualCash: `GH₵ ${actual.toFixed(2)}`,
          discrepancyText: discText,
          recipientPhone: tenantForAlert.bossPhone,
        }).catch((smsErr: any) => {
          console.error('[CashTill] Error dispatching till-close SMS alert:', smsErr);
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
