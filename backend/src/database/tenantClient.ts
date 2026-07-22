import { PrismaClient } from '@prisma/client';
import { sanitizeSchemaName } from './tenantSchemaManager';
import { getTenantContext } from '../context/tenantContext';
import { ensureTenantSchemaMigrated, clearMigratedSchemasCache } from './tenantMigrationRunner';

export { ensureTenantSchemaMigrated, clearMigratedSchemasCache };


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

  return await prismaClient.$transaction(async (tx) => {
    const client = tx as unknown as PrismaClient;
    // SET LOCAL is transaction-scoped: search_path auto-resets on commit/rollback
    await client.$executeRawUnsafe(`SET LOCAL search_path TO "${schemaName}", public;`);
    return await queryFn(client);
  });
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
