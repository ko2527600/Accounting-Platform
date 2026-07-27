import { Router, Request, Response } from 'express';
import { prisma } from '../config/db';
import { withCurrentTenantDb } from '../database/tenantClient';
import { authenticateJwt } from '../middleware/authMiddleware';
import { tenantContextMiddleware } from '../middleware/tenantContextMiddleware';
import { requireRole } from '../middleware/rbacMiddleware';
import { requireTenantContext } from '../context/tenantContext';
import { assertWarehouseAccess, getAccessibleWarehouseIds, WarehouseAccessError } from '../services/warehouseAccessService';

const router = Router();

router.use(authenticateJwt);
router.use(tenantContextMiddleware);

/**
 * GET /api/v1/inventory/warehouses
 * Lists all warehouses / godowns with stock counts.
 */
router.get('/warehouses', async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const warehouses = await withCurrentTenantDb(prisma, async (client) => {
      const accessibleIds = await getAccessibleWarehouseIds(client, tenantId, req.user!.id, req.user!.role);
      const where: any = { tenantId };
      if (accessibleIds !== null) where.id = { in: accessibleIds };

      return (client as any).warehouse.findMany({
        where,
        include: { stocks: { include: { item: true } } },
        orderBy: { createdAt: 'desc' },
      });
    });

    res.status(200).json({ success: true, data: { warehouses } });
  } catch (error: any) {
    console.error('[Inventory] Error fetching warehouses:', error);
    res.status(500).json({ success: false, error: 'Failed to retrieve warehouses.' });
  }
});

/**
 * POST /api/v1/inventory/warehouses
 * Creates a new warehouse / godown.
 */
