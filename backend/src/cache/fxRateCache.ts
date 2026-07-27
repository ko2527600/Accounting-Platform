import { cacheUtils } from '../config/redis';

// FX rates are cached for 6 hours - real-world rates don't move fast enough
// to need per-request freshness, and this keeps conversions off the network
// for the overwhelming majority of requests.
const FX_RATE_CACHE_TTL_SECONDS = 6 * 60 * 60;

function getRatesCacheKey(baseCurrency: string): string {
  return `fxrates:${baseCurrency}`;
}

export async function getRatesFromCache(baseCurrency: string): Promise<Record<string, number> | null> {
  try {
    return await cacheUtils.get<Record<string, number>>(getRatesCacheKey(baseCurrency));
  } catch (error: any) {
    console.error('[FxRateCache] Redis GET failed, falling back to live fetch', {
      baseCurrency,
      error: error.message,
    });
    return null;
  }
}

export async function setRatesInCache(
  baseCurrency: string,
  rates: Record<string, number>,
  ttlSeconds: number = FX_RATE_CACHE_TTL_SECONDS
): Promise<void> {
  // Awaited (unlike tenantCache's fire-and-forget writes) so a caller that
  // immediately re-reads right after a live fetch reliably gets a cache hit
  // instead of racing the write - never throws, errors are logged and swallowed.
  try {
    await cacheUtils.set(getRatesCacheKey(baseCurrency), rates, ttlSeconds);
  } catch (error: any) {
    console.error('[FxRateCache] Redis SET failed', { baseCurrency, error: error.message });
  }
}

export async function invalidateRatesCache(baseCurrency: string): Promise<void> {
  try {
    await cacheUtils.del(getRatesCacheKey(baseCurrency));
  } catch (error: any) {
    console.error('[FxRateCache] Redis DEL failed', { baseCurrency, error: error.message });
  }
}
