import { PrismaClient } from '@prisma/client';
import { sanitizeSchemaName, createTenantSchema } from './tenantSchemaManager';
import { TENANT_MIGRATIONS, TenantMigration } from './migrations/tenantMigrations';

export interface MigrationResult {
  tenantId?: string;
  schemaName: string;
  appliedMigrations: string[];
  skippedCount: number;
}

/**
 * Applies pending migrations to a single tenant schema.
 */
export async function runMigrationsForSchema(
  prismaClient: PrismaClient,
  rawSchemaName: string,
  tenantId?: string
): Promise<MigrationResult> {
  const schemaName = sanitizeSchemaName(rawSchemaName);
  
  // 1. Ensure schema exists
  await createTenantSchema(prismaClient, schemaName);

  const appliedMigrations: string[] = [];
  let skippedCount = 0;

  // 2. Set search path to target schema
  await prismaClient.$executeRawUnsafe(`SET search_path TO "${schemaName}", public;`);

  try {
    // 3. Ensure tracking table exists inside tenant schema
    await prismaClient.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".schema_migrations (
        version INTEGER PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 4. Fetch already applied versions
    const appliedRows: Array<{ version: number }> = await prismaClient.$queryRawUnsafe(
      `SELECT version FROM "${schemaName}".schema_migrations;`
    ) || [];
    const appliedVersions = new Set(appliedRows.map((r) => Number(r.version)));

    // 5. Run unapplied migrations sequentially
    for (const migration of TENANT_MIGRATIONS) {
      if (appliedVersions.has(migration.version)) {
        skippedCount++;
        continue;
      }

      console.log(`[TenantMigration] Executing version ${migration.version} (${migration.name}) on schema "${schemaName}"...`);
      
      // Execute migration DDL statements individually to support multi-statement DDLs
      const statements = migration.sql
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      for (const stmt of statements) {
        await prismaClient.$executeRawUnsafe(stmt);
      }

      // Record applied migration
      await prismaClient.$executeRawUnsafe(
        `INSERT INTO "${schemaName}".schema_migrations (version, name) VALUES ($1, $2);`,
        migration.version,
        migration.name
      );

      appliedMigrations.push(migration.name);
    }
  } finally {
    // 6. Always reset search path back to public
    await prismaClient.$executeRawUnsafe(`SET search_path TO public;`);
  }

  return {
    tenantId,
    schemaName,
    appliedMigrations,
    skippedCount,
  };
}

/**
 * Runs tenant migrations across all provisioned tenants in the public `tenants` table.
 */
export async function runAllTenantMigrations(
  prismaClient: PrismaClient
): Promise<MigrationResult[]> {
  const results: MigrationResult[] = [];

  // Query all tenants from public database
  const tenants = await prismaClient.tenant?.findMany({
    select: { id: true, schema: true, name: true },
  }) || [];

  console.log(`[TenantMigration] Found ${tenants.length} tenants to migrate.`);

  for (const tenant of tenants) {
    try {
      const result = await runMigrationsForSchema(prismaClient, tenant.schema, tenant.id);
      results.push(result);
    } catch (error) {
      console.error(`[TenantMigration] Error migrating tenant ${tenant.name} (${tenant.schema}):`, error);
      throw error;
    }
  }

  return results;
}
