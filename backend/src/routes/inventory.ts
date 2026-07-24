import { Router, Request, Response } from 'express';
import { prisma } from '../config/db';
import { withCurrentTenantDb } from '../database/tenantClient';
import { authenticateJwt } from '../middleware/authMiddleware';
import { tenantContextMiddleware } from '../middleware/tenantContextMiddleware';
import { requireRole } from '../middleware/rbacMiddleware';

const router = Router();

router.use(authenticateJwt);
router.use(tenantContextMiddleware);

/**
 * GET /api/v1/inventory/warehouses
 * Lists all warehouses / godowns with stock counts.
 */
router.get('/warehouses', async (req: Request, res: Response): Promise<void> => {
  try {
    const warehouses = await withCurrentTenantDb(prisma, async (client) => {
      return (client as any).warehouse.findMany({
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
    const { name, location, managerName, isPrimary } = req.body;
    if (!name || !name.trim()) {
      res.status(400).json({ success: false, error: 'Warehouse name is required.' });
      return;
    }

    const whCount = await withCurrentTenantDb(prisma, async (client) => (client as any).warehouse.count());
    const code = `WH-${String(whCount + 1).padStart(3, '0')}`;

    const created = await withCurrentTenantDb(prisma, async (client) => {
      return (client as any).warehouse.create({
        data: {
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
    const items = await withCurrentTenantDb(prisma, async (client) => {
      return (client as any).inventoryItem.findMany({
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
    const { name, sku, category = 'General', unitOfMeasure = 'pcs', costPrice, sellingPrice, initialWarehouseId, initialQty = 0 } = req.body;

    if (!name || !costPrice || !sellingPrice) {
      res.status(400).json({ success: false, error: 'Item name, cost price, and selling price are required.' });
      return;
    }

    const itemSku = sku ? sku.trim().toUpperCase() : `SKU-${Math.floor(1000 + Math.random() * 9000)}`;

    const createdItem = await withCurrentTenantDb(prisma, async (client) => {
      const item = await (client as any).inventoryItem.create({
        data: {
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
    res.status(500).json({ success: false, error: 'Failed to create inventory item.' });
  }
});

/**
 * POST /api/v1/inventory/transfers
 * Transfers stock items between two warehouses / godowns.
 */
router.post('/transfers', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
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
      // Check source stock
      const sourceStock = await (client as any).warehouseStock.findUnique({
        where: { warehouseId_itemId: { warehouseId: fromWarehouseId, itemId } },
      });

      if (!sourceStock || sourceStock.quantityOnHand < quantity) {
        throw new Error(`Insufficient stock in origin warehouse (Available: ${sourceStock?.quantityOnHand || 0} pcs).`);
      }

      // Deduct from source warehouse
      await (client as any).warehouseStock.update({
        where: { id: sourceStock.id },
        data: { quantityOnHand: sourceStock.quantityOnHand - Number(quantity) },
      });

      // Add to destination warehouse (upsert)
      const destStock = await (client as any).warehouseStock.findUnique({
        where: { warehouseId_itemId: { warehouseId: toWarehouseId, itemId } },
      });

      if (destStock) {
        await (client as any).warehouseStock.update({
          where: { id: destStock.id },
          data: { quantityOnHand: destStock.quantityOnHand + Number(quantity) },
        });
      } else {
        await (client as any).warehouseStock.create({
          data: { warehouseId: toWarehouseId, itemId, quantityOnHand: Number(quantity) },
        });
      }

      // Record Transfer Audit
      const count = await (client as any).stockTransfer.count();
      const transferNumber = `TRF-${String(count + 1001).padStart(5, '0')}`;

      return (client as any).stockTransfer.create({
        data: {
          transferNumber,
          fromWarehouseId,
          toWarehouseId,
          notes,
          items: {
            create: [{ itemId, quantity: Number(quantity) }],
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
    res.status(500).json({ success: false, error: error.message || 'Failed to execute stock transfer.' });
  }
});

export default router;
