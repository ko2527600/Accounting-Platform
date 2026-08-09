export interface ReceivingLineInput {
  itemId: string;
  quantity: number;
  unitCost: number;
}

export interface ReceivingLineResult {
  itemId: string;
  quantity: number;
  unitCost: number;
  previousCostPrice: number;
  newCostPrice: number;
  previousQtyOnHand: number;
  newQtyOnHand: number;
}

/**
 * Receives a vendor bill's line items into a warehouse: increments physical
 * stock and recomputes each item's cost as a moving (weighted) average -
 * `newCost = (existingQty*existingCost + receivedQty*receivedUnitCost) / (existingQty+receivedQty)`.
 *
 * This is a simplification, not true lot/batch costing (which this codebase
 * has no infrastructure for - InventoryItem.costPrice is a single blended
 * figure, not tracked per-shipment). It's the same tradeoff every "small
 * business" accounting tool in this space makes; real per-lot costing would
 * be a materially larger, separate feature.
 */
export async function receiveInventoryForBill(
  client: any,
  tenantId: string,
  warehouseId: string,
  lines: ReceivingLineInput[]
): Promise<ReceivingLineResult[]> {
  const results: ReceivingLineResult[] = [];

  for (const line of lines) {
    const item = await client.inventoryItem.findFirst({ where: { id: line.itemId, tenantId } });
    if (!item) {
      throw new Error(`Inventory item ${line.itemId} not found.`);
    }

    const existingStock = await client.warehouseStock.findUnique({
      where: { warehouseId_itemId: { warehouseId, itemId: line.itemId } },
    });
    const previousQtyOnHand = existingStock?.quantityOnHand || 0;
    const previousCostPrice = Number(item.costPrice);

    const newQtyOnHand = previousQtyOnHand + line.quantity;
    const newCostPrice =
      (previousQtyOnHand * previousCostPrice + line.quantity * line.unitCost) / newQtyOnHand;

    await client.warehouseStock.upsert({
      where: { warehouseId_itemId: { warehouseId, itemId: line.itemId } },
      update: { quantityOnHand: { increment: line.quantity } },
      create: { tenantId, warehouseId, itemId: line.itemId, quantityOnHand: line.quantity },
    });

    await client.inventoryItem.update({
      where: { id: line.itemId },
      data: { costPrice: newCostPrice },
    });

    results.push({
      itemId: line.itemId,
      quantity: line.quantity,
      unitCost: line.unitCost,
      previousCostPrice,
      newCostPrice,
      previousQtyOnHand,
      newQtyOnHand,
    });
  }

  return results;
}

export interface LandedCostLineResult {
  itemId: string;
  originalLineQuantity: number;
  allocatedAmount: number;
  additionalUnitCost: number;
  currentQtyOnHand: number;
  previousCostPrice: number;
  newCostPrice: number;
  skippedReason?: string;
}

/**
 * Spreads a secondary cost (freight, customs, duty) across a primary
 * purchase bill's line items, proportional to each line's original share of
 * the primary bill's subtotal, and blends the resulting per-unit cost
 * increase into each item's current moving-average cost.
 *
 * Because there's no lot/batch tracking, the blend is approximated against
 * whatever quantity from that shipment is still on hand (min of the
 * original line quantity and current stock) - if none of that shipment's
 * stock remains, the line is skipped (nothing left to revalue) and flagged
 * in the result rather than silently doing nothing.
 */
export async function allocateLandedCostToBill(
  client: any,
  tenantId: string,
  primaryBillId: string,
  landedCostAmount: number
): Promise<LandedCostLineResult[]> {
  const primaryBill = await client.vendorBill.findFirst({
    where: { id: primaryBillId, tenantId },
    include: { lines: true },
  });

  if (!primaryBill) {
    throw new Error('Primary bill not found.');
  }
  if (primaryBill.billType === 'LANDED_COST') {
    throw new Error('Cannot allocate a landed cost against another landed-cost bill.');
  }
  if (!primaryBill.lines || primaryBill.lines.length === 0) {
    throw new Error('This bill has no line items to allocate a landed cost against - only itemized purchase bills can receive a landed cost.');
  }
  if (!primaryBill.warehouseId) {
    throw new Error('Primary bill has no associated warehouse.');
  }

  const primarySubtotal = primaryBill.lines.reduce((sum: number, l: any) => sum + Number(l.lineTotal), 0);
  if (primarySubtotal <= 0) {
    throw new Error('Primary bill subtotal must be greater than zero to allocate costs proportionally.');
  }

  const results: LandedCostLineResult[] = [];

  for (const line of primaryBill.lines) {
    const shareRatio = Number(line.lineTotal) / primarySubtotal;
    const allocatedAmount = landedCostAmount * shareRatio;
    const additionalUnitCost = allocatedAmount / line.quantity;

    const stock = await client.warehouseStock.findUnique({
      where: { warehouseId_itemId: { warehouseId: primaryBill.warehouseId, itemId: line.itemId } },
    });
    const currentQtyOnHand = stock?.quantityOnHand || 0;

    const item = await client.inventoryItem.findFirst({ where: { id: line.itemId, tenantId } });
    const previousCostPrice = Number(item.costPrice);

    if (currentQtyOnHand === 0) {
      results.push({
        itemId: line.itemId,
        originalLineQuantity: line.quantity,
        allocatedAmount,
        additionalUnitCost,
        currentQtyOnHand,
        previousCostPrice,
        newCostPrice: previousCostPrice,
        skippedReason: 'None of this shipment\'s stock remains on hand - nothing to revalue.',
      });
      continue;
    }

    const effectiveQtyForBlend = Math.min(line.quantity, currentQtyOnHand);
    const newCostPrice =
      previousCostPrice + (additionalUnitCost * effectiveQtyForBlend) / currentQtyOnHand;

    await client.inventoryItem.update({
      where: { id: line.itemId },
      data: { costPrice: newCostPrice },
    });

    results.push({
      itemId: line.itemId,
      originalLineQuantity: line.quantity,
      allocatedAmount,
      additionalUnitCost,
      currentQtyOnHand,
      previousCostPrice,
      newCostPrice,
    });
  }

  await client.vendorBill.update({
    where: { id: primaryBillId },
    data: { landedCostAppliedAt: new Date() },
  });

  return results;
}
