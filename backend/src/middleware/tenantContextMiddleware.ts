import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/db';
import { runWithTenantContext, TenantContextData } from '../context/tenantContext';
import { sanitizeSchemaName } from '../database/tenantSchemaManager';
import { ensureTenantSchemaMigrated } from '../database/tenantMigrationRunner';
import { getTenantFromCache, setTenantInCache } from '../cache/tenantCache';

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
 * Express Middleware to resolve tenant context from request headers (`X-Tenant-ID`, `X-Tenant-Slug`, `X-Tenant-Schema`)
 * or authenticated user context.
 * Performs tenant registration verification in public.tenants, ensures schema existence & auto-migration provisioning,
 * and sets up strict AsyncLocalStorage tenant context propagation for downstream handlers.
 */
export function createTenantContextMiddleware(options: TenantMiddlewareOptions = {}) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const rawIdentifier = (
      req.headers['x-tenant-id'] ||
      req.headers['x-tenant-slug'] ||
      req.headers['x-tenant-schema']
    ) as string | undefined;

    if (!rawIdentifier) {
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
      let sanitizedSchema: string | null = null;
      try {
        sanitizedSchema = sanitizeSchemaName(rawIdentifier);
      } catch {
        // Continue lookup even if raw string isn't a direct valid schema name
      }

      // Check Redis cache first (async)
      let tenant = await getTenantFromCache(rawIdentifier);
      
      // If not found by primary identifier, try sanitized schema name
      if (!tenant && sanitizedSchema && sanitizedSchema !== rawIdentifier) {
        tenant = await getTenantFromCache(sanitizedSchema);
      }

      if (!tenant) {
        // Cache miss - verify tenant registration in public.tenants
        const dbTenant = await prisma.tenant.findFirst({
          where: {
            OR: [
              { id: rawIdentifier },
              { slug: rawIdentifier },
              { schema: rawIdentifier },
              ...(sanitizedSchema ? [{ schema: sanitizedSchema }] : []),
            ],
          },
        });

        if (!dbTenant) {
          if (options.optional) {
            return next();
          }
          res.status(404).json({
            error: 'Tenant Not Found',
            message: `Tenant with identifier "${rawIdentifier}" is not registered.`,
          });
          return;
        }

        tenant = dbTenant;
        
        // Store in Redis cache (fire and forget)
        setTenantInCache(rawIdentifier, dbTenant);
      }

      // 2. Automatic schema existence check & auto-migration provisioning
      await ensureTenantSchemaMigrated(prisma, tenant.schema, tenant.id);

      // 3. Construct strict tenant context object
      const tenantContext: TenantContextData = {
        tenantId: tenant.id,
        tenantSchema: tenant.schema,
        tenantName: tenant.name,
        tenantSlug: tenant.slug,
        tenantTier: tenant.tier,
      };

      // Attach context to request object
      req.tenantContext = tenantContext;

      // 4. Propagate context via AsyncLocalStorage for downstream service execution
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

