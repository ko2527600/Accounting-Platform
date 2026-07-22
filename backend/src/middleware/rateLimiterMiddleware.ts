import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const store = new Map<string, RateLimitEntry>();

// Clean up expired entries every 5 minutes to prevent unbounded memory growth
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now - entry.windowStart > 120_000) {
      store.delete(key);
    }
  }
}, 5 * 60 * 1000);

interface RateLimitOptions {
  /** Max requests allowed in the window */
  maxRequests: number;
  /** Window duration in milliseconds */
  windowMs: number;
  /** Human-readable message returned on 429 */
  message?: string;
}

function createRateLimiter(options: RateLimitOptions) {
  return function rateLimiterMiddleware(req: Request, res: Response, next: NextFunction): void {
    // Bypass rate limiting in test environments to avoid test setup interference
    if (process.env.NODE_ENV === 'test') {
      return next();
    }

    const tenantId = req.headers['x-tenant-id'] as string | undefined;
    const ip = req.ip || req.socket.remoteAddress || 'unknown';

    // Key = per-tenant if available, otherwise per-IP
    const key = tenantId ? `tenant:${tenantId}` : `ip:${ip}`;
    const now = Date.now();

    const entry = store.get(key);

    if (!entry || now - entry.windowStart >= options.windowMs) {
      // First request in new window
      store.set(key, { count: 1, windowStart: now });
      next();
      return;
    }

    if (entry.count < options.maxRequests) {
      entry.count++;
      next();
      return;
    }

    const retryAfterSec = Math.ceil((options.windowMs - (now - entry.windowStart)) / 1000);

    logger.warn('Rate limit exceeded', {
      key,
      path: req.originalUrl,
      method: req.method,
    });

    res.setHeader('Retry-After', String(retryAfterSec));
    res.status(429).json({
      error: 'Too Many Requests',
      message: options.message || `Rate limit exceeded. Try again in ${retryAfterSec}s.`,
      retryAfterSeconds: retryAfterSec,
    });
  };
}

/**
 * Standard API rate limiter: 100 requests per 60 seconds per tenant/IP.
 */
export const apiRateLimiter = createRateLimiter({
  maxRequests: 100,
  windowMs: 60 * 1000,
  message: 'API rate limit exceeded. Maximum 100 requests per minute.',
});

/**
 * Strict auth rate limiter: 10 requests per 60 seconds to prevent brute force.
 */
export const authRateLimiter = createRateLimiter({
  maxRequests: 10,
  windowMs: 60 * 1000,
  message: 'Too many authentication attempts. Please wait 60 seconds.',
});

/**
 * Strict onboarding rate limiter: 5 tenant creation requests per 60 seconds.
 */
export const onboardingRateLimiter = createRateLimiter({
  maxRequests: 5,
  windowMs: 60 * 1000,
  message: 'Too many onboarding requests. Please wait before creating another tenant.',
});
