import { PrismaClient } from '@prisma/client';
import { sanitizeSchemaName } from './tenantSchemaManager';
import { getTenantContext } from '../context/tenantContext';
import { ensureTenantSchemaMigrated, clearMigratedSchemasCache } from './tenantMigrationRunner';

export { ensureTenantSchemaMigrated, clearMigratedSchemasCache };


/**
 * Executes a callback within PostgreSQL search_path set to the target tenant schema.
 */
export async function withTenantDb<T>(
  prismaClient: PrismaClient,
  rawSchemaName: string,
  queryFn: (client: PrismaClient) => Promise<T>
): Promise<T> {
  const schemaName = sanitizeSchemaName(rawSchemaName);

  // Execute search_path mutation and query execution inside a transaction
  // to pin both operations to the exact same checked-out connection, eliminating race conditions.
  return await prismaClient.$transaction(async (tx) => {
    const client = tx as unknown as PrismaClient;
    await client.$executeRawUnsafe(`SET search_path TO "${schemaName}", public;`);
    try {
      return await queryFn(client);
    } finally {
      await client.$executeRawUnsafe(`SET search_path TO public;`);
    }
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
