import { prisma } from '../config/db';
import * as approvalWorkflowRepository from '../repository/approvalWorkflowRepository';
import { ApprovalWorkflowRecord } from '../repository/approvalWorkflowRepository';
import { recordAuditLog, diffFields, AuditActor } from './auditLogService';

export class ApprovalWorkflowServiceError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number = 400) {
    super(message);
    this.name = 'ApprovalWorkflowServiceError';
    this.statusCode = statusCode;
  }
}

export async function listApprovalWorkflows(
  tenantId: string,
  filter?: { status?: string; approverId?: string }
): Promise<ApprovalWorkflowRecord[]> {
  return approvalWorkflowRepository.listApprovalWorkflows(prisma, tenantId, filter as any);
}

export async function getApprovalWorkflowById(tenantId: string, id: string): Promise<ApprovalWorkflowRecord | null> {
  return approvalWorkflowRepository.getApprovalWorkflowById(prisma, tenantId, id);
}

export async function createApprovalWorkflow(tenantId: string, requestedBy: string, input: any, actor?: AuditActor): Promise<ApprovalWorkflowRecord> {
  const { entityType, entityId, requiredLevel, approverIds } = input;

  if (!entityType || typeof entityType !== 'string') {
    throw new ApprovalWorkflowServiceError('entityType is required.', 400);
  }
  if (!entityId || typeof entityId !== 'string') {
    throw new ApprovalWorkflowServiceError('entityId is required.', 400);
  }
  const level = Number(requiredLevel) || 1;
  if (!Number.isInteger(level) || level < 1 || level > 10) {
    throw new ApprovalWorkflowServiceError('requiredLevel must be an integer between 1 and 10.', 400);
  }

  const existing = await approvalWorkflowRepository.findActiveWorkflowForEntity(prisma, tenantId, entityType, entityId);
  if (existing && existing.status === 'PENDING') {
    throw new ApprovalWorkflowServiceError('An approval workflow is already pending for this entity.', 409);
  }

  const created = await approvalWorkflowRepository.createApprovalWorkflow(prisma, tenantId, {
    entityType,
    entityId,
    requiredLevel: level,
    requestedBy,
    approverIds,
  });

  await recordAuditLog({
    action: 'APPROVAL_WORKFLOW.CREATED',
    entity: 'ApprovalWorkflow',
    entityId: created.id,
    tenantId,
    actor,
    details: `Approval workflow requested for ${entityType} ${entityId} (${level} level(s) required).`,
  });

  return created;
}

export async function decideApprovalStep(
  tenantId: string,
  workflowId: string,
  level: number,
  decision: 'APPROVE' | 'REJECT',
  comments?: string,
  actor?: AuditActor
): Promise<ApprovalWorkflowRecord> {
  const workflow = await approvalWorkflowRepository.getApprovalWorkflowById(prisma, tenantId, workflowId);
  if (!workflow) {
    throw new ApprovalWorkflowServiceError(`Approval workflow with ID "${workflowId}" not found.`, 404);
  }
  if (workflow.status !== 'PENDING') {
    throw new ApprovalWorkflowServiceError(`This workflow is already ${workflow.status.toLowerCase()}.`, 400);
  }
  if (level !== workflow.currentLevel + 1) {
    throw new ApprovalWorkflowServiceError(
      `Level ${level} cannot be decided yet - level ${workflow.currentLevel + 1} must be decided first.`,
      400
    );
  }

  const step = await approvalWorkflowRepository.getApprovalStep(prisma, tenantId, workflowId, level);
  if (!step) {
    throw new ApprovalWorkflowServiceError(`Approval step for level ${level} not found.`, 404);
  }
  if (step.status !== 'PENDING') {
    throw new ApprovalWorkflowServiceError(`Step ${level} has already been decided.`, 400);
  }

  if (decision === 'REJECT') {
    await approvalWorkflowRepository.decideApprovalStep(prisma, step.id, 'REJECTED', comments);
    const rejected = await approvalWorkflowRepository.updateWorkflowProgress(prisma, workflowId, {
      status: 'REJECTED',
      completedAt: new Date(),
    });

    await recordAuditLog({
      action: 'APPROVAL_WORKFLOW.DECIDED',
      entity: 'ApprovalWorkflow',
      entityId: workflowId,
      tenantId,
      actor,
      changes: diffFields(workflow, rejected, ['status', 'currentLevel']),
      details: `Level ${level} rejected.${comments ? ` "${comments}"` : ''}`,
    });

    return rejected;
  }

  await approvalWorkflowRepository.decideApprovalStep(prisma, step.id, 'APPROVED', comments);
  const isFinalLevel = level === workflow.requiredLevel;
  const updated = await approvalWorkflowRepository.updateWorkflowProgress(prisma, workflowId, {
    currentLevel: level,
    ...(isFinalLevel ? { status: 'APPROVED', completedAt: new Date() } : {}),
  });

  await recordAuditLog({
    action: 'APPROVAL_WORKFLOW.DECIDED',
    entity: 'ApprovalWorkflow',
    entityId: workflowId,
    tenantId,
    actor,
    changes: diffFields(workflow, updated, ['status', 'currentLevel']),
    details: `Level ${level} approved.${comments ? ` "${comments}"` : ''}`,
  });

  return updated;
}

/**
 * The actual gate used by posting/payment code paths: if no workflow was
 * ever requested for this entity, nothing is blocked (purely opt-in). If one
 * exists, it must be fully APPROVED before the caller's action may proceed.
 */
export async function assertApprovedOrNoWorkflow(tenantId: string, entityType: string, entityId: string): Promise<void> {
  const workflow = await approvalWorkflowRepository.findActiveWorkflowForEntity(prisma, tenantId, entityType, entityId);
  if (workflow && workflow.status !== 'APPROVED') {
    throw new ApprovalWorkflowServiceError(
      `This ${entityType} requires approval (currently ${workflow.status}) before it can proceed.`,
      400
    );
  }
}
