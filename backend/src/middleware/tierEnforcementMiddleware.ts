import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

/**
 * Express middleware factory to restrict features based on tenant customization tier.
 * Tiers:
 * - Tier 1: User-Level Configuration (Self-Service)
 * - Tier 2: Functional Customization (Configurable) - e.g. Custom Fields
 * - Tier 3: Advanced Extension (Headless/API-Driven) - e.g. Custom Modules, API Access
 */
export function requireCustomizationTier(requiredTier: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const context = req.tenantContext;
    if (!context) {
      res.status(400).json({
        error: 'Missing Tenant Context',
        message: 'This endpoint requires an active tenant context to enforce customization tier restrictions.',
      });
      return;
    }

    const currentTier = context.tenantTier !== undefined ? context.tenantTier : 1;

    if (currentTier < requiredTier) {
      logger.warn('Customization tier block', {
        requestId: req.headers['x-request-id'] as string,
        tenantSlug: context.tenantSlug,
        currentTier,
        requiredTier,
        path: req.originalUrl,
      });

      res.status(403).json({
        error: 'Customization Tier Restriction',
        message: `This operation requires Customization Tier ${requiredTier} or higher. Your business is currently on Tier ${currentTier}.`,
        currentTier,
        requiredTier,
      });
      return;
    }

    next();
  };
}
