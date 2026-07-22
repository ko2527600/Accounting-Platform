export interface CachedTenant {
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

interface CacheEntry {
  tenant: CachedTenant;
  expiresAt: number;
}

// In-memory tenant metadata cache with TTL (Default: 60 seconds)
const tenantMap = new Map<string, CacheEntry>();
const DEFAULT_TTL_MS = 60 * 1000;

export function getTenantFromCache(key: string): CachedTenant | null {
  const entry = tenantMap.get(key);
  if (!entry) {
    return null;
  }

  if (Date.now() > entry.expiresAt) {
    tenantMap.delete(key);
    return null;
  }

  return entry.tenant;
}

export function setTenantInCache(key: string, tenant: CachedTenant, ttlMs: number = DEFAULT_TTL_MS): void {
  const expiresAt = Date.now() + ttlMs;
  const entry: CacheEntry = { tenant, expiresAt };

  // Cache by primary identifier, slug, and schema name
  tenantMap.set(key, entry);
  tenantMap.set(tenant.id, entry);
  tenantMap.set(tenant.slug, entry);
  tenantMap.set(tenant.schema, entry);
}

export function invalidateTenantCache(identifier: string): void {
  tenantMap.delete(identifier);
}

export function clearTenantCache(): void {
  tenantMap.clear();
}
