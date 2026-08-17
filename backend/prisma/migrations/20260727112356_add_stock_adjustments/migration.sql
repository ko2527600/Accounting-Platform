-- StockAdjustment: audit-trailed manual corrections to an item's warehouse
-- quantity - covers both restocking an existing item (mode='add') and
-- fixing a mistaken over/under-entry (mode='remove'/'set'), since both are
-- the same underlying action: manually correct quantityOnHand with a
-- required reason and a permanent record of who did it and when.
CREATE TABLE "stock_adjustments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "previous_qty" INTEGER NOT NULL,
    "new_qty" INTEGER NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "adjusted_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_adjustments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "stock_adjustments_tenant_id_idx" ON "stock_adjustments"("tenant_id");

CREATE INDEX "stock_adjustments_item_id_idx" ON "stock_adjustments"("item_id");

CREATE INDEX "stock_adjustments_warehouse_id_idx" ON "stock_adjustments"("warehouse_id");

ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
