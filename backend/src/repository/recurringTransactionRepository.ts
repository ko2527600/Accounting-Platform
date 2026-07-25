import { PrismaClient } from '@prisma/client';

export type RecurrenceFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';

export interface RecurringTransactionRecord {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  frequency: RecurrenceFrequency;
  startDate: Date;
  endDate: Date | null;
  lastRun: Date | null;
  nextRun: Date;
  templateData: any;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateRecurringTransactionData {
  name: string;
  description?: string | null;
  frequency: RecurrenceFrequency;
  startDate: Date;
  endDate?: Date | null;
  templateData: any;
  isActive?: boolean;
}

export async function listRecurringTransactions(prisma: PrismaClient, tenantId: string): Promise<RecurringTransactionRecord[]> {
  return (prisma as any).recurringTransaction.findMany({ where: { tenantId }, orderBy: { nextRun: 'asc' } });
}

export async function getRecurringTransactionById(
  prisma: PrismaClient,
  tenantId: string,
  id: string
): Promise<RecurringTransactionRecord | null> {
  return (prisma as any).recurringTransaction.findFirst({ where: { id, tenantId } });
}

export async function createRecurringTransaction(
  prisma: PrismaClient,
  tenantId: string,
  data: CreateRecurringTransactionData
): Promise<RecurringTransactionRecord> {
  return (prisma as any).recurringTransaction.create({
    data: {
      tenantId,
      name: data.name.trim(),
      description: data.description ?? null,
      frequency: data.frequency,
      startDate: data.startDate,
      endDate: data.endDate ?? null,
      nextRun: data.startDate,
      templateData: data.templateData,
      isActive: data.isActive !== undefined ? data.isActive : true,
    },
  });
}

export async function updateRecurringTransaction(
  prisma: PrismaClient,
  tenantId: string,
  id: string,
  data: Partial<CreateRecurringTransactionData> & { isActive?: boolean }
): Promise<RecurringTransactionRecord | null> {
  const existing = await getRecurringTransactionById(prisma, tenantId, id);
  if (!existing) return null;

  return (prisma as any).recurringTransaction.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name.trim() } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.frequency !== undefined ? { frequency: data.frequency } : {}),
      ...(data.endDate !== undefined ? { endDate: data.endDate } : {}),
      ...(data.templateData !== undefined ? { templateData: data.templateData } : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
    },
  });
}

export async function deleteRecurringTransaction(prisma: PrismaClient, tenantId: string, id: string): Promise<boolean> {
  const existing = await getRecurringTransactionById(prisma, tenantId, id);
  if (!existing) return false;
  await (prisma as any).recurringTransaction.delete({ where: { id } });
  return true;
}

/**
 * Finds every active row due to run (nextRun <= now), across all tenants -
 * this powers the cron sweep, which has no per-tenant HTTP context to scope by.
 */
export async function findDueRecurringTransactions(prisma: PrismaClient, now: Date): Promise<RecurringTransactionRecord[]> {
  return (prisma as any).recurringTransaction.findMany({
    where: { isActive: true, nextRun: { lte: now } },
  });
}

export async function markRun(
  prisma: PrismaClient,
  id: string,
  lastRun: Date,
  nextRun: Date
): Promise<RecurringTransactionRecord> {
  return (prisma as any).recurringTransaction.update({
    where: { id },
    data: { lastRun, nextRun },
  });
}

export async function deactivate(prisma: PrismaClient, id: string): Promise<void> {
  await (prisma as any).recurringTransaction.update({ where: { id }, data: { isActive: false } });
}
