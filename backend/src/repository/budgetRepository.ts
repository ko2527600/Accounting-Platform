import { PrismaClient } from '@prisma/client';

export interface BudgetRecord {
  id: string;
  tenantId: string;
  accountId: string;
  fiscalPeriodId: string;
  budgetAmount: string;
  actualAmount: string;
  variance: string;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateBudgetData {
  accountId: string;
  fiscalPeriodId: string;
  budgetAmount: number;
  notes?: string | null;
}

export async function listBudgets(prisma: PrismaClient, tenantId: string, fiscalPeriodId?: string): Promise<BudgetRecord[]> {
  return (prisma as any).budget.findMany({
    where: { tenantId, ...(fiscalPeriodId ? { fiscalPeriodId } : {}) },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getBudgetById(prisma: PrismaClient, tenantId: string, id: string): Promise<BudgetRecord | null> {
  return (prisma as any).budget.findFirst({ where: { id, tenantId } });
}

export async function getBudgetByAccountAndPeriod(
  prisma: PrismaClient,
  tenantId: string,
  accountId: string,
  fiscalPeriodId: string
): Promise<BudgetRecord | null> {
  return (prisma as any).budget.findFirst({ where: { tenantId, accountId, fiscalPeriodId } });
}

export async function createBudget(prisma: PrismaClient, tenantId: string, data: CreateBudgetData): Promise<BudgetRecord> {
  return (prisma as any).budget.create({
    data: {
      tenantId,
      accountId: data.accountId,
      fiscalPeriodId: data.fiscalPeriodId,
      budgetAmount: data.budgetAmount,
      notes: data.notes ?? null,
    },
  });
}

export async function updateBudgetAmount(
  prisma: PrismaClient,
  id: string,
  budgetAmount: number,
  notes?: string | null
): Promise<BudgetRecord> {
  return (prisma as any).budget.update({
    where: { id },
    data: { budgetAmount, ...(notes !== undefined ? { notes } : {}) },
  });
}

export async function setBudgetActuals(
  prisma: PrismaClient,
  id: string,
  actualAmount: number,
  variance: number
): Promise<BudgetRecord> {
  return (prisma as any).budget.update({
    where: { id },
    data: { actualAmount, variance },
  });
}

export async function deleteBudget(prisma: PrismaClient, tenantId: string, id: string): Promise<boolean> {
  const existing = await getBudgetById(prisma, tenantId, id);
  if (!existing) return false;
  await (prisma as any).budget.delete({ where: { id } });
  return true;
}
