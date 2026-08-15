import cron, { ScheduledTask } from 'node-cron';
import { prisma } from '../config/db';
import { pruneConversationsOlderThan } from '../repository/helpAssistantConversationRepository';

// How long a Help Assistant conversation log is kept before this job deletes
// it. The "human reviews flagged turns, then updates helpAssistantKnowledge.ts
// (or doesn't)" loop these logs exist for happens well within this window -
// keeping raw chat transcripts indefinitely would be pure unbounded growth
// for zero further benefit, and for chat content specifically, an unbounded
// retention window is its own risk.
const RETENTION_DAYS = 90;

/**
 * Daily housekeeping for the Help Assistant conversation log
 * (help_assistant_conversations) - the raw material a human reviews via
 * GET /help-assistant/conversations to decide whether
 * helpAssistantKnowledge.ts needs updating. This job only enforces the
 * retention window; it never reads conversation content or changes
 * assistant behavior itself - there is no autonomous "the AI edits its own
 * knowledge base" step anywhere in this system.
 */
export class HelpAssistantMaintenanceCronService {
  private static task: ScheduledTask | null = null;

  public static init(): void {
    if (this.task) return;

    // Once daily at 3am UTC - an off-hours slot, matching the "off-peak
    // batch job" timing other daily crons in this codebase use.
    this.task = cron.schedule('0 3 * * *', async () => {
      console.log('[HelpAssistantMaintenanceCron] Executing daily conversation-log retention sweep...');
      await this.runRetentionJob();
    });

    console.log('[HelpAssistantMaintenanceCron] Daily Help Assistant Maintenance Cron Job Initialized.');
  }

  public static async runRetentionJob(): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
      const deleted = await pruneConversationsOlderThan(prisma, cutoff);
      if (deleted > 0) {
        console.log(`[HelpAssistantMaintenanceCron] Pruned ${deleted} Help Assistant conversation log(s) older than ${RETENTION_DAYS} days.`);
      }
    } catch (err: any) {
      console.error('[HelpAssistantMaintenanceCron] Error running retention job:', err);
    }
  }

  public static stop(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
    }
  }
}
