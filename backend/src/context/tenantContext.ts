import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantContextData {
  tenantId: string;
  tenantSchema: string;
  tenantName?: string;
  tenantSlug?: string;
}

const asyncLocalStorage = new AsyncLocalStorage<TenantContextData>();

/**
 * Runs a function within the context of a given tenant.
 */
export function runWithTenantContext<T>(
  context: TenantContextData,
  callback: () => Promise<T> | T
): Promise<T> {
  return asyncLocalStorage.run(context, () => Promise.resolve(callback()));
}

/**
 * Retrieves the current request's tenant context if set, otherwise undefined.
 */
export function getTenantContext(): TenantContextData | undefined {
  return asyncLocalStorage.getStore();
}

/**
 * Retrieves the current request's tenant context or throws an error if missing.
 */
export function requireTenantContext(): TenantContextData {
  const context = getTenantContext();
  if (!context) {
    throw new Error('Tenant context is missing for current execution scope.');
  }
  return context;
}
