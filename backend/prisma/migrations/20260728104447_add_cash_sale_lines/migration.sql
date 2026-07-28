-- CreateTable
CREATE TABLE "cash_sale_lines" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "sale_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "item_name" TEXT NOT NULL,
    "item_sku" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(15,2) NOT NULL,
    "line_total" DECIMAL(15,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_sale_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cash_sale_lines_tenant_id_idx" ON "cash_sale_lines"("tenant_id");

-- CreateIndex
CREATE INDEX "cash_sale_lines_sale_id_idx" ON "cash_sale_lines"("sale_id");

-- AddForeignKey
ALTER TABLE "cash_sale_lines" ADD CONSTRAINT "cash_sale_lines_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "cash_sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;
