import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { cacheUtils } from '../config/redis';

interface RateLimitOptions {
  /** Max requests allowed in the window */
  maxRequests: number;
  /** Window duration in milliseconds */
  windowMs: number;
  /** Human-readable message returned on 429 */
  message?: string;
}

/**
 * Redis-based rate limiter for distributed systems
 * Uses atomic INCR and EXPIRE operations to track request counts
 * Shares state across multiple server instances
 */
function createRateLimiter(options: RateLimitOptions) {
  return async function rateLimiterMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    // Bypass rate limiting in test environments to avoid test setup interference
    if (process.env.NODE_ENV === 'test') {
      return next();
    }

    const tenantId = req.headers['x-tenant-id'] as string | undefined;
    const ip = req.ip || req.socket.remoteAddress || 'unknown';

    // Key = per-tenant if available, otherwise per-IP
    const identifier = tenantId ? `tenant:${tenantId}` : `ip:${ip}`;
    const cacheKey = `rate_limit:${identifier}`;
    const now = Date.now();
    const windowSeconds = Math.ceil(options.windowMs / 1000);

    try {
      // Atomic increment with TTL (Redis ensures atomicity)
      const count = await cacheUtils.incr(cacheKey, windowSeconds);

      if (count <= options.maxRequests) {
        // Within rate limit
        next();
        return;
      }

      // Rate limit exceeded
      const retryAfterSec = windowSeconds;

      logger.warn('Rate limit exceeded', {
        key: identifier,
        path: req.originalUrl,
        method: req.method,
        count,
        limit: options.maxRequests,
      });

      res.setHeader('Retry-After', String(retryAfterSec));
      res.setHeader('X-RateLimit-Limit', String(options.maxRequests));
      res.setHeader('X-RateLimit-Remaining', String(Math.max(0, options.maxRequests - count)));
      res.setHeader('X-RateLimit-Reset', String(Math.ceil(now / 1000) + retryAfterSec));

      res.status(429).json({
        error: 'Too Many Requests',
        message: options.message || `Rate limit exceeded. Try again in ${retryAfterSec}s.`,
        retryAfterSeconds: retryAfterSec,
        limit: options.maxRequests,
        windowSeconds,
      });
    } catch (error: any) {
      // Graceful degradation: If Redis is down, allow the request
      // Log the error but don't block legitimate traffic
      logger.error('Rate limiter Redis error - allowing request', {
        key: identifier,
        error: error.message,
        path: req.originalUrl,
      });
      next();
    }
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
