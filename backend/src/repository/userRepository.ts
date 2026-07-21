import { PrismaClient } from '@prisma/client';

export interface UserRecord {
  id: string;
  email: string;
  password?: string;
  name: string;
  role: string;
  tenantId?: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateUserData {
  email: string;
  password: string;
  name: string;
  role?: string;
  tenantId?: string | null;
}

let tableEnsured = false;

/**
 * Ensures the `users` table exists in the PostgreSQL public database schema.
 */
export async function ensureUserTableExists(prisma: PrismaClient): Promise<void> {
  if (tableEnsured) return;

  await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email VARCHAR(255) NOT NULL UNIQUE,
      password VARCHAR(255) NOT NULL,
      name VARCHAR(255) NOT NULL,
      role VARCHAR(50) NOT NULL DEFAULT 'Viewer',
      tenant_id VARCHAR(255),
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON users(tenant_id);`);

  tableEnsured = true;
}

/**
 * Maps raw SQL row to UserRecord object.
 */
function mapUserRow(row: any): UserRecord {
  return {
    id: row.id,
    email: row.email,
    password: row.password,
    name: row.name,
    role: row.role,
    tenantId: row.tenant_id,
    isActive: row.is_active,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * Creates a new user record in the PostgreSQL database.
 */
export async function createUser(prisma: PrismaClient, data: CreateUserData): Promise<UserRecord> {
  await ensureUserTableExists(prisma);

  const role = data.role || 'Viewer';
  const tenantId = data.tenantId || null;

  const rows: any[] = await prisma.$queryRawUnsafe(
    `INSERT INTO users (email, password, name, role, tenant_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, email, name, role, tenant_id, is_active, created_at, updated_at`,
    data.email.toLowerCase().trim(),
    data.password,
    data.name.trim(),
    role,
    tenantId
  );

  return mapUserRow(rows[0]);
}

/**
 * Finds a user by email address (includes hashed password for credential verification).
 */
export async function findUserByEmail(prisma: PrismaClient, email: string): Promise<UserRecord | null> {
  await ensureUserTableExists(prisma);

  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT id, email, password, name, role, tenant_id, is_active, created_at, updated_at
     FROM users
     WHERE LOWER(email) = $1`,
    email.toLowerCase().trim()
  );

  if (!rows || rows.length === 0) {
    return null;
  }

  return mapUserRow(rows[0]);
}

/**
 * Finds a user by UUID (excludes password).
 */
export async function findUserById(prisma: PrismaClient, id: string): Promise<UserRecord | null> {
  await ensureUserTableExists(prisma);

  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT id, email, name, role, tenant_id, is_active, created_at, updated_at
     FROM users
     WHERE id = $1::uuid`,
    id
  );

  if (!rows || rows.length === 0) {
    return null;
  }

  return mapUserRow(rows[0]);
}

/**
 * Deletes a user by email (primarily for test cleanup).
 */
export async function deleteUserByEmail(prisma: PrismaClient, email: string): Promise<boolean> {
  await ensureUserTableExists(prisma);

  const result = await prisma.$executeRawUnsafe(
    `DELETE FROM users WHERE LOWER(email) = $1`,
    email.toLowerCase().trim()
  );

  return result > 0;
}
