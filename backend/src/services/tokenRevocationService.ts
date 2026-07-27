import { cacheUtils } from '../config/redis';

function revokedTokenKey(tokenHash: string): string {
  return `revoked:token:${tokenHash}`;
}

/**
 * Marks a specific token (by its hash) as revoked until it would have
 * naturally expired anyway - the Redis key self-expires at that point,
 * so this never grows unbounded.
 */
export async function revokeToken(tokenHash: string, ttlSeconds: number): Promise<void> {
  if (ttlSeconds <= 0) return;
  await cacheUtils.set(revokedTokenKey(tokenHash), true, ttlSeconds);
}

/**
 * Checks whether a token (by its hash) has been revoked. Fails open (returns
 * false) on a Redis error, matching this codebase's established fail-open
 * behavior for caching/rate-limiting - a Redis outage must not take down
 * authentication entirely. cacheUtils.get() already logs the underlying error.
 */
export async function isTokenRevoked(tokenHash: string): Promise<boolean> {
  const revoked = await cacheUtils.get<boolean>(revokedTokenKey(tokenHash));
  return revoked === true;
}
