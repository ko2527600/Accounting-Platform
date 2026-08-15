import { PrismaClient } from '@prisma/client';

export interface HelpAssistantConversationRecord {
  id: string;
  tenantId: string;
  userId: string;
  userEmail: string;
  userMessage: string;
  assistantReply: string;
  toolsUsed: string[];
  flagged: boolean;
  flagReason: string | null;
  createdAt: Date;
}

export interface LogConversationInput {
  tenantId: string;
  userId: string;
  userEmail: string;
  userMessage: string;
  assistantReply: string;
  toolsUsed: string[];
  flagged: boolean;
  flagReason?: string | null;
}

/**
 * Logs one Help Assistant chat turn. Deliberately never throws - a logging
 * failure must never turn an otherwise-successful (or already-failed) chat
 * response into a 500 for the user. Callers should still await this so
 * tests (and the review screen) see the row immediately after the response.
 */
export async function logConversation(prisma: PrismaClient, input: LogConversationInput): Promise<void> {
  try {
    await prisma.helpAssistantConversation.create({
      data: {
        tenantId: input.tenantId,
        userId: input.userId,
        userEmail: input.userEmail,
        userMessage: input.userMessage,
        assistantReply: input.assistantReply,
        toolsUsed: input.toolsUsed,
        flagged: input.flagged,
        flagReason: input.flagReason ?? null,
      },
    });
  } catch (error) {
    console.error('[HelpAssistantConversationRepository] Failed to log conversation:', error);
  }
}

export interface ListConversationsOptions {
  flaggedOnly?: boolean;
  take?: number;
  skip?: number;
}

export async function listConversationsForTenant(
  prisma: PrismaClient,
  tenantId: string,
  options: ListConversationsOptions = {}
): Promise<{ conversations: HelpAssistantConversationRecord[]; total: number }> {
  const where = { tenantId, ...(options.flaggedOnly ? { flagged: true } : {}) };

  const [conversations, total] = await Promise.all([
    prisma.helpAssistantConversation.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: options.take ?? 50,
      skip: options.skip ?? 0,
    }),
    prisma.helpAssistantConversation.count({ where }),
  ]);

  return { conversations, total };
}

/**
 * Deletes every conversation log older than `cutoff`, across all tenants -
 * used by the daily retention cron (helpAssistantMaintenanceCronService.ts).
 * Returns the number of rows deleted.
 */
export async function pruneConversationsOlderThan(prisma: PrismaClient, cutoff: Date): Promise<number> {
  const result = await prisma.helpAssistantConversation.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return result.count;
}
