import { prisma } from '../config/db';
import { withCurrentTenantDb } from '../database/tenantClient';
import * as expenseClaimRepository from '../repository/expenseClaimRepository';
import { ExpenseClaimRecord } from '../repository/expenseClaimRepository';
import * as accountRepository from '../repository/accountRepository';
import * as approvalWorkflowService from '../services/approvalWorkflowService';
import * as approvalWorkflowRepository from '../repository/approvalWorkflowRepository';
import * as journalService from './journalEntryService';
import { recordAuditLogTx, AuditActor } from './auditLogService';

export class ExpenseClaimServiceError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number = 400) {
    super(message);
    this.name = 'ExpenseClaimServiceError';
    this.statusCode = statusCode;
  }
}

export async function listExpenseClaims(
  tenantId: string,
  filter?: { status?: string; mine?: string }
): Promise<ExpenseClaimRecord[]> {
  return expenseClaimRepository.listExpenseClaims(prisma, tenantId, {
    status: filter?.status,
    submittedBy: filter?.mine,
  });
}

export async function getExpenseClaimById(tenantId: string, id: string): Promise<ExpenseClaimRecord | null> {
  return expenseClaimRepository.getExpenseClaimById(prisma, tenantId, id);
}

/**
 * Files a new expense claim and immediately requests approval for it via the
 * shared ApprovalWorkflow engine (entityType 'ExpenseClaim') - reused as-is
 * rather than building a bespoke approval chain. Any tenant member may file
 * a claim (route-level role gate is intentionally loose); deciding and
 * reimbursing are the privileged steps.
 */
