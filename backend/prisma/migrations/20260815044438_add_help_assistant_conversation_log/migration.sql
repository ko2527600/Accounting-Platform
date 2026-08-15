-- CreateTable
CREATE TABLE "help_assistant_conversations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "user_email" TEXT NOT NULL,
    "user_message" TEXT NOT NULL,
    "assistant_reply" TEXT NOT NULL,
    "tools_used" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "flag_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "help_assistant_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "help_assistant_conversations_tenant_id_created_at_idx" ON "help_assistant_conversations"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "help_assistant_conversations_tenant_id_flagged_idx" ON "help_assistant_conversations"("tenant_id", "flagged");
