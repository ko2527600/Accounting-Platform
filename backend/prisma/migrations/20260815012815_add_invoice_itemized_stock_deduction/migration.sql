-- AlterTable
ALTER TABLE "invoice_items" ADD COLUMN     "inventory_item_id" TEXT;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "stock_deducted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "warehouse_id" TEXT;

-- CreateIndex
CREATE INDEX "invoice_items_inventory_item_id_idx" ON "invoice_items"("inventory_item_id");

-- CreateIndex
CREATE INDEX "invoices_warehouse_id_idx" ON "invoices"("warehouse_id");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
