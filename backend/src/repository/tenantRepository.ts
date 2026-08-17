import { PrismaClient } from '@prisma/client';
import { invalidateTenantCache } from '../cache/tenantCache';

export interface TenantRecord {
  id: string;
  name: string;
  slug: string;
  schema: string;
  acceptedTermsVersion: string | null;
  termsAcceptedAt: Date | null;
  tier: number;
  baseCurrency: string;
  orgType: string;
  businessType: string | null;
  vatRegistered: boolean;
  graTin: string | null;
  // GRA VSDC credentials - see graEvatService.ts. graSecurityKeyEncrypted is
  // an AES-256-GCM ciphertext (utils/credentialEncryption.ts), never the
  // plaintext key - callers must decrypt before using it, and must never
  // return it verbatim in an API response (see sanitizeTenantForResponse in
  // routes/tenants.ts).
  graDeviceNumber: string | null;
  graSecurityKeyEncrypted: string | null;
  // Per-tenant payment-collector credentials - see momoService.ts/
  // tellerService.ts/paystackService.ts. The *Encrypted fields are
  // AES-256-GCM ciphertext, same rules as graSecurityKeyEncrypted above.
  momoApiUser: string | null;
  momoSubscriptionKeyEncrypted: string | null;
  momoApiKeyEncrypted: string | null;
  tellerApiUsername: string | null;
  tellerMerchantId: string | null;
  tellerApiKeyEncrypted: string | null;
  // Paystack uses Subaccounts instead of a per-tenant secret - see
  // paystackService.ts. No secret is stored: paystackSubaccountCode is
  // Paystack's own reference id for this tenant's subaccount, and
  // paystackAccountNumber/paystackAccountName are the tenant's own bank
  // account details (identifying, not credentials).
  paystackSubaccountCode: string | null;
  paystackBankCode: string | null;
  paystackAccountNumber: string | null;
  paystackAccountName: string | null;
  isLive: boolean;
  bossPhone: string | null;
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
  baseCurrency?: string;
  orgType?: string;
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
      ...(data.baseCurrency ? { baseCurrency: data.baseCurrency } : {}),
      ...(data.orgType ? { orgType: data.orgType } : {}),
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
    // Deleting the DB row alone leaves a stale Redis entry (up to the 30-minute
    // TTL) under the id/slug/schema keys, which would let a tenant re-onboarded
    // with the same slug get silently resolved to the deleted tenant's old id.
    await Promise.all([
      invalidateTenantCache(result.id),
      invalidateTenantCache(result.slug),
      invalidateTenantCache(result.schema),
    ]).catch(() => {});
    return !!result;
  } catch {
    return false;
  }
}
