-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "tenant_id" TEXT;

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_idx" ON "audit_logs"("tenant_id");
