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

  // Set PostgreSQL search_path for schema isolation
  await prismaClient.$executeRawUnsafe(`SET search_path TO "${schemaName}", public;`);

  try {
    return await queryFn(prismaClient);
  } finally {
    // Reset search path back to public
    await prismaClient.$executeRawUnsafe(`SET search_path TO public;`);
  }
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
