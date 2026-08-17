-- CreateTable
CREATE TABLE "expense_claims" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "claim_number" TEXT NOT NULL,
    "submitted_by" TEXT NOT NULL,
    "submitted_by_name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "expense_date" TIMESTAMP(3) NOT NULL,
    "expense_account_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    "approval_workflow_id" TEXT,
    "journal_id" TEXT,
    "reimbursed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expense_claims_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "expense_claims_tenant_id_idx" ON "expense_claims"("tenant_id");

-- CreateIndex
CREATE INDEX "expense_claims_status_idx" ON "expense_claims"("status");

-- CreateIndex
CREATE INDEX "expense_claims_submitted_by_idx" ON "expense_claims"("submitted_by");

-- CreateIndex
CREATE UNIQUE INDEX "expense_claims_tenant_id_claim_number_key" ON "expense_claims"("tenant_id", "claim_number");
