import cron, { ScheduledTask } from 'node-cron';
import { prisma } from '../config/db';
import * as recurringTransactionRepository from '../repository/recurringTransactionRepository';
import { RecurringTransactionRecord, RecurrenceFrequency, CreateRecurringTransactionData } from '../repository/recurringTransactionRepository';
import { runWithTenantContext } from '../context/tenantContext';
import * as journalEntryService from './journalEntryService';

export class RecurringTransactionServiceError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number = 400) {
    super(message);
    this.name = 'RecurringTransactionServiceError';
    this.statusCode = statusCode;
  }
}

const VALID_FREQUENCIES: RecurrenceFrequency[] = ['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'];

export function advanceDate(date: Date, frequency: RecurrenceFrequency): Date {
  const next = new Date(date);
  switch (frequency) {
    case 'DAILY':
      next.setUTCDate(next.getUTCDate() + 1);
      break;
    case 'WEEKLY':
      next.setUTCDate(next.getUTCDate() + 7);
      break;
    case 'MONTHLY':
      next.setUTCMonth(next.getUTCMonth() + 1);
      break;
    case 'QUARTERLY':
      next.setUTCMonth(next.getUTCMonth() + 3);
      break;
    case 'YEARLY':
      next.setUTCFullYear(next.getUTCFullYear() + 1);
      break;
  }
  return next;
}

function validateTemplateData(templateData: any): void {
  if (!templateData || typeof templateData !== 'object') {
    throw new RecurringTransactionServiceError('templateData is required and must be an object.', 400);
  }
  if (!Array.isArray(templateData.lines) || templateData.lines.length < 2) {
    throw new RecurringTransactionServiceError('templateData.lines must contain at least 2 journal entry lines.', 400);
  }
  for (const line of templateData.lines) {
    if (!line.accountId || typeof line.accountId !== 'string') {
      throw new RecurringTransactionServiceError('Each templateData line requires an accountId.', 400);
    }
  }
}

export async function listRecurringTransactions(tenantId: string): Promise<RecurringTransactionRecord[]> {
  return recurringTransactionRepository.listRecurringTransactions(prisma, tenantId);
}

export async function getRecurringTransactionById(tenantId: string, id: string): Promise<RecurringTransactionRecord | null> {
  return recurringTransactionRepository.getRecurringTransactionById(prisma, tenantId, id);
}

export async function createRecurringTransaction(tenantId: string, input: any): Promise<RecurringTransactionRecord> {
  const { name, description, frequency, startDate, endDate, templateData, isActive } = input;

  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new RecurringTransactionServiceError('name is required.', 400);
  }
  if (!VALID_FREQUENCIES.includes(frequency)) {
    throw new RecurringTransactionServiceError(`Invalid frequency "${frequency}". Allowed: ${VALID_FREQUENCIES.join(', ')}`, 400);
  }
  if (!startDate) {
    throw new RecurringTransactionServiceError('startDate is required.', 400);
  }
  const start = new Date(startDate);
  if (isNaN(start.getTime())) {
    throw new RecurringTransactionServiceError('startDate must be a valid date.', 400);
  }
  let end: Date | null = null;
  if (endDate) {
    end = new Date(endDate);
    if (isNaN(end.getTime()) || end <= start) {
      throw new RecurringTransactionServiceError('endDate must be a valid date after startDate.', 400);
    }
  }
  validateTemplateData(templateData);

  const data: CreateRecurringTransactionData = {
    name,
    description,
    frequency,
    startDate: start,
    endDate: end,
    templateData,
    isActive,
  };

  return recurringTransactionRepository.createRecurringTransaction(prisma, tenantId, data);
}

export async function updateRecurringTransaction(tenantId: string, id: string, input: any): Promise<RecurringTransactionRecord> {
  if (input.templateData !== undefined) {
    validateTemplateData(input.templateData);
  }
  if (input.frequency !== undefined && !VALID_FREQUENCIES.includes(input.frequency)) {
    throw new RecurringTransactionServiceError(`Invalid frequency "${input.frequency}". Allowed: ${VALID_FREQUENCIES.join(', ')}`, 400);
  }

  const updated = await recurringTransactionRepository.updateRecurringTransaction(prisma, tenantId, id, {
    ...input,
    endDate: input.endDate !== undefined ? new Date(input.endDate) : undefined,
  });
  if (!updated) {
    throw new RecurringTransactionServiceError(`Recurring transaction with ID "${id}" not found.`, 404);
  }
  return updated;
}

export async function deleteRecurringTransaction(tenantId: string, id: string): Promise<void> {
  const deleted = await recurringTransactionRepository.deleteRecurringTransaction(prisma, tenantId, id);
  if (!deleted) {
    throw new RecurringTransactionServiceError(`Recurring transaction with ID "${id}" not found.`, 404);
  }
}

export class RecurringTransactionCronService {
  private static task: ScheduledTask | null = null;

  /**
   * Hourly sweep, mirroring ScheduledEmailCronService's shape: checks every
   * active RecurringTransaction across all tenants for whether it's due,
   * and stamps out a real journal entry from its template.
   */
  public static init(): void {
    if (this.task) return;

    this.task = cron.schedule('0 * * * *', async () => {
      console.log('[RecurringTransactionCron] Executing hourly due-recurring-transactions sweep...');
      await this.runDueTransactionsJob();
    });

    console.log('[RecurringTransactionCron] Hourly Recurring Transactions Cron Job Initialized.');
  }

  /**
   * Runs with no active HTTP/tenant request context, so tenant context must
   * be established manually per row via runWithTenantContext before calling
   * journalEntryService (which requires it internally).
   */
  public static async runDueTransactionsJob(): Promise<void> {
    try {
      const now = new Date();
      const due = await recurringTransactionRepository.findDueRecurringTransactions(prisma, now);

      for (const rt of due) {
        try {
          const tenant = await prisma.tenant.findUnique({ where: { id: rt.tenantId } });
          if (!tenant) {
            continue;
          }

          if (rt.endDate && rt.nextRun > rt.endDate) {
            await recurringTransactionRepository.deactivate(prisma, rt.id);
            continue;
          }

          await runWithTenantContext(
            { tenantId: tenant.id, tenantSchema: tenant.schema, tenantName: tenant.name, tenantSlug: tenant.slug },
            async () => {
              const template = rt.templateData as any;
              await journalEntryService.createJournalEntry({
                description: template.description || rt.name,
                status: 'POSTED',
                lines: template.lines,
              });
            }
          );

          const nextRun = advanceDate(rt.nextRun, rt.frequency);
          await recurringTransactionRepository.markRun(prisma, rt.id, now, nextRun);
        } catch (rowErr: any) {
          // Leave nextRun unchanged on failure so it retries next sweep rather
          // than silently skipping a cycle - logged so a bad template gets noticed.
          console.error(`[RecurringTransactionCron] Error generating transaction for row ${rt.id}:`, rowErr);
        }
      }
    } catch (err: any) {
      console.error('[RecurringTransactionCron] Error running due-transactions job:', err);
    }
  }

  public static stop(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
    }
  }
}
