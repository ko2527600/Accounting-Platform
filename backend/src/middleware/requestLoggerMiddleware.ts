import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { logger } from '../utils/logger';

/**
 * Injects a unique X-Request-ID header into every request and logs
 * method, path, tenant slug, response status code, and duration (ms).
 */
export function requestLoggerMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = (req.headers['x-request-id'] as string) || randomUUID();
  const startAt = process.hrtime.bigint();

  // Propagate correlation ID downstream and in the response headers
  req.headers['x-request-id'] = requestId;
  res.setHeader('X-Request-ID', requestId);

  res.on('finish', () => {
    const durationNs = process.hrtime.bigint() - startAt;
    const durationMs = Number(durationNs / BigInt(1_000_000));

    const tenantSlug = (req.headers['x-tenant-id'] as string) || req.tenantContext?.tenantSlug;

    logger.info('HTTP Request', {
      requestId,
      tenantSlug,
      method:     req.method,
      path:       req.originalUrl,
      statusCode: res.statusCode,
      durationMs,
    });
  });

  next();
}
