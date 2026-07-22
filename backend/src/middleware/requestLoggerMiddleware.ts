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

  // W3C traceparent header extraction (00-traceid-spanid-traceflags)
  const traceparent = (req.headers['traceparent'] as string) || undefined;
  let traceId: string | undefined;
  let spanId: string | undefined;

  if (traceparent) {
    const parts = traceparent.split('-');
    if (parts.length >= 4) {
      traceId = parts[1];
      spanId = parts[2];
    }
  }

  // Propagate correlation ID downstream and in response headers
  req.headers['x-request-id'] = requestId;
  res.setHeader('X-Request-ID', requestId);
  if (traceparent) {
    res.setHeader('traceparent', traceparent);
  }

  res.on('finish', () => {
    const durationNs = process.hrtime.bigint() - startAt;
    const durationMs = Number(durationNs / BigInt(1_000_000));

    const tenantSlug = (req.headers['x-tenant-id'] as string) || req.tenantContext?.tenantSlug;

    logger.info('HTTP Request', {
      requestId,
      ...(traceId ? { traceId } : {}),
      ...(spanId ? { spanId } : {}),
      tenantSlug,
      method:     req.method,
      path:       req.originalUrl,
      statusCode: res.statusCode,
      durationMs,
    });
  });

  next();
}
