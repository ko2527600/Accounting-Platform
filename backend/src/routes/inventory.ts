import { Router, Request, Response } from 'express';
import { prisma } from '../config/db';
import { withCurrentTenantDb } from '../database/tenantClient';
import { authenticateJwt } from '../middleware/authMiddleware';
import { tenantContextMiddleware } from '../middleware/tenantContextMiddleware';
import { requireRole } from '../middleware/rbacMiddleware';
import { requireTenantContext } from '../context/tenantContext';

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
      return (client as any).warehouse.findMany({
        where: { tenantId },
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
      return (client as any).inventoryItem.findMany({
        where: { tenantId },
        include: { warehouseStocks: { include: { warehouse: true } } },
        orderBy: { name: 'asc' },
      });
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
    res.status(500).json({ success: false, error: 'Failed to create inventory item.' });
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
    res.status(500).json({ success: false, error: error.message || 'Failed to execute stock transfer.' });
  }
});

export default router;
