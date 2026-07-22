import { Request, Response, NextFunction } from 'express';
import { httpRequestDuration, httpRequestTotal, httpRequestErrors } from '../config/metrics';

export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    const route = req.route?.path || req.path;
    const tenantId = req.tenantContext?.tenantId || 'unknown';
    
    const labels = {
      method: req.method,
      route,
      status_code: res.statusCode.toString(),
      tenant_id: tenantId,
    };
    
    httpRequestDuration.observe(labels, duration);
    httpRequestTotal.inc(labels);
    
    if (res.statusCode >= 400) {
      httpRequestErrors.inc(labels);
    }
  });
  
  next();
}