router.post('/warehouses', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const { name, location, managerName, isPrimary } = req.body;
    if (!name || !name.trim()) {
      res.status(400).json({ success: false, error: 'Warehouse name is required.' });
      return;
    }

    const code = `WH-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

    const created = await withCurrentTenantDb(prisma, async (client) => {
      return (client as any).warehouse.create({
        data: {
          tenantId,
          name: name.trim(),
          code,
          location: location ? location.trim() : null,
          managerName: managerName ? managerName.trim() : null,
          isPrimary: Boolean(isPrimary),
        },
      });
    });

    res.status(201).json({ success: true, message: 'Warehouse created successfully', data: { warehouse: created } });
  } catch (error: any) {
    console.error('[Inventory] Error creating warehouse:', error);
    res.status(500).json({ success: false, error: 'Failed to create warehouse.' });
  }
});

/**
 * GET /api/v1/inventory/items
 * Lists all inventory items across warehouses.
 */
router.get('/items', async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const items = await withCurrentTenantDb(prisma, async (client) => {
      const accessibleIds = await getAccessibleWarehouseIds(client, tenantId, req.user!.id, req.user!.role);

      const allItems = await (client as any).inventoryItem.findMany({
        where: { tenantId },
        include: { warehouseStocks: { include: { warehouse: true } } },
        orderBy: { name: 'asc' },
      });

      // A location-scoped user (Shop Manager/Cashier) sees the same product
      // catalog as everyone else, but only the stock levels for warehouses
      // they're assigned to - not every shop's stock.
      if (accessibleIds === null) return allItems;
      const accessibleSet = new Set(accessibleIds);
      return allItems.map((item: any) => ({
        ...item,
        warehouseStocks: item.warehouseStocks.filter((s: any) => accessibleSet.has(s.warehouseId)),
      }));
    });

    res.status(200).json({ success: true, data: { items } });
  } catch (error: any) {
    console.error('[Inventory] Error fetching items:', error);
    res.status(500).json({ success: false, error: 'Failed to retrieve inventory items.' });
  }
});

/**
 * POST /api/v1/inventory/items
 * Creates a new inventory item and assigns initial stock to a warehouse.
 */
router.post('/items', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const { name, sku, category = 'General', unitOfMeasure = 'pcs', costPrice, sellingPrice, initialWarehouseId, initialQty = 0 } = req.body;

    if (!name || !costPrice || !sellingPrice) {
      res.status(400).json({ success: false, error: 'Item name, cost price, and selling price are required.' });
      return;
    }

    const itemSku = sku ? sku.trim().toUpperCase() : `SKU-${Math.floor(1000 + Math.random() * 9000)}`;

    const createdItem = await withCurrentTenantDb(prisma, async (client) => {
      if (initialWarehouseId) {
        const warehouse = await (client as any).warehouse.findFirst({ where: { id: initialWarehouseId, tenantId } });
        if (!warehouse) {
          throw new Error('Initial warehouse not found.');
        }
        await assertWarehouseAccess(client, tenantId, req.user!.id, req.user!.role, initialWarehouseId);
      }

      const item = await (client as any).inventoryItem.create({
        data: {
          tenantId,
          sku: itemSku,
          name: name.trim(),
          category,
          unitOfMeasure,
          costPrice: Number(costPrice),
          sellingPrice: Number(sellingPrice),
        },
      });

      // If an initial warehouse was selected, seed initial stock
      if (initialWarehouseId && initialQty > 0) {
        await (client as any).warehouseStock.create({
          data: {
            tenantId,
            warehouseId: initialWarehouseId,
            itemId: item.id,
            quantityOnHand: Number(initialQty),
          },
        });
      }

      return item;
    });

    res.status(201).json({ success: true, message: 'Item created successfully', data: { item: createdItem } });
  } catch (error: any) {
    console.error('[Inventory] Error creating item:', error);
    if (error.message === 'Initial warehouse not found.') {
      res.status(404).json({ success: false, error: error.message });
      return;
    }
    if (error instanceof WarehouseAccessError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to create inventory item.' });
  }
});

/**
 * POST /api/v1/inventory/items/bulk
 * Creates many inventory items in one request (quick-add table or CSV import
 * on the frontend both funnel through this single endpoint). Each row is
 * attempted independently rather than as one all-or-nothing transaction, so
 * a single bad row (e.g. a duplicate SKU) doesn't discard every other
 * correctly-typed row in the batch - the response reports which rows
 * succeeded and which failed (with why) so the caller can fix and retry
 * only the failed ones.
 */
router.post('/items/bulk', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const { items } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ success: false, error: 'Provide a non-empty array of items to create.' });
      return;
    }
    if (items.length > 500) {
      res.status(400).json({ success: false, error: 'A maximum of 500 items can be created per bulk request.' });
      return;
    }

    const created: any[] = [];
    const failed: { index: number; name?: string; error: string }[] = [];

    await withCurrentTenantDb(prisma, async (client) => {
      const warehouseValidityCache = new Map<string, boolean>();
      const usedSkusThisBatch = new Set<string>();

      for (let i = 0; i < items.length; i++) {
        const row = items[i] || {};
        let itemSku = '';
        try {
          const { name, sku, category = 'General', unitOfMeasure = 'pcs', costPrice, sellingPrice, initialWarehouseId, initialQty = 0 } = row;

          if (!name || !String(name).trim()) throw new Error('Item name is required.');
          if (costPrice === undefined || costPrice === null || costPrice === '') throw new Error('Cost price is required.');
          if (sellingPrice === undefined || sellingPrice === null || sellingPrice === '') throw new Error('Selling price is required.');

          itemSku = sku ? String(sku).trim().toUpperCase() : '';
          if (!itemSku) {
            do {
              itemSku = `SKU-${Date.now().toString(36).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;
            } while (usedSkusThisBatch.has(itemSku));
          }
          if (usedSkusThisBatch.has(itemSku)) {
            throw new Error(`Duplicate SKU "${itemSku}" within this batch.`);
          }

          if (initialWarehouseId && !warehouseValidityCache.has(initialWarehouseId)) {
            const wh = await (client as any).warehouse.findFirst({ where: { id: initialWarehouseId, tenantId } });
            warehouseValidityCache.set(initialWarehouseId, !!wh);
          }
          if (initialWarehouseId && !warehouseValidityCache.get(initialWarehouseId)) {
            throw new Error('Initial warehouse not found.');
          }
          if (initialWarehouseId) {
            await assertWarehouseAccess(client, tenantId, req.user!.id, req.user!.role, initialWarehouseId);
          }

          const newItem = await (client as any).inventoryItem.create({
            data: {
              tenantId,
              sku: itemSku,
              name: String(name).trim(),
              category,
              unitOfMeasure,
              costPrice: Number(costPrice),
              sellingPrice: Number(sellingPrice),
            },
          });

          usedSkusThisBatch.add(itemSku);

          if (initialWarehouseId && Number(initialQty) > 0) {
            await (client as any).warehouseStock.create({
              data: {
                tenantId,
                warehouseId: initialWarehouseId,
                itemId: newItem.id,
                quantityOnHand: Number(initialQty),
              },
            });
          }

          created.push(newItem);
        } catch (rowError: any) {
          const message = rowError.code === 'P2002'
            ? `SKU "${itemSku}" already exists for this business.`
            : (rowError.message || 'Failed to create this item.');
          failed.push({ index: i, name: row?.name, error: message });
        }
      }
    });

    res.status(created.length > 0 ? 201 : 400).json({
      success: created.length > 0,
      message: `${created.length} item(s) created${failed.length > 0 ? `, ${failed.length} failed` : ''}.`,
      data: { created, failed },
    });
  } catch (error: any) {
    console.error('[Inventory] Error bulk-creating items:', error);
    res.status(500).json({ success: false, error: 'Failed to bulk-create inventory items.' });
  }
});

