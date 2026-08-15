import { prisma } from '../config/db';
import { withCurrentTenantDb } from '../database/tenantClient';

export class PurchaseOrderServiceError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number = 400) {
    super(message);
    this.name = 'PurchaseOrderServiceError';
    this.statusCode = statusCode;
  }
}

export interface PurchaseOrderLineInput {
  itemId: string;
  description?: string;
  quantity: number;
  unitCost: number;
}

export interface CreatePurchaseOrderInput {
  tenantId: string;
  vendorId: string;
  expectedDate?: string | Date;
  currency?: string;
  warehouseId?: string;
  notes?: string;
  lines: PurchaseOrderLineInput[];
}

function validateLines(lines: PurchaseOrderLineInput[]): void {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new PurchaseOrderServiceError('At least one line item is required.', 400);
  }
  for (const line of lines) {
    if (!line.itemId || typeof line.itemId !== 'string') {
      throw new PurchaseOrderServiceError('Every line requires an item ID.', 400);
    }
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new PurchaseOrderServiceError(`Invalid quantity for item ${line.itemId} - must be a whole number greater than zero.`, 400);
    }
    if (typeof line.unitCost !== 'number' || line.unitCost < 0) {
      throw new PurchaseOrderServiceError(`Invalid unit cost for item ${line.itemId}.`, 400);
    }
  }
}

export async function createPurchaseOrder(input: CreatePurchaseOrderInput) {
  if (!input.vendorId) {
    throw new PurchaseOrderServiceError('A vendor is required.', 400);
  }
  validateLines(input.lines);

  const poNumber = `PO-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

  return withCurrentTenantDb(prisma, async (client) => {
    const vendor = await (client as any).vendor.findFirst({ where: { id: input.vendorId, tenantId: input.tenantId } });
    if (!vendor) {
      throw new PurchaseOrderServiceError('Vendor not found.', 404);
    }
    if (input.warehouseId) {
      const warehouse = await (client as any).warehouse.findFirst({ where: { id: input.warehouseId, tenantId: input.tenantId } });
      if (!warehouse) {
        throw new PurchaseOrderServiceError('Warehouse not found.', 404);
      }
    }
    for (const line of input.lines) {
      const item = await (client as any).inventoryItem.findFirst({ where: { id: line.itemId, tenantId: input.tenantId } });
      if (!item) {
        throw new PurchaseOrderServiceError(`Inventory item ${line.itemId} not found.`, 404);
      }
    }

    return (client as any).purchaseOrder.create({
      data: {
        tenantId: input.tenantId,
        poNumber,
        vendorId: input.vendorId,
        expectedDate: input.expectedDate ? new Date(input.expectedDate) : null,
        currency: input.currency || 'USD',
        warehouseId: input.warehouseId || null,
        notes: input.notes || null,
        status: 'DRAFT',
        lines: {
          create: input.lines.map((l) => ({
            tenantId: input.tenantId,
            itemId: l.itemId,
            description: l.description || null,
            quantity: l.quantity,
            unitCost: l.unitCost,
          })),
        },
      },
      include: { vendor: true, warehouse: true, lines: { include: { item: true } } },
    });
  });
}

export async function listPurchaseOrders(tenantId: string) {
  return withCurrentTenantDb(prisma, async (client) => {
    return (client as any).purchaseOrder.findMany({
      where: { tenantId },
      include: { vendor: true, warehouse: true, lines: { include: { item: true } }, bills: { select: { id: true, billNumber: true } } },
      orderBy: { createdAt: 'desc' },
    });
  });
}

export async function getPurchaseOrderById(tenantId: string, id: string) {
  return withCurrentTenantDb(prisma, async (client) => {
    return (client as any).purchaseOrder.findFirst({
      where: { id, tenantId },
      include: { vendor: true, warehouse: true, lines: { include: { item: true } }, bills: { select: { id: true, billNumber: true, amount: true } } },
    });
  });
}

export async function updatePurchaseOrderStatus(tenantId: string, id: string, status: string) {
  const VALID_STATUSES = ['DRAFT', 'SENT', 'BILLED', 'CANCELLED'];
  if (!VALID_STATUSES.includes(status)) {
    throw new PurchaseOrderServiceError(`Invalid status "${status}". Allowed: ${VALID_STATUSES.join(', ')}`, 400);
  }
  return withCurrentTenantDb(prisma, async (client) => {
    const existing = await (client as any).purchaseOrder.findFirst({ where: { id, tenantId } });
    if (!existing) {
      throw new PurchaseOrderServiceError('Purchase Order not found.', 404);
    }
    return (client as any).purchaseOrder.update({ where: { id }, data: { status } });
  });
}

export interface ReorderGenerationResult {
  created: any[];
  skippedNoVendor: { itemId: string; itemName: string; sku: string }[];
}

/**
 * On-demand (not a background cron - a business owner should decide when to
 * commit to reorder spend, not have DRAFT POs appear silently every day)
 * generation of DRAFT Purchase Orders for every item in one warehouse whose
 * stock has fallen to or below its reorderLevel. Groups items by
 * preferredVendorId so a vendor with multiple low-stock items gets ONE PO,
 * not one per item. Orders enough to bring quantityOnHand back up to
 * reorderLevel (the threshold itself) - a simple, explainable restock
 * target, not a demand-forecast. Items with no preferredVendorId are
 * skipped and reported back, never guessed.
 */
export async function generateReorderPurchaseOrders(tenantId: string, warehouseId: string): Promise<ReorderGenerationResult> {
  return withCurrentTenantDb(prisma, async (client) => {
    const warehouse = await (client as any).warehouse.findFirst({ where: { id: warehouseId, tenantId } });
    if (!warehouse) {
      throw new PurchaseOrderServiceError('Warehouse not found.', 404);
    }

    const lowStock = await (client as any).warehouseStock.findMany({
      where: { tenantId, warehouseId },
      include: { item: true },
    });

    const belowReorder = lowStock.filter((s: any) => s.quantityOnHand <= s.item.reorderLevel);

    const byVendor = new Map<string, { itemId: string; itemName: string; sku: string; quantity: number; unitCost: number }[]>();
    const skippedNoVendor: { itemId: string; itemName: string; sku: string }[] = [];

    for (const stock of belowReorder) {
      const item = stock.item;
      if (!item.preferredVendorId) {
        skippedNoVendor.push({ itemId: item.id, itemName: item.name, sku: item.sku });
        continue;
      }
      const quantity = item.reorderLevel - stock.quantityOnHand;
      if (quantity <= 0) continue;
      const list = byVendor.get(item.preferredVendorId) || [];
      list.push({ itemId: item.id, itemName: item.name, sku: item.sku, quantity, unitCost: Number(item.costPrice) });
      byVendor.set(item.preferredVendorId, list);
    }

    const created: any[] = [];
    for (const [vendorId, lines] of byVendor.entries()) {
      const poNumber = `PO-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
      const po = await (client as any).purchaseOrder.create({
        data: {
          tenantId,
          poNumber,
          vendorId,
          warehouseId,
          status: 'DRAFT',
          notes: 'Auto-generated from low-stock reorder thresholds.',
          lines: {
            create: lines.map((l) => ({ tenantId, itemId: l.itemId, description: `Reorder: ${l.itemName}`, quantity: l.quantity, unitCost: l.unitCost })),
          },
        },
        include: { vendor: true, lines: { include: { item: true } } },
      });
      created.push(po);
    }

    return { created, skippedNoVendor };
  });
}

