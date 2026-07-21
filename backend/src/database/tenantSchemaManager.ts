import { PrismaClient } from '@prisma/client';

/**
 * Validates and sanitizes a tenant schema name to prevent SQL injection.
 * Schema names must start with a letter or underscore, followed by lowercase letters, numbers, or underscores.
 * Max length is 63 characters (PostgreSQL standard limit for identifiers).
 */
export function sanitizeSchemaName(rawName: string): string {
  if (!rawName || typeof rawName !== 'string') {
    throw new Error('Schema name must be a non-empty string');
  }

  // Remove any whitespace and convert to lowercase
  let formatted = rawName.trim().toLowerCase();

  // If name doesn't start with tenant_, prefix it
  if (!formatted.startsWith('tenant_')) {
    formatted = `tenant_${formatted}`;
  }

  // Replace invalid characters with underscores
  formatted = formatted.replace(/[^a-z0-9_]/g, '_');

  // Ensure it doesn't exceed PostgreSQL 63 character limit
  if (formatted.length > 63) {
    formatted = formatted.substring(0, 63);
  }

  // Final validation regex
  const validPattern = /^[a-z_][a-z0-9_]{1,62}$/;
  if (!validPattern.test(formatted)) {
    throw new Error(`Invalid tenant schema name format: "${formatted}"`);
  }

  return formatted;
}

/**
 * Provisions a new PostgreSQL schema for a tenant if it doesn't already exist.
 */
export async function createTenantSchema(prismaClient: PrismaClient, rawSchemaName: string): Promise<string> {
  const schemaName = sanitizeSchemaName(rawSchemaName);
  
  // Create schema dynamically using raw query with sanitized identifier
  await prismaClient.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${schemaName}";`);
  
  return schemaName;
}

/**
 * Drops a tenant schema and all its contents (CASCADE).
 * Caution: Destructive operation, primary for testing or tenant offboarding.
 */
export async function dropTenantSchema(prismaClient: PrismaClient, rawSchemaName: string): Promise<string> {
  const schemaName = sanitizeSchemaName(rawSchemaName);
  
  await prismaClient.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE;`);
  
  return schemaName;
}

/**
 * Checks whether a given schema exists in PostgreSQL information_schema.
 */
export async function checkSchemaExists(prismaClient: PrismaClient, rawSchemaName: string): Promise<boolean> {
  const schemaName = sanitizeSchemaName(rawSchemaName);
  
  const result: Array<{ exists: boolean }> = await prismaClient.$queryRawUnsafe(
    `SELECT EXISTS (
      SELECT 1 
      FROM information_schema.schemata 
      WHERE schema_name = $1
    ) as exists;`,
    schemaName
  );
  
  return result.length > 0 && Boolean(result[0].exists);
}