/**
 * POST /api/v1/inventory/transfers
 * Transfers stock items between two warehouses / godowns.
 */
router.post('/transfers', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const { fromWarehouseId, toWarehouseId, itemId, quantity, notes } = req.body;

    if (!fromWarehouseId || !toWarehouseId || !itemId || !quantity || quantity <= 0) {
      res.status(400).json({ success: false, error: 'Origin warehouse, destination warehouse, item ID, and valid quantity are required.' });
      return;
    }

    if (fromWarehouseId === toWarehouseId) {
      res.status(400).json({ success: false, error: 'Source and destination warehouses must be different.' });
      return;
    }

    const transfer = await withCurrentTenantDb(prisma, async (client) => {
      // Verify both warehouses and the item actually belong to this tenant
      // before touching any stock, so a caller can't reference another
      // tenant's warehouse/item IDs.
      const [fromWarehouse, toWarehouse, item] = await Promise.all([
        (client as any).warehouse.findFirst({ where: { id: fromWarehouseId, tenantId } }),
        (client as any).warehouse.findFirst({ where: { id: toWarehouseId, tenantId } }),
        (client as any).inventoryItem.findFirst({ where: { id: itemId, tenantId } }),
      ]);
      if (!fromWarehouse || !toWarehouse || !item) {
        throw new Error('Warehouse or item not found.');
      }

      // A location-scoped user may only move stock between warehouses they
      // actually have access to on both ends of the transfer.
      await assertWarehouseAccess(client, tenantId, req.user!.id, req.user!.role, fromWarehouseId);
      await assertWarehouseAccess(client, tenantId, req.user!.id, req.user!.role, toWarehouseId);

      // Check source stock (existence / friendly error message only - the actual
      // deduction below is guarded atomically so concurrent transfers can't both
      // read the same stale quantity and both succeed, driving it negative).
      const sourceStock = await (client as any).warehouseStock.findUnique({
        where: { warehouseId_itemId: { warehouseId: fromWarehouseId, itemId } },
      });

      if (!sourceStock || sourceStock.quantityOnHand < quantity) {
        throw new Error(`Insufficient stock in origin warehouse (Available: ${sourceStock?.quantityOnHand || 0} pcs).`);
      }

      // Atomic guarded decrement: only succeeds if quantityOnHand is still >= quantity
      // at the moment the row lock is acquired, so a concurrent transfer that already
      // consumed the stock causes this to affect 0 rows instead of going negative.
      const deduction = await (client as any).warehouseStock.updateMany({
        where: { id: sourceStock.id, quantityOnHand: { gte: Number(quantity) } },
        data: { quantityOnHand: { decrement: Number(quantity) } },
      });

      if (deduction.count === 0) {
        throw new Error('Insufficient stock in origin warehouse (stock changed concurrently, please retry).');
      }

      // Add to destination warehouse - atomic increment via upsert so a concurrent
      // transfer into the same (warehouse, item) pair can't overwrite this one.
      await (client as any).warehouseStock.upsert({
        where: { warehouseId_itemId: { warehouseId: toWarehouseId, itemId } },
        update: { quantityOnHand: { increment: Number(quantity) } },
        create: { tenantId, warehouseId: toWarehouseId, itemId, quantityOnHand: Number(quantity) },
      });

      // Record Transfer Audit
      const transferNumber = `TRF-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

      return (client as any).stockTransfer.create({
        data: {
          tenantId,
          transferNumber,
          fromWarehouseId,
          toWarehouseId,
          notes,
          items: {
            create: [{ tenantId, itemId, quantity: Number(quantity) }],
          },
        },
        include: { fromWarehouse: true, toWarehouse: true, items: true },
      });
    });

    res.status(201).json({
      success: true,
      message: 'Stock transfer completed successfully',
      data: { transfer },
    });
  } catch (error: any) {
    console.error('[Inventory] Error transferring stock:', error);
    if (error.message === 'Warehouse or item not found.') {
      res.status(404).json({ success: false, error: error.message });
      return;
    }
    if (error instanceof WarehouseAccessError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
      return;
    }
    res.status(500).json({ success: false, error: error.message || 'Failed to execute stock transfer.' });
  }
});

const ADJUSTMENT_MODES = new Set(['add', 'remove', 'set']);

/**
 * POST /api/v1/inventory/adjustments
 * Manually corrects an item's quantity in a warehouse - covers both
 * restocking an existing item (mode='add', e.g. a new supplier delivery)
 * and fixing a mistaken over/under-entry (mode='remove' to subtract units,
 * or mode='set' to declare the true, physically-counted quantity outright).
 * A reason is required and every adjustment is permanently recorded in
 * StockAdjustment for audit purposes - this is the same underlying action
 * as a stock transfer's audit trail, just for a single-warehouse correction
 * rather than a movement between two warehouses.
 */
router.post('/adjustments', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const { warehouseId, itemId, mode, quantity, reason } = req.body;

    if (!warehouseId || !itemId) {
      res.status(400).json({ success: false, error: 'Warehouse ID and item ID are required.' });
      return;
    }
    if (!ADJUSTMENT_MODES.has(mode)) {
      res.status(400).json({ success: false, error: "Mode must be one of 'add', 'remove', or 'set'." });
      return;
    }
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty < 0 || (mode !== 'set' && qty === 0)) {
      res.status(400).json({ success: false, error: 'Quantity must be a whole number (greater than zero for add/remove).' });
      return;
    }
    if (!reason || !String(reason).trim()) {
      res.status(400).json({ success: false, error: 'A reason is required for every stock adjustment.' });
      return;
    }

    const adjustedByName = req.user?.name || req.user?.email || 'Unknown';

    const result = await withCurrentTenantDb(prisma, async (client) => {
      const [warehouse, item] = await Promise.all([
        (client as any).warehouse.findFirst({ where: { id: warehouseId, tenantId } }),
        (client as any).inventoryItem.findFirst({ where: { id: itemId, tenantId } }),
      ]);
      if (!warehouse || !item) {
        throw new Error('Warehouse or item not found.');
      }

      await assertWarehouseAccess(client, tenantId, req.user!.id, req.user!.role, warehouseId);

      const existingStock = await (client as any).warehouseStock.findUnique({
        where: { warehouseId_itemId: { warehouseId, itemId } },
      });
      const previousQty = existingStock?.quantityOnHand || 0;

      let newQty: number;
      if (mode === 'add') {
        newQty = previousQty + qty;
        await (client as any).warehouseStock.upsert({
          where: { warehouseId_itemId: { warehouseId, itemId } },
          update: { quantityOnHand: { increment: qty } },
          create: { tenantId, warehouseId, itemId, quantityOnHand: qty },
        });
      } else if (mode === 'remove') {
        if (previousQty < qty) {
          throw new Error(`Cannot remove ${qty} units - only ${previousQty} currently on hand.`);
        }
        newQty = previousQty - qty;
        const deduction = await (client as any).warehouseStock.updateMany({
          where: { warehouseId, itemId, quantityOnHand: { gte: qty } },
          data: { quantityOnHand: { decrement: qty } },
        });
        if (deduction.count === 0) {
          throw new Error('Stock changed concurrently - please retry.');
        }
      } else {
        // 'set': an authoritative correction to the true, physically-counted
        // quantity - intentionally overwrites whatever was there rather than
        // being guarded against concurrent changes, since a manual recount
        // is meant to be the new source of truth.
        newQty = qty;
        await (client as any).warehouseStock.upsert({
          where: { warehouseId_itemId: { warehouseId, itemId } },
          update: { quantityOnHand: newQty },
          create: { tenantId, warehouseId, itemId, quantityOnHand: newQty },
        });
      }

      const adjustment = await (client as any).stockAdjustment.create({
        data: {
          tenantId,
          warehouseId,
          itemId,
          mode,
          previousQty,
          newQty,
          delta: newQty - previousQty,
          reason: String(reason).trim(),
          adjustedByName,
        },
      });

      return { adjustment, warehouse, item, newQty };
    });

    res.status(201).json({
      success: true,
      message: `Stock adjusted: ${result.item.name} in ${result.warehouse.name} is now ${result.newQty} ${result.item.unitOfMeasure}.`,
      data: { adjustment: result.adjustment },
    });
  } catch (error: any) {
    console.error('[Inventory] Error adjusting stock:', error);
    if (error.message === 'Warehouse or item not found.') {
      res.status(404).json({ success: false, error: error.message });
      return;
    }
    if (error instanceof WarehouseAccessError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
      return;
    }
    res.status(400).json({ success: false, error: error.message || 'Failed to adjust stock.' });
  }
});

/**
 * GET /api/v1/inventory/adjustments
 * Lists stock adjustment history (most recent first), optionally filtered
 * to a single item and/or warehouse, so a business can see exactly who
 * corrected what, when, and why.
 */
router.get('/adjustments', async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const { itemId, warehouseId, page = '1', limit = '20' } = req.query;

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(100, Math.max(1, Number(limit) || 20));

    const adjustments = await withCurrentTenantDb(prisma, async (client) => {
      const where: any = { tenantId };
      if (itemId) where.itemId = itemId;

      if (warehouseId) {
        await assertWarehouseAccess(client, tenantId, req.user!.id, req.user!.role, warehouseId as string);
        where.warehouseId = warehouseId;
      } else {
        const accessibleIds = await getAccessibleWarehouseIds(client, tenantId, req.user!.id, req.user!.role);
        if (accessibleIds !== null) where.warehouseId = { in: accessibleIds };
      }

      return (client as any).stockAdjustment.findMany({
        where,
        include: { item: true, warehouse: true },
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      });
    });

    res.status(200).json({ success: true, data: { adjustments, page: pageNum, limit: limitNum } });
  } catch (error: any) {
    console.error('[Inventory] Error fetching stock adjustments:', error);
    if (error instanceof WarehouseAccessError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to retrieve stock adjustment history.' });
  }
});

export default router;
