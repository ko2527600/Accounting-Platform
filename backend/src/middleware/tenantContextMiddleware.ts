import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/db';
import { runWithTenantContext, TenantContextData } from '../context/tenantContext';
import { sanitizeSchemaName } from '../database/tenantSchemaManager';

// Extend Express Request type to include tenantContext
declare global {
  namespace Express {
    interface Request {
      tenantContext?: TenantContextData;
    }
  }
}

export interface TenantMiddlewareOptions {
  optional?: boolean;
}

/**
 * Express Middleware to resolve tenant context from headers (`X-Tenant-ID` or `X-Tenant-Schema`).
 * Sets up AsyncLocalStorage tenant context for downstream service and database calls.
 */
export function createTenantContextMiddleware(options: TenantMiddlewareOptions = {}) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const tenantIdHeader = (req.headers['x-tenant-id'] || req.headers['x-tenant-slug']) as string | undefined;
    const tenantSchemaHeader = req.headers['x-tenant-schema'] as string | undefined;

    if (!tenantIdHeader && !tenantSchemaHeader) {
      if (options.optional) {
        return next();
      }
      res.status(400).json({
        error: 'Missing Tenant Identifier',
        message: 'Header "X-Tenant-ID", "X-Tenant-Slug", or "X-Tenant-Schema" is required for multi-tenant endpoints.',
      });
      return;
    }

    try {
      let tenantContext: TenantContextData | undefined;

      // 1. Resolve by direct schema header if provided
      if (tenantSchemaHeader) {
        const sanitizedSchema = sanitizeSchemaName(tenantSchemaHeader);
        tenantContext = {
          tenantId: tenantIdHeader || sanitizedSchema,
          tenantSchema: sanitizedSchema,
        };
      } else if (tenantIdHeader) {
        // 2. Resolve by tenant ID or slug from public database
        try {
          const tenant = await prisma.tenant.findFirst({
            where: {
              OR: [
                { id: tenantIdHeader },
                { slug: tenantIdHeader },
              ],
            },
          });

          if (tenant) {
            tenantContext = {
              tenantId: tenant.id,
              tenantSchema: tenant.schema,
              tenantName: tenant.name,
              tenantSlug: tenant.slug,
            };
          } else {
            // Fallback: derive schema name from tenant slug/id directly if DB entry not found yet
            const derivedSchema = sanitizeSchemaName(tenantIdHeader);
            tenantContext = {
              tenantId: tenantIdHeader,
              tenantSchema: derivedSchema,
            };
          }
        } catch {
          // If DB query fails, derive schema name from header
          const derivedSchema = sanitizeSchemaName(tenantIdHeader);
          tenantContext = {
            tenantId: tenantIdHeader,
            tenantSchema: derivedSchema,
          };
        }
      }

      if (!tenantContext) {
        if (options.optional) {
          return next();
        }
        res.status(404).json({
          error: 'Tenant Not Found',
          message: 'The requested tenant could not be resolved.',
        });
        return;
      }

      // Attach context to request object
      req.tenantContext = tenantContext;

      // Run next handler inside AsyncLocalStorage context
      await runWithTenantContext(tenantContext, async () => {
        next();
      });
    } catch (error: any) {
      res.status(400).json({
        error: 'Invalid Tenant Context',
        message: error.message || 'Failed to process tenant context header.',
      });
    }
  };
}

export const tenantContextMiddleware = createTenantContextMiddleware({ optional: false });
export const optionalTenantContextMiddleware = createTenantContextMiddleware({ optional: true });
