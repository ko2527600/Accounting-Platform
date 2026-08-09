import { PrismaClient } from '@prisma/client';

export interface ExpenseClaimRecord {
  id: string;
  tenantId: string;
  claimNumber: string;
  submittedBy: string;
  submittedByName: string;
  category: string;
  description: string;
  amount: any;
  currency: string;
  expenseDate: Date;
  expenseAccountId: string | null;
  status: string;
  approvalWorkflowId: string | null;
  journalId: string | null;
  reimbursedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateExpenseClaimData {
  claimNumber: string;
  submittedBy: string;
  submittedByName: string;
  category: string;
  description: string;
  amount: number;
  currency: string;
  expenseDate: Date;
  expenseAccountId: string | null;
}

export async function listExpenseClaims(
  prisma: PrismaClient,
  tenantId: string,
  filter?: { status?: string; submittedBy?: string }
): Promise<ExpenseClaimRecord[]> {
  const where: any = { tenantId };
  if (filter?.status) where.status = filter.status;
  if (filter?.submittedBy) where.submittedBy = filter.submittedBy;
  return (prisma as any).expenseClaim.findMany({ where, orderBy: { createdAt: 'desc' } });
}

export async function getExpenseClaimById(
  prisma: PrismaClient,
  tenantId: string,
  id: string
): Promise<ExpenseClaimRecord | null> {
  return (prisma as any).expenseClaim.findFirst({ where: { id, tenantId } });
}

export async function createExpenseClaim(
  prisma: PrismaClient,
  tenantId: string,
  data: CreateExpenseClaimData
): Promise<ExpenseClaimRecord> {
  return (prisma as any).expenseClaim.create({ data: { tenantId, ...data } });
}

export async function updateExpenseClaim(
  prisma: PrismaClient,
  id: string,
  data: Partial<{
    status: string;
    approvalWorkflowId: string | null;
    journalId: string | null;
    reimbursedAt: Date | null;
  }>
): Promise<ExpenseClaimRecord> {
  return (prisma as any).expenseClaim.update({ where: { id }, data });
}
