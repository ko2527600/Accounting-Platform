import { PrismaClient } from '@prisma/client';

export interface TenantRecord {
  id: string;
  name: string;
  slug: string;
  schema: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTenantData {
  name: string;
  slug: string;
  schema: string;
}

let tableEnsured = false;

/**
 * Ensures the `tenants` table exists in the PostgreSQL public database schema.
 */
export async function ensureTenantTableExists(prisma: PrismaClient): Promise<void> {
  if (tableEnsured) return;

  await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS tenants (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL,
      slug VARCHAR(255) NOT NULL UNIQUE,
      schema VARCHAR(255) NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);`);

  tableEnsured = true;
}

/**
 * Maps raw SQL row to TenantRecord object.
 */
function mapTenantRow(row: any): TenantRecord {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    schema: row.schema,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * Creates a new tenant record in the public.tenants database table.
 */
export async function createTenant(prisma: PrismaClient, data: CreateTenantData): Promise<TenantRecord> {
  await ensureTenantTableExists(prisma);

  const rows: any[] = await prisma.$queryRawUnsafe(
    `INSERT INTO tenants (name, slug, schema)
     VALUES ($1, $2, $3)
     RETURNING id, name, slug, schema, created_at, updated_at`,
    data.name.trim(),
    data.slug.toLowerCase().trim(),
    data.schema.toLowerCase().trim()
  );

  return mapTenantRow(rows[0]);
}

/**
 * Finds a tenant by slug.
 */
export async function findTenantBySlug(prisma: PrismaClient, slug: string): Promise<TenantRecord | null> {
  await ensureTenantTableExists(prisma);

  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT id, name, slug, schema, created_at, updated_at
     FROM tenants
     WHERE LOWER(slug) = $1`,
    slug.toLowerCase().trim()
  );

  if (!rows || rows.length === 0) {
    return null;
  }

  return mapTenantRow(rows[0]);
}

/**
 * Finds a tenant by UUID.
 */
export async function findTenantById(prisma: PrismaClient, id: string): Promise<TenantRecord | null> {
  await ensureTenantTableExists(prisma);

  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT id, name, slug, schema, created_at, updated_at
     FROM tenants
     WHERE id = $1::uuid`,
    id
  );

  if (!rows || rows.length === 0) {
    return null;
  }

  return mapTenantRow(rows[0]);
}

/**
 * Lists all registered tenants.
 */
export async function listTenants(prisma: PrismaClient): Promise<TenantRecord[]> {
  await ensureTenantTableExists(prisma);

  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT id, name, slug, schema, created_at, updated_at
     FROM tenants
     ORDER BY created_at DESC`
  );

  return rows.map(mapTenantRow);
}

/**
 * Deletes a tenant by slug (primarily for test cleanup).
 */
export async function deleteTenantBySlug(prisma: PrismaClient, slug: string): Promise<boolean> {
  await ensureTenantTableExists(prisma);

  const result = await prisma.$executeRawUnsafe(
    `DELETE FROM tenants WHERE LOWER(slug) = $1`,
    slug.toLowerCase().trim()
  );

  return result > 0;
}
