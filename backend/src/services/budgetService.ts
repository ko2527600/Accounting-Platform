import { prisma } from '../config/db';
import { withCurrentTenantDb } from '../database/tenantClient';
import * as budgetRepository from '../repository/budgetRepository';
import * as fiscalPeriodRepository from '../repository/fiscalPeriodRepository';
import { BudgetRecord } from '../repository/budgetRepository';
import { recordAuditLogTx, diffFields, AuditActor } from './auditLogService';

export class BudgetServiceError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number = 400) {
    super(message);
    this.name = 'BudgetServiceError';
    this.statusCode = statusCode;
  }
}

async function recomputeActualsForBudgets(tenantId: string, budgets: BudgetRecord[]): Promise<BudgetRecord[]> {
  if (budgets.length === 0) return budgets;

  const periodIds = [...new Set(budgets.map((b) => b.fiscalPeriodId))];
  const periods = await Promise.all(
    periodIds.map((id) => fiscalPeriodRepository.getFiscalPeriodById(prisma, tenantId, id))
  );
  const periodById = new Map(periods.filter(Boolean).map((p) => [p!.id, p!]));

  const accountIds = [...new Set(budgets.map((b) => b.accountId))];

  // Ledger balances live in the tenant's own Postgres schema (accounts/ledgers),
  // not the shared public schema Budget lives in - sum real ledger activity
  // per account within each covering period's real date range.
  const netByAccount = await withCurrentTenantDb(prisma, async (client) => {
    const rows: any[] = await client.$queryRawUnsafe(
      `SELECT account_id, transaction_date, debit, credit
       FROM ledgers
       WHERE account_id = ANY($1::uuid[])`,
      accountIds
    );
    return rows;
  });

  const results: BudgetRecord[] = [];
  for (const budget of budgets) {
    const period = periodById.get(budget.fiscalPeriodId);
    if (!period) {
      results.push(budget);
      continue;
    }

    const net = netByAccount
      .filter(
        (row) =>
          row.account_id === budget.accountId &&
          new Date(row.transaction_date) >= period.startDate &&
          new Date(row.transaction_date) <= period.endDate
      )
      .reduce((sum, row) => sum + (Number(row.debit) - Number(row.credit)), 0);

    const actualAmount = Math.round(net * 100) / 100;
    const variance = Math.round((actualAmount - Number(budget.budgetAmount)) * 100) / 100;

    const updated = await budgetRepository.setBudgetActuals(prisma, budget.id, actualAmount, variance);
    results.push(updated);
  }

  return results;
}

export async function listBudgets(tenantId: string, fiscalPeriodId?: string): Promise<BudgetRecord[]> {
  const budgets = await budgetRepository.listBudgets(prisma, tenantId, fiscalPeriodId);
  return recomputeActualsForBudgets(tenantId, budgets);
}

export async function getBudgetById(tenantId: string, id: string): Promise<BudgetRecord | null> {
  const budget = await budgetRepository.getBudgetById(prisma, tenantId, id);
  if (!budget) return null;
  const [recomputed] = await recomputeActualsForBudgets(tenantId, [budget]);
  return recomputed;
}

export async function createBudget(tenantId: string, input: any, actor?: AuditActor): Promise<BudgetRecord> {
  const { accountId, fiscalPeriodId, budgetAmount, notes } = input;

  if (!accountId || typeof accountId !== 'string') {
    throw new BudgetServiceError('accountId is required.', 400);
  }
  if (!fiscalPeriodId || typeof fiscalPeriodId !== 'string') {
    throw new BudgetServiceError('fiscalPeriodId is required.', 400);
  }
  const amount = Number(budgetAmount);
  if (isNaN(amount)) {
    throw new BudgetServiceError('budgetAmount must be a number.', 400);
  }

  const period = await fiscalPeriodRepository.getFiscalPeriodById(prisma, tenantId, fiscalPeriodId);
  if (!period) {
    throw new BudgetServiceError(`Fiscal period with ID "${fiscalPeriodId}" not found.`, 400);
  }

  let created: BudgetRecord;
  try {
    created = await prisma.$transaction(async (tx) => {
      const created = await budgetRepository.createBudget(tx as any, tenantId, { accountId, fiscalPeriodId, budgetAmount: amount, notes });

      await recordAuditLogTx(tx as any, {
        action: 'BUDGET.CREATED',
        entity: 'Budget',
        entityId: created.id,
        tenantId,
        actor,
        details: `Budget of ${created.budgetAmount} created for account ${created.accountId} in fiscal period ${created.fiscalPeriodId}.`,
      });

      return created;
    });
  } catch (error: any) {
    if (error.code === 'P2002') {
      throw new BudgetServiceError('A budget already exists for this account in this fiscal period.', 409);
    }
    throw error;
  }

  return created;
}

export async function updateBudget(tenantId: string, id: string, input: any, actor?: AuditActor): Promise<BudgetRecord> {
  const existing = await budgetRepository.getBudgetById(prisma, tenantId, id);
  if (!existing) {
    throw new BudgetServiceError(`Budget with ID "${id}" not found.`, 404);
  }
  const amount = input.budgetAmount !== undefined ? Number(input.budgetAmount) : Number(existing.budgetAmount);
  if (isNaN(amount)) {
    throw new BudgetServiceError('budgetAmount must be a number.', 400);
  }
  const updated = await prisma.$transaction(async (tx) => {
    const updated = await budgetRepository.updateBudgetAmount(tx as any, id, amount, input.notes);

    await recordAuditLogTx(tx as any, {
      action: 'BUDGET.UPDATED',
      entity: 'Budget',
      entityId: id,
      tenantId,
      actor,
      changes: diffFields(existing, updated, ['budgetAmount', 'notes']),
    });

    return updated;
  });

  return updated;
}

export async function deleteBudget(tenantId: string, id: string, actor?: AuditActor): Promise<void> {
  const existing = await budgetRepository.getBudgetById(prisma, tenantId, id);
  if (!existing) {
    throw new BudgetServiceError(`Budget with ID "${id}" not found.`, 404);
  }

  await prisma.$transaction(async (tx) => {
    const deleted = await budgetRepository.deleteBudget(tx as any, tenantId, id);
    if (!deleted) {
      throw new BudgetServiceError(`Budget with ID "${id}" not found.`, 404);
    }

    await recordAuditLogTx(tx as any, {
      action: 'BUDGET.DELETED',
      entity: 'Budget',
      entityId: id,
      tenantId,
      actor,
      details: `Budget of ${existing.budgetAmount} for account ${existing.accountId} deleted.`,
    });
  });
}
