import { cacheUtils } from '../config/redis';

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

// Redis cache configuration
const TENANT_CACHE_TTL_SECONDS = 30 * 60; // 30 minutes (increased from 60 seconds)

// Cache key builders
function getTenantCacheKey(identifier: string): string {
  return `tenant:${identifier}`;
}

/**
 * Get tenant from Redis cache
 */
export async function getTenantFromCache(key: string): Promise<CachedTenant | null> {
  try {
    const cacheKey = getTenantCacheKey(key);
    const tenant = await cacheUtils.get<CachedTenant>(cacheKey);
    
    if (tenant) {
      // Parse Date objects (JSON serialization converts to strings)
      return {
        ...tenant,
        createdAt: new Date(tenant.createdAt),
        updatedAt: new Date(tenant.updatedAt),
        termsAcceptedAt: tenant.termsAcceptedAt ? new Date(tenant.termsAcceptedAt) : null,
      };
    }
    
    return null;
  } catch (error: any) {
    // Gracefully degrade to database lookup on cache failure
    console.error('[TenantCache] Redis GET failed, falling back to database', {
      key,
      error: error.message,
    });
    return null;
  }
}

/**
 * Set tenant in Redis cache with multiple keys for different lookup patterns
 */
export function setTenantInCache(key: string, tenant: CachedTenant, ttlSeconds: number = TENANT_CACHE_TTL_SECONDS): void {
  // Fire and forget - don't block the request on cache writes
  // Use Promise.allSettled to handle partial failures gracefully
  Promise.allSettled([
    cacheUtils.set(getTenantCacheKey(key), tenant, ttlSeconds),
    cacheUtils.set(getTenantCacheKey(tenant.id), tenant, ttlSeconds),
    cacheUtils.set(getTenantCacheKey(tenant.slug), tenant, ttlSeconds),
    cacheUtils.set(getTenantCacheKey(tenant.schema), tenant, ttlSeconds),
  ]).catch((error: any) => {
    console.error('[TenantCache] Redis SET failed', {
      key,
      tenantId: tenant.id,
      error: error.message,
    });
  });
}

/**
 * Invalidate tenant cache for a specific identifier
 */
export async function invalidateTenantCache(identifier: string): Promise<void> {
  try {
    const cacheKey = getTenantCacheKey(identifier);
    await cacheUtils.del(cacheKey);
  } catch (error: any) {
    console.error('[TenantCache] Redis DEL failed', {
      identifier,
      error: error.message,
    });
  }
}

/**
 * Invalidate all cache entries for a specific tenant (by ID)
 */
export async function invalidateTenantCacheById(tenantId: string): Promise<void> {
  try {
    // First, try to get the tenant to find all its identifiers
    const tenant = await getTenantFromCache(tenantId);
    
    if (tenant) {
      // Delete all possible cache keys for this tenant
      await Promise.allSettled([
        cacheUtils.del(getTenantCacheKey(tenant.id)),
        cacheUtils.del(getTenantCacheKey(tenant.slug)),
        cacheUtils.del(getTenantCacheKey(tenant.schema)),
      ]);
    } else {
      // Fallback: just delete by the provided ID
      await cacheUtils.del(getTenantCacheKey(tenantId));
    }
  } catch (error: any) {
    console.error('[TenantCache] Invalidation failed', {
      tenantId,
      error: error.message,
    });
  }
}

/**
 * Clear all tenant cache entries (use with caution!)
 */
export async function clearTenantCache(): Promise<void> {
  try {
    const deletedCount = await cacheUtils.delPattern('tenant:*');
    console.log(`[TenantCache] Cleared ${deletedCount} tenant cache entries`);
  } catch (error: any) {
    console.error('[TenantCache] Clear failed', {
      error: error.message,
    });
  }
}

/**
 * Warm up cache with active tenants (call on server startup)
 */
export async function warmTenantCache(tenants: CachedTenant[]): Promise<void> {
  try {
    const promises = tenants.map(tenant => 
      setTenantInCache(tenant.id, tenant, TENANT_CACHE_TTL_SECONDS)
    );
    
    await Promise.allSettled(promises);
    console.log(`[TenantCache] Warmed cache with ${tenants.length} active tenants`);
  } catch (error: any) {
    console.error('[TenantCache] Cache warming failed', {
      error: error.message,
    });
  }
}
