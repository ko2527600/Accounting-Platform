-- CreateTable
CREATE TABLE "report_schedules" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "frequency" TEXT NOT NULL DEFAULT 'Weekly',
    "day_of_week" INTEGER NOT NULL DEFAULT 1,
    "hour_utc" INTEGER NOT NULL DEFAULT 8,
    "report_type" TEXT NOT NULL DEFAULT 'ProfitAndLoss',
    "recipients" TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "report_schedules_tenant_id_key" ON "report_schedules"("tenant_id");

-- CreateIndex
CREATE INDEX "report_schedules_tenant_id_idx" ON "report_schedules"("tenant_id");
