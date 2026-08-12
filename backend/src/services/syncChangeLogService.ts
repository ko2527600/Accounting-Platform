import { PrismaClient, SyncOperation } from '@prisma/client';
import { redis } from '../config/redis';
import { logger } from '../utils/logger';

/** Redis pub/sub channel a tenant's connected WebSocket clients are relayed from. */
export function syncChannelForTenant(tenantId: string): string {
  return `sync:tenant:${tenantId}`;
}

export type SyncEntityType = 'Account' | 'Invoice';

export interface RecordChangeInput {
  tenantId: string;
  entityType: SyncEntityType;
  entityId: string;
  operation: 'CREATE' | 'UPDATE' | 'DELETE';
  // Full current-state snapshot for CREATE/UPDATE so a client can upsert its
  // local copy without a follow-up fetch; omitted for DELETE - entityId +
  // operation alone is the tombstone. Must already be JSON-safe (Decimal/
  // Date fields converted to string) - callers own that conversion since
  // the shape differs per entity type.
  payload?: Record<string, unknown> | null;
}

/**
 * Transactional-outbox write: appends exactly one row to sync_change_log, in
 * the SAME transaction as the business mutation it describes. The caller
 * MUST pass the transaction-pinned client it already has from
 * withCurrentTenantDb/withTenantDb - never the bare `prisma` singleton -
 * otherwise this commits independently of the mutation it's supposed to be
 * atomic with.
 *
 * Deliberately does NOT swallow errors the way recordAuditLog does: if this
 * insert fails, the whole transaction (including the business mutation)
 * must roll back. A change that isn't logged can never be discovered by a
 * syncing client and would silently and permanently desync it - unlike a
 * failed audit-log write, which only loses a record of what happened, this
 * would lose the client's ability to ever learn it happened at all.
 *
 * sequence is a per-tenant monotonic counter (sync_sequence_counters),
 * incremented via an atomic upsert - Postgres's row-level lock on the
 * UPDATE branch serializes concurrent callers for the same tenant, so two
 * simultaneous writes can never be assigned the same sequence number.
 */
export async function recordChange(
  client: PrismaClient,
  input: RecordChangeInput
): Promise<bigint> {
  const counter = await client.syncSequenceCounter.upsert({
    where: { tenantId: input.tenantId },
    create: { tenantId: input.tenantId, value: 1 },
    update: { value: { increment: 1 } },
  });

  await client.syncChangeLog.create({
    data: {
      tenantId: input.tenantId,
      entityType: input.entityType,
      entityId: input.entityId,
      operation: input.operation as SyncOperation,
      payload: input.operation === 'DELETE' ? undefined : ((input.payload ?? undefined) as any),
      sequence: counter.value,
    },
  });

  return counter.value;
}

export interface NotifyChangeInput extends RecordChangeInput {
  sequence: bigint;
}

/**
 * Fire-and-forget push notification for a change already committed by
 * recordChange - call this AFTER the transaction that called recordChange
 * has committed (never from inside it: a Redis publish can't be rolled back,
 * so publishing before commit risks telling clients about a change that
 * then never actually happened). Best-effort by design - a WebSocket-
 * connected client that misses this (Redis briefly down, client offline)
 * still catches up correctly via GET /sync/changes, so a publish failure
 * here must never fail or roll back the write it's describing.
 */
export function notifyChange(entry: NotifyChangeInput): void {
  const message = JSON.stringify({
    entityType: entry.entityType,
    entityId: entry.entityId,
    operation: entry.operation,
    payload: entry.payload ?? null,
    sequence: entry.sequence.toString(),
    occurredAt: new Date().toISOString(),
  });

  redis.publish(syncChannelForTenant(entry.tenantId), message).catch((err: any) => {
    logger.warn('[SyncChangeLog] Failed to publish change notification (clients will catch up via /sync/changes)', {
      tenantId: entry.tenantId,
      entityType: entry.entityType,
      entityId: entry.entityId,
      error: err?.message,
    });
  });
}

/** The tenant's current sequence high-water mark - 0 if it has never made a syncable write. */
export async function getCurrentSequence(client: PrismaClient, tenantId: string): Promise<bigint> {
  const counter = await client.syncSequenceCounter.findUnique({ where: { tenantId } });
  return counter?.value ?? 0n;
}

export interface ChangeLogEntry {
  entityType: string;
  entityId: string;
  operation: SyncOperation;
  payload: unknown;
  sequence: string;
  occurredAt: string;
}

/**
 * JSON-safe snapshot of an Invoice for a sync_change_log payload - shared by
 * every write path that touches an invoice (create, payment) so the shape
 * a syncing client receives never drifts between them.
 */
export function invoiceToSyncPayload(invoice: any): Record<string, unknown> {
  return {
    id: invoice.id,
    tenantId: invoice.tenantId,
    invoiceNumber: invoice.invoiceNumber,
    customerId: invoice.customerId,
    // Only present when the caller's own Prisma `include` fetched it (both
    // current call sites do) - keeps a live-pushed/catch-up invoice row
    // showing a real customer name/email immediately, not just after the
    // receiving client's next full bootstrap.
    customer: invoice.customer
      ? { id: invoice.customer.id, name: invoice.customer.name, email: invoice.customer.email }
      : undefined,
    issueDate: invoice.issueDate?.toISOString?.() ?? invoice.issueDate,
    dueDate: invoice.dueDate?.toISOString?.() ?? invoice.dueDate,
    currency: invoice.currency,
    exchangeRate: Number(invoice.exchangeRate),
    subtotal: Number(invoice.subtotal),
    tax: Number(invoice.tax),
    taxRateId: invoice.taxRateId,
    taxBreakdown: invoice.taxBreakdown,
    total: Number(invoice.total),
    baseCurrencyAmount:
      invoice.baseCurrencyAmount !== null && invoice.baseCurrencyAmount !== undefined
        ? Number(invoice.baseCurrencyAmount)
        : null,
    status: invoice.status,
    emailedAt: invoice.emailedAt?.toISOString?.() ?? invoice.emailedAt ?? null,
    journalId: invoice.journalId,
    fundId: invoice.fundId,
    createdAt: invoice.createdAt?.toISOString?.() ?? invoice.createdAt,
  };
}

/**
 * Everything appended to the log after `since` (exclusive), oldest first -
 * what a client applies, in order, to catch up after being offline or
 * backgrounded. Ordinary read, no transaction pinning required, but still
 * takes `client` so route handlers can call it from inside the same
 * withCurrentTenantDb block used for the per-tenant-schema bootstrap read.
 */
export async function getChangesSince(
  client: PrismaClient,
  tenantId: string,
  since: bigint
): Promise<ChangeLogEntry[]> {
  const rows = await client.syncChangeLog.findMany({
    where: { tenantId, sequence: { gt: since } },
    orderBy: { sequence: 'asc' },
  });

  return rows.map((row) => ({
    entityType: row.entityType,
    entityId: row.entityId,
    operation: row.operation,
    payload: row.payload,
    sequence: row.sequence.toString(),
    occurredAt: row.occurredAt.toISOString(),
  }));
}
