-- AlterTable
ALTER TABLE "inventory_items" ADD COLUMN     "preferred_vendor_id" TEXT;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_preferred_vendor_id_fkey" FOREIGN KEY ("preferred_vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
