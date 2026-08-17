-- CreateTable
CREATE TABLE "compliance_updates" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "verified_at" TIMESTAMP(3) NOT NULL,
    "verified_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_updates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "compliance_updates_verified_at_idx" ON "compliance_updates"("verified_at" DESC);

-- Seed the one real verification event this platform has already performed
-- and documented (see STATUS.md/TASKS.md, 2026-08-01): a primary-source check
-- of Ghana's VAT/NHIL/GETFund Levy rates directly against gra.gov.gh, which
-- is what TaxRate's "Use Ghana VAT Preset" and the layered levy breakdown
-- feature are built on. This is real project history, not placeholder data.
INSERT INTO "compliance_updates" ("id", "source", "area", "description", "verified_at", "verified_by", "created_at")
VALUES (
    gen_random_uuid()::text,
    'Ghana Revenue Authority (gra.gov.gh)',
    'VAT / NHIL / GETFund Levy rates',
    'Verified the flat 20% Ghana VAT rate against the primary source: 15% VAT + 2.5% NHIL + 2.5% GETFund Levy. Backs the "Use Ghana VAT Preset" default and the layered per-levy tax breakdown on invoices.',
    '2026-08-01T00:00:00Z',
    'Ledgio Engineering',
    now()
);
