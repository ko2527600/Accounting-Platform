import { Request } from 'express';
import { prisma } from '../config/db';
import { getTenantContext } from '../context/tenantContext';
import { logger } from '../utils/logger';

export interface AuditActor {
  userId?: string | null;
  userEmail?: string | null;
  ipAddress?: string | null;
}

export type AuditChanges = Record<string, { from: unknown; to: unknown }>;

export interface RecordAuditLogInput {
  action: string;
  entity: string;
  entityId?: string | null;
  tenantId?: string | null;
  actor?: AuditActor;
  changes?: AuditChanges | null;
  details?: string | null;
}

/**
 * Single write path for AuditLog rows. Never throws - a failed audit write
 * must not fail or roll back the business operation it describes - but logs
 * loudly instead of swallowing silently, so a systemic failure is visible.
 */
export async function recordAuditLog(input: RecordAuditLogInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        tenantId: input.tenantId ?? getTenantContext()?.tenantId ?? null,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId ?? null,
        details: input.details ?? null,
        userId: input.actor?.userId ?? null,
        userEmail: input.actor?.userEmail ?? null,
        ipAddress: input.actor?.ipAddress ?? null,
        changes: (input.changes ?? undefined) as any,
      },
    });
  } catch (err: any) {
    logger.error('[AuditLogService] Failed to write audit log entry', {
      action: input.action,
      entity: input.entity,
      entityId: input.entityId ?? undefined,
      error: err?.message,
      stack: err?.stack,
    });
  }
}

/** Extracts actor identity (who/from-where) from an authenticated request. */
export function actorFromRequest(req: Request): AuditActor {
  return {
    userId: req.user?.id ?? null,
    userEmail: req.user?.email ?? null,
    ipAddress: req.ip || req.socket?.remoteAddress || null,
  };
}

/** Builds a { field: {from, to} } diff, including only fields that actually changed. */
export function diffFields<T extends Record<string, any>>(
  before: T | null | undefined,
  after: T | null | undefined,
  fields: string[]
): AuditChanges {
  const changes: AuditChanges = {};
  for (const field of fields) {
    const from = before?.[field] ?? null;
    const to = after?.[field] ?? null;
    if (from !== to) {
      changes[field] = { from, to };
    }
  }
  return changes;
}
