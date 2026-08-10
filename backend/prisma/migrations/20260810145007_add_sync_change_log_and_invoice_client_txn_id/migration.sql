-- CreateEnum
CREATE TYPE "SyncOperation" AS ENUM ('CREATE', 'UPDATE', 'DELETE');

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "client_txn_id" TEXT;

-- CreateTable
CREATE TABLE "sync_change_log" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "operation" "SyncOperation" NOT NULL,
    "payload" JSONB,
    "sequence" BIGINT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_change_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_sequence_counters" (
    "tenant_id" TEXT NOT NULL,
    "value" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "sync_sequence_counters_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateIndex
CREATE INDEX "sync_change_log_tenant_id_entity_type_idx" ON "sync_change_log"("tenant_id", "entity_type");

-- CreateIndex
CREATE UNIQUE INDEX "sync_change_log_tenant_id_sequence_key" ON "sync_change_log"("tenant_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_tenant_id_client_txn_id_key" ON "invoices"("tenant_id", "client_txn_id");
