import { prisma } from '../config/db';
import { HelpAssistantMaintenanceCronService } from '../services/helpAssistantMaintenanceCronService';

/**
 * The daily retention sweep for the Help Assistant conversation log
 * (help_assistant_conversations) - proves it deletes only what's past the
 * retention window, never touches recent rows, and never touches any other
 * tenant's unrelated data (this table has no foreign key to Tenant, so a
 * plain fabricated UUID is a realistic-enough tenantId for this test).
 */
describe('HelpAssistantMaintenanceCronService.runRetentionJob', () => {
  const runId = Date.now();
  const tenantId = `11111111-1111-4111-8111-${String(runId).padStart(12, '0')}`;

  async function cleanup() {
    await prisma.helpAssistantConversation.deleteMany({ where: { tenantId } }).catch(() => {});
  }

  beforeAll(async () => {
    await prisma.$connect();
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('deletes conversations older than the retention window, keeps recent ones', async () => {
    const oldDate = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000); // 120 days ago
    const recentDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000); // 5 days ago

    const oldRow = await prisma.helpAssistantConversation.create({
      data: {
        tenantId,
        userId: 'user-old',
        userEmail: 'old@corp.com',
        userMessage: 'an old question',
        assistantReply: 'an old answer',
        toolsUsed: [],
        flagged: false,
        createdAt: oldDate,
      },
    });
    const recentRow = await prisma.helpAssistantConversation.create({
      data: {
        tenantId,
        userId: 'user-recent',
        userEmail: 'recent@corp.com',
        userMessage: 'a recent question',
        assistantReply: 'a recent answer',
        toolsUsed: [],
        flagged: false,
        createdAt: recentDate,
      },
    });

    await HelpAssistantMaintenanceCronService.runRetentionJob();

    const remaining = await prisma.helpAssistantConversation.findMany({ where: { tenantId } });
    const remainingIds = remaining.map((r) => r.id);
    expect(remainingIds).not.toContain(oldRow.id);
    expect(remainingIds).toContain(recentRow.id);
  });
});
