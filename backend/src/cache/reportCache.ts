import { createHash } from 'crypto';
import { cacheUtils } from '../config/redis';

// Financial reports are expensive full-ledger aggregations. Cache them for
// 5 minutes per tenant — long enough to absorb repeated page refreshes and
// concurrent users opening the same report, short enough that a just-posted
// journal entry shows up on the next natural visit without a manual reload.
const REPORT_TTL_SECONDS = 5 * 60;

function hashParams(params: Record<string, string | undefined>): string {
  const stable = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k] ?? ''}`)
    .join('&');
  return createHash('sha1').update(stable).digest('hex').slice(0, 12);
}

function buildKey(tenantId: string, reportType: string, params: Record<string, string | undefined>): string {
  return `report:${tenantId}:${reportType}:${hashParams(params)}`;
}

/** Returns a cached report result, or null on cache miss / Redis unavailability. */
export async function getCachedReport<T>(
  tenantId: string,
  reportType: string,
  params: Record<string, string | undefined>
): Promise<T | null> {
  return cacheUtils.get<T>(buildKey(tenantId, reportType, params));
}

/** Stores a report result in the cache. Fire-and-forget: never throws. */
export async function setCachedReport(
  tenantId: string,
  reportType: string,
  params: Record<string, string | undefined>,
  data: unknown
): Promise<void> {
  await cacheUtils.set(buildKey(tenantId, reportType, params), data, REPORT_TTL_SECONDS);
}

/**
 * Invalidates all cached reports for a tenant — call this whenever the
 * ledger changes (journal entry posted, voided, or recurring entry generated)
 * so stale totals can't persist past the next page view.
 */
export async function invalidateReportCache(tenantId: string): Promise<void> {
  await cacheUtils.delPattern(`report:${tenantId}:*`);
}