export async function submitExpenseClaim(
  tenantId: string,
  actor: AuditActor,
  submittedByName: string,
  input: any
): Promise<ExpenseClaimRecord> {
  const { category, description, amount, currency, expenseDate, expenseAccountId, requiredLevel } = input;

  if (!category || typeof category !== 'string' || !category.trim()) {
    throw new ExpenseClaimServiceError('category is required.', 400);
  }
  if (!description || typeof description !== 'string' || !description.trim()) {
    throw new ExpenseClaimServiceError('description is required.', 400);
  }
  const numericAmount = Number(amount);
  if (typeof numericAmount !== 'number' || Number.isNaN(numericAmount) || numericAmount <= 0) {
    throw new ExpenseClaimServiceError('amount must be a positive number.', 400);
  }
  if (!expenseDate) {
    throw new ExpenseClaimServiceError('expenseDate is required.', 400);
  }
  const level = requiredLevel !== undefined ? Number(requiredLevel) : 1;
  if (!Number.isInteger(level) || level < 1 || level > 10) {
    throw new ExpenseClaimServiceError('requiredLevel must be an integer between 1 and 10.', 400);
  }

  if (expenseAccountId) {
    const accounts = await withCurrentTenantDb(prisma, (client) => accountRepository.listAccounts(client));
    const account = accounts.find((a: any) => a.id === expenseAccountId);
    if (!account) {
      throw new ExpenseClaimServiceError(`Expense account with ID "${expenseAccountId}" not found.`, 404);
    }
    if (account.type !== 'EXPENSE') {
      throw new ExpenseClaimServiceError(`Account "${account.name}" is not an EXPENSE-type account.`, 400);
    }
  }

  const claimNumber = `EXP-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

  const claim = await expenseClaimRepository.createExpenseClaim(prisma, tenantId, {
    claimNumber,
    submittedBy: actor.userId || 'unknown',
    submittedByName: submittedByName || actor.userEmail || 'Unknown',
    category: category.trim(),
    description: description.trim(),
    amount: numericAmount,
    currency: currency || 'USD',
    expenseDate: new Date(expenseDate),
    expenseAccountId: expenseAccountId || null,
  });

  const workflow = await approvalWorkflowService.createApprovalWorkflow(tenantId, actor.userId || 'unknown', {
    entityType: 'ExpenseClaim',
    entityId: claim.id,
    requiredLevel: level,
  });

  const updated = await prisma.$transaction(async (tx) => {
    const updated = await expenseClaimRepository.updateExpenseClaim(tx as any, claim.id, {
      approvalWorkflowId: workflow.id,
    });

    await recordAuditLogTx(tx as any, {
      action: 'EXPENSE_CLAIM.SUBMITTED',
      entity: 'ExpenseClaim',
      entityId: claim.id,
      tenantId,
      actor,
      details: `Expense claim ${claimNumber} filed for ${numericAmount} ${claim.currency} (${category.trim()}).`,
    });

    return updated;
  });

  return updated;
}

/**
 * Records an approve/reject decision on the claim's next pending level by
 * delegating to approvalWorkflowService.decideApprovalStep, then mirrors the
 * resulting workflow status onto the claim itself so the Expense Claims page
 * doesn't need to separately poll the generic Approvals page.
 */
export async function decideExpenseClaim(
  tenantId: string,
  claimId: string,
  decision: 'APPROVE' | 'REJECT',
  comments: string | undefined,
  actor: AuditActor
): Promise<ExpenseClaimRecord> {
  const claim = await expenseClaimRepository.getExpenseClaimById(prisma, tenantId, claimId);
  if (!claim) {
    throw new ExpenseClaimServiceError(`Expense claim with ID "${claimId}" not found.`, 404);
  }
  if (!claim.approvalWorkflowId) {
    throw new ExpenseClaimServiceError('This claim has no approval workflow attached.', 500);
  }
  if (claim.status !== 'PENDING_APPROVAL') {
    throw new ExpenseClaimServiceError(`This claim is already ${claim.status.toLowerCase().replace('_', ' ')}.`, 400);
  }

  const workflow = await approvalWorkflowRepository.getApprovalWorkflowById(prisma, tenantId, claim.approvalWorkflowId);
  if (!workflow) {
    throw new ExpenseClaimServiceError('Approval workflow not found for this claim.', 500);
  }

  const updatedWorkflow = await approvalWorkflowService.decideApprovalStep(
    tenantId,
    claim.approvalWorkflowId,
    workflow.currentLevel + 1,
    decision,
    comments
  );

  const newStatus = updatedWorkflow.status === 'APPROVED' || updatedWorkflow.status === 'REJECTED'
    ? updatedWorkflow.status
    : 'PENDING_APPROVAL';

  const updated = await prisma.$transaction(async (tx) => {
    const updated = await expenseClaimRepository.updateExpenseClaim(tx as any, claimId, { status: newStatus });

    await recordAuditLogTx(tx as any, {
      action: `EXPENSE_CLAIM.${newStatus === 'PENDING_APPROVAL' ? 'STEP_DECIDED' : newStatus}`,
      entity: 'ExpenseClaim',
      entityId: claimId,
      tenantId,
      actor,
      changes: { status: { from: claim.status, to: newStatus } },
      details: `Expense claim ${claim.claimNumber} step ${decision.toLowerCase()}d${comments ? ` - ${comments}` : ''}.`,
    });

    return updated;
  });

  return updated;
}

/**
 * Posts the real Expense/Cash journal entry and marks the claim REIMBURSED.
 * Only APPROVED claims may be reimbursed. Uses the claim's own
 * expenseAccountId if it specified one, otherwise falls back to the same
 * "find by conventional code, else first of that type" default pattern
 * already used by invoices.ts/bills.ts for their cash/revenue lookups.
 */
export async function reimburseExpenseClaim(
  tenantId: string,
  claimId: string,
  actor: AuditActor
): Promise<ExpenseClaimRecord> {
  const claim = await expenseClaimRepository.getExpenseClaimById(prisma, tenantId, claimId);
  if (!claim) {
    throw new ExpenseClaimServiceError(`Expense claim with ID "${claimId}" not found.`, 404);
  }
  if (claim.status !== 'APPROVED') {
    throw new ExpenseClaimServiceError(`This claim must be APPROVED before it can be reimbursed (currently ${claim.status}).`, 400);
  }

  const accounts = await withCurrentTenantDb(prisma, (client) => accountRepository.listAccounts(client));
  const cashAcc = accounts.find((a: any) => a.code === '1010') || accounts.find((a: any) => a.type === 'ASSET') || accounts[0];
  const expenseAcc = claim.expenseAccountId
    ? accounts.find((a: any) => a.id === claim.expenseAccountId)
    : accounts.find((a: any) => a.code === '5010') || accounts.find((a: any) => a.type === 'EXPENSE');

  if (!cashAcc || !expenseAcc) {
    throw new ExpenseClaimServiceError('No Cash/Bank or Expense account exists to post this reimbursement to.', 400);
  }

  const amount = Number(claim.amount);

  const journal = await journalService.createJournalEntry(
    {
      description: `Reimbursement for Expense Claim ${claim.claimNumber} (${claim.submittedByName}) - ${claim.category}`,
      entryDate: new Date().toISOString().split('T')[0],
      status: 'POSTED',
      lines: [
        { accountId: expenseAcc.id, debit: amount, credit: 0, description: `Expense - ${claim.claimNumber}` },
        { accountId: cashAcc.id, debit: 0, credit: amount, description: `Cash paid out - ${claim.claimNumber}` },
      ],
    },
    actor
  );

  const updated = await prisma.$transaction(async (tx) => {
    const updated = await expenseClaimRepository.updateExpenseClaim(tx as any, claimId, {
      status: 'REIMBURSED',
      journalId: journal.id,
      reimbursedAt: new Date(),
    });

    await recordAuditLogTx(tx as any, {
      action: 'EXPENSE_CLAIM.REIMBURSED',
      entity: 'ExpenseClaim',
      entityId: claimId,
      tenantId,
      actor,
      changes: { status: { from: 'APPROVED', to: 'REIMBURSED' } },
      details: `Expense claim ${claim.claimNumber} reimbursed (${amount} ${claim.currency}).`,
    });

    return updated;
  });

  return updated;
}
