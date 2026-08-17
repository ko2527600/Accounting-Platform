-- Location-scoped permissions: a user with role 'Shop Manager' or 'Cashier'
-- is restricted to only the warehouses they have a WarehouseAccess row for.
-- All other roles (Admin, Accountant, Auditor, Viewer, or any other legacy
-- free-text title) are unaffected - this is purely additive.
ALTER TABLE "invitations" ADD COLUMN "warehouse_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "warehouse_access" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warehouse_access_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "warehouse_access_tenant_id_idx" ON "warehouse_access"("tenant_id");

CREATE INDEX "warehouse_access_user_id_idx" ON "warehouse_access"("user_id");

CREATE INDEX "warehouse_access_warehouse_id_idx" ON "warehouse_access"("warehouse_id");

CREATE UNIQUE INDEX "warehouse_access_user_id_warehouse_id_key" ON "warehouse_access"("user_id", "warehouse_id");

ALTER TABLE "warehouse_access" ADD CONSTRAINT "warehouse_access_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "warehouse_access" ADD CONSTRAINT "warehouse_access_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
