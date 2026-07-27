export type StockAdjustmentMode = 'add' | 'remove' | 'set';

export interface ApplyStockAdjustmentInput {
  tenantId: string;
  warehouseId: string;
  itemId: string;
  mode: StockAdjustmentMode;
  quantity: number;
  reason: string;
  adjustedByName?: string;
}

export interface ApplyStockAdjustmentResult {
  adjustment: any;
  previousQty: number;
  newQty: number;
}

/**
 * Applies a single-item stock correction (restock, deduction, or an
 * authoritative recount) and records it as a StockAdjustment row. Shared by
 * the single-item adjustment route and the stock-take reconciliation route -
 * callers are responsible for warehouse/item existence checks and warehouse
 * access authorization before calling this.
 */
export async function applyStockAdjustment(
  client: any,
  input: ApplyStockAdjustmentInput
): Promise<ApplyStockAdjustmentResult> {
  const { tenantId, warehouseId, itemId, mode, quantity: qty, reason, adjustedByName } = input;

  const existingStock = await client.warehouseStock.findUnique({
    where: { warehouseId_itemId: { warehouseId, itemId } },
  });
  const previousQty = existingStock?.quantityOnHand || 0;

  let newQty: number;
  if (mode === 'add') {
    newQty = previousQty + qty;
    await client.warehouseStock.upsert({
      where: { warehouseId_itemId: { warehouseId, itemId } },
      update: { quantityOnHand: { increment: qty } },
      create: { tenantId, warehouseId, itemId, quantityOnHand: qty },
    });
  } else if (mode === 'remove') {
    if (previousQty < qty) {
      throw new Error(`Cannot remove ${qty} units - only ${previousQty} currently on hand.`);
    }
    newQty = previousQty - qty;
    const deduction = await client.warehouseStock.updateMany({
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
    await client.warehouseStock.upsert({
      where: { warehouseId_itemId: { warehouseId, itemId } },
      update: { quantityOnHand: newQty },
      create: { tenantId, warehouseId, itemId, quantityOnHand: newQty },
    });
  }

  const adjustment = await client.stockAdjustment.create({
    data: {
      tenantId,
      warehouseId,
      itemId,
      mode,
      previousQty,
      newQty,
      delta: newQty - previousQty,
      reason: String(reason).trim(),
      adjustedByName: adjustedByName || 'Unknown',
    },
  });

  return { adjustment, previousQty, newQty };
}
