import { Request } from 'express';
import { PrismaClient } from '@prisma/client';
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

/**
 * Transactional write path for AuditLog rows, for security-critical mutations
 * (ledger entries, vouchers, masters) where the audit entry must never be able
 * to drift out of sync with the data change it describes. Pass the same
 * `client` the caller is already using inside `withTenantDb`/`withCurrentTenantDb`
 * (its transaction-scoped `SET LOCAL search_path` still resolves `audit_logs`
 * via the `public` fallback) so this insert commits or rolls back atomically
 * with the business write. Unlike `recordAuditLog`, this throws on failure -
 * that's the point: a failed audit write must abort the whole transaction
 * rather than let an unaudited change land.
 */
export async function recordAuditLogTx(
  client: Pick<PrismaClient, 'auditLog'>,
  input: RecordAuditLogInput
): Promise<void> {
  await client.auditLog.create({
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
