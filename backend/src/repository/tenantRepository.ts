import { PrismaClient } from '@prisma/client';

export interface TenantRecord {
  id: string;
  name: string;
  slug: string;
  schema: string;
  acceptedTermsVersion: string | null;
  termsAcceptedAt: Date | null;
  tier: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTenantData {
  name: string;
  slug: string;
  schema: string;
  acceptedTermsVersion?: string | null;
  termsAcceptedAt?: Date | null;
  tier?: number;
}

/**
 * Ensures the `tenants` table exists.
 * Placeholder for compatibility since database schema is managed via Prisma migrations / db push.
 */
export async function ensureTenantTableExists(prisma: PrismaClient): Promise<void> {
  // Database schema is fully managed and synchronized via Prisma
}

/**
 * Creates a new tenant record in the database using Prisma Client.
 */
export async function createTenant(prisma: PrismaClient, data: CreateTenantData): Promise<TenantRecord> {
  const tier = data.tier !== undefined ? data.tier : 1;

  const dbTenant = await prisma.tenant.create({
    data: {
      name: data.name.trim(),
      slug: data.slug.toLowerCase().trim(),
      schema: data.schema.toLowerCase().trim(),
      acceptedTermsVersion: data.acceptedTermsVersion || null,
      termsAcceptedAt: data.termsAcceptedAt || null,
      tier,
    },
  });

  return dbTenant;
}

/**
 * Finds a tenant by slug.
 */
export async function findTenantBySlug(prisma: PrismaClient, slug: string): Promise<TenantRecord | null> {
  return prisma.tenant.findUnique({
    where: { slug: slug.toLowerCase().trim() },
  });
}

/**
 * Finds a tenant by UUID.
 */
export async function findTenantById(prisma: PrismaClient, id: string): Promise<TenantRecord | null> {
  return prisma.tenant.findUnique({
    where: { id },
  });
}

/**
 * Lists all registered tenants.
 */
export async function listTenants(prisma: PrismaClient): Promise<TenantRecord[]> {
  return prisma.tenant.findMany({
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Deletes a tenant by slug (primarily for test cleanup).
 */
export async function deleteTenantBySlug(prisma: PrismaClient, slug: string): Promise<boolean> {
  try {
    const result = await prisma.tenant.delete({
      where: { slug: slug.toLowerCase().trim() },
    });
    return !!result;
  } catch {
    return false;
  }
}
