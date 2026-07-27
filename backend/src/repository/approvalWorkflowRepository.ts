import { PrismaClient } from '@prisma/client';

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface ApprovalStepRecord {
  id: string;
  tenantId: string;
  workflowId: string;
  level: number;
  approverId: string | null;
  status: ApprovalStatus;
  comments: string | null;
  approvedAt: Date | null;
  createdAt: Date;
}

export interface ApprovalWorkflowRecord {
  id: string;
  tenantId: string;
  entityType: string;
  entityId: string;
  requiredLevel: number;
  currentLevel: number;
  status: ApprovalStatus;
  requestedBy: string;
  requestedAt: Date;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  approvals?: ApprovalStepRecord[];
}

export interface CreateApprovalWorkflowData {
  entityType: string;
  entityId: string;
  requiredLevel: number;
  requestedBy: string;
  approverIds?: (string | null)[];
}

export async function listApprovalWorkflows(
  prisma: PrismaClient,
  tenantId: string,
  filter?: { status?: ApprovalStatus; approverId?: string }
): Promise<ApprovalWorkflowRecord[]> {
  const where: any = { tenantId };
  if (filter?.status) where.status = filter.status;
  if (filter?.approverId) {
    where.approvals = { some: { approverId: filter.approverId, status: 'PENDING' } };
  }
  return (prisma as any).approvalWorkflow.findMany({
    where,
    include: { approvals: { orderBy: { level: 'asc' } } },
    orderBy: { requestedAt: 'desc' },
  });
}

export async function getApprovalWorkflowById(
  prisma: PrismaClient,
  tenantId: string,
  id: string
): Promise<ApprovalWorkflowRecord | null> {
  return (prisma as any).approvalWorkflow.findFirst({
    where: { id, tenantId },
    include: { approvals: { orderBy: { level: 'asc' } } },
  });
}

/**
 * Finds the active (non-terminal) workflow for a given entity, if any -
 * this is what the posting/payment gates check before allowing a
 * DRAFT/UNPAID entity to actually post or be paid.
 */
export async function findActiveWorkflowForEntity(
  prisma: PrismaClient,
  tenantId: string,
  entityType: string,
  entityId: string
): Promise<ApprovalWorkflowRecord | null> {
  return (prisma as any).approvalWorkflow.findFirst({
    where: { tenantId, entityType, entityId },
    orderBy: { requestedAt: 'desc' },
  });
}

export async function createApprovalWorkflow(
  prisma: PrismaClient,
  tenantId: string,
  data: CreateApprovalWorkflowData
): Promise<ApprovalWorkflowRecord> {
  const approvalSteps = Array.from({ length: data.requiredLevel }, (_, i) => ({
    tenantId,
    level: i + 1,
    approverId: data.approverIds?.[i] ?? null,
  }));

  return (prisma as any).approvalWorkflow.create({
    data: {
      tenantId,
      entityType: data.entityType,
      entityId: data.entityId,
      requiredLevel: data.requiredLevel,
      requestedBy: data.requestedBy,
      approvals: { create: approvalSteps },
    },
    include: { approvals: { orderBy: { level: 'asc' } } },
  });
}

export async function getApprovalStep(
  prisma: PrismaClient,
  tenantId: string,
  workflowId: string,
  level: number
): Promise<ApprovalStepRecord | null> {
  return (prisma as any).approvalStep.findFirst({ where: { tenantId, workflowId, level } });
}

export async function decideApprovalStep(
  prisma: PrismaClient,
  stepId: string,
  status: 'APPROVED' | 'REJECTED',
  comments?: string
): Promise<ApprovalStepRecord> {
  return (prisma as any).approvalStep.update({
    where: { id: stepId },
    data: { status, comments: comments ?? null, approvedAt: new Date() },
  });
}

export async function updateWorkflowProgress(
  prisma: PrismaClient,
  id: string,
  data: { currentLevel?: number; status?: ApprovalStatus; completedAt?: Date | null }
): Promise<ApprovalWorkflowRecord> {
  return (prisma as any).approvalWorkflow.update({
    where: { id },
    data,
    include: { approvals: { orderBy: { level: 'asc' } } },
  });
}
