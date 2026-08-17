-- AlterTable
ALTER TABLE "vendor_bills" ADD COLUMN     "bill_type" TEXT NOT NULL DEFAULT 'STANDARD',
ADD COLUMN     "landed_cost_applied_at" TIMESTAMP(3),
ADD COLUMN     "landed_cost_for_bill_id" TEXT,
ADD COLUMN     "warehouse_id" TEXT;

-- CreateTable
CREATE TABLE "vendor_bill_lines" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "bill_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_cost" DECIMAL(15,2) NOT NULL,
    "line_total" DECIMAL(15,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_bill_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vendor_bill_lines_tenant_id_idx" ON "vendor_bill_lines"("tenant_id");

-- CreateIndex
CREATE INDEX "vendor_bill_lines_bill_id_idx" ON "vendor_bill_lines"("bill_id");

-- CreateIndex
CREATE INDEX "vendor_bill_lines_item_id_idx" ON "vendor_bill_lines"("item_id");

-- CreateIndex
CREATE INDEX "vendor_bills_warehouse_id_idx" ON "vendor_bills"("warehouse_id");

-- CreateIndex
CREATE INDEX "vendor_bills_landed_cost_for_bill_id_idx" ON "vendor_bills"("landed_cost_for_bill_id");

-- AddForeignKey
ALTER TABLE "vendor_bills" ADD CONSTRAINT "vendor_bills_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_bills" ADD CONSTRAINT "vendor_bills_landed_cost_for_bill_id_fkey" FOREIGN KEY ("landed_cost_for_bill_id") REFERENCES "vendor_bills"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_bill_lines" ADD CONSTRAINT "vendor_bill_lines_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "vendor_bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_bill_lines" ADD CONSTRAINT "vendor_bill_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
