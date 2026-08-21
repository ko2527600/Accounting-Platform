import { cacheUtils } from '../config/redis';

// Notifications are polled every 15 s by the Header component. A 10-second
// TTL absorbs every poll interval while keeping staleness bounded to one cycle.
const NOTIF_TTL_SECONDS = 10;

function buildKey(tenantId: string, userId: string): string {
  return `notif:${tenantId}:${userId}`;
}

export async function getCachedNotifications<T>(
  tenantId: string,
  userId: string
): Promise<T | null> {
  return cacheUtils.get<T>(buildKey(tenantId, userId));
}

export async function setCachedNotifications(
  tenantId: string,
  userId: string,
  data: unknown
): Promise<void> {
  await cacheUtils.set(buildKey(tenantId, userId), data, NOTIF_TTL_SECONDS);
}

/** Invalidates one user's notification cache — call on create/mark-read. */
export async function invalidateNotificationCache(
  tenantId: string,
  userId: string
): Promise<void> {
  await cacheUtils.del(buildKey(tenantId, userId));
}

/** Invalidates all users' notification caches for a tenant (broadcast create). */
export async function invalidateAllNotificationCaches(tenantId: string): Promise<void> {
  await cacheUtils.delPattern(`notif:${tenantId}:*`);
}
