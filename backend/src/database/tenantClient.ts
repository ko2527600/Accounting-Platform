import { PrismaClient } from '@prisma/client';
import { sanitizeSchemaName } from './tenantSchemaManager';
import { getTenantContext } from '../context/tenantContext';
import { ensureTenantSchemaMigrated, clearMigratedSchemasCache } from './tenantMigrationRunner';

export { ensureTenantSchemaMigrated, clearMigratedSchemasCache };

// Prisma's interactive $transaction defaults (maxWait: 2000ms, timeout: 5000ms)
// assume a fast, low-latency DB connection. In production this transaction
// wraps every tenant-scoped query (SET LOCAL search_path + the caller's own
// work), and observed production latency per round-trip (BEGIN/SET LOCAL/
// COMMIT each taking 300-500ms under Render's connection pooler) already
// consumes most of that 5s budget on a single-query request - any endpoint
// that runs more than a couple of sequential queries in one
// withCurrentTenantDb block (e.g. bulk item import, looping per row) reliably
// exceeds it and gets a hard transaction-timeout error, which surfaces to the
// caller as a 500 with no useful message. Configurable via env vars so a
// slower/faster environment can tune it without a code change; defaults are
// generous but still bounded (matching the 30s statement_timeout already
// declared on DATABASE_URL, so this doesn't out-live what the DB itself allows).
const TX_TIMEOUT_MS = Number(process.env.PRISMA_TX_TIMEOUT_MS) || 25000;
const TX_MAX_WAIT_MS = Number(process.env.PRISMA_TX_MAX_WAIT_MS) || 10000;

/**
 * Executes a callback within PostgreSQL search_path set to the target tenant schema.
 *
 * Uses Prisma's interactive $transaction to pin all operations to a single DB connection,
 * preventing connection pool races. Uses SET LOCAL so the search_path is automatically
 * reset to the session default when the transaction commits or rolls back.
 */
export async function withTenantDb<T>(
  prismaClient: PrismaClient,
  rawSchemaName: string,
  queryFn: (client: PrismaClient) => Promise<T>
): Promise<T> {
  const schemaName = sanitizeSchemaName(rawSchemaName);

  return await prismaClient.$transaction(
    async (tx) => {
      const client = tx as unknown as PrismaClient;
      // SET LOCAL is transaction-scoped: search_path auto-resets on commit/rollback
      await client.$executeRawUnsafe(`SET LOCAL search_path TO "${schemaName}", public;`);
      return await queryFn(client);
    },
    { timeout: TX_TIMEOUT_MS, maxWait: TX_MAX_WAIT_MS }
  );
}

/**
 * Executes a callback using the schema from the current request's TenantContext.
 * Throws an error if no TenantContext is active.
 */
export async function withCurrentTenantDb<T>(
  prismaClient: PrismaClient,
  queryFn: (client: PrismaClient) => Promise<T>
): Promise<T> {
  const context = getTenantContext();
  if (!context || !context.tenantSchema) {
    throw new Error('No tenant context available to execute tenant database operation.');
  }

  return withTenantDb(prismaClient, context.tenantSchema, queryFn);
}