export interface PoVsBillLineVariance {
  itemId: string;
  itemName: string;
  orderedQuantity: number;
  orderedUnitCost: number;
  billedQuantity: number;
  billedUnitCost: number;
  quantityVariance: number;
  hasVariance: boolean;
}

/**
 * Lightweight rule-based matching (not a strict blocking 3-way match) - for
 * one PO and a set of bill lines being created/already created against it,
 * compares ordered vs. billed quantity/unit cost per item and flags any
 * difference. Purely informational; nothing here blocks a bill from being
 * created against a PO even with a variance - a human reviews the flag.
 */
export function computePoVsBillVariance(
  poLines: { itemId: string; itemName: string; quantity: number; unitCost: number }[],
  billLines: { itemId: string; quantity: number; unitCost: number }[]
): PoVsBillLineVariance[] {
  return poLines.map((poLine) => {
    const billed = billLines.filter((b) => b.itemId === poLine.itemId);
    const billedQuantity = billed.reduce((sum, b) => sum + b.quantity, 0);
    const billedUnitCost = billed.length > 0 ? billed[0].unitCost : 0;
    return {
      itemId: poLine.itemId,
      itemName: poLine.itemName,
      orderedQuantity: poLine.quantity,
      orderedUnitCost: Number(poLine.unitCost),
      billedQuantity,
      billedUnitCost,
      quantityVariance: billedQuantity - poLine.quantity,
      hasVariance: billedQuantity !== poLine.quantity || (billed.length > 0 && billedUnitCost !== Number(poLine.unitCost)),
    };
  });
}
