import { PrismaClient, Prisma } from '@prisma/client';

type AuditLogWhereInput = Prisma.AuditLogWhereInput;

/**
 * Deletes audit_log rows during test teardown, bypassing the append-only
 * database trigger via SET LOCAL session_replication_role = 'replica'.
 * DO NOT use outside of test cleanup — the trigger exists for a reason.
 */
export async function deleteAuditLogs(
  db: PrismaClient,
  where: AuditLogWhereInput
): Promise<void> {
  await db
    .$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL session_replication_role = 'replica'`;
      await tx.auditLog.deleteMany({ where });
    })
    .catch(() => {});
}
