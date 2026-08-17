import { Router, Request, Response } from 'express';
import { prisma } from '../config/db';
import { runMigrationsForSchema, runAllTenantMigrations } from '../database/tenantMigrationRunner';
import { authenticateJwt } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/rbacMiddleware';

const router = Router();

// Platform-level operation across tenant schemas - requires an authenticated
// platform Admin, but not tenantContextMiddleware (it isn't scoped to one tenant).
router.use(authenticateJwt);

/**
 * POST /api/v1/admin/migrations/run
 * Runs pending multi-tenant schema migrations.
 * Accepts optional JSON body `{ tenantSchema: "tenant_acme" }` or `{ allTenants: true }`.
 */
router.post('/run', requireRole('Admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantSchema, allTenants } = req.body || {};

    if (tenantSchema) {
      const result = await runMigrationsForSchema(prisma, tenantSchema);
      res.status(200).json({
        success: true,
        message: `Migrations applied successfully for schema ${result?.schemaName || tenantSchema}`,
        data: result,
      });
      return;
    }

    if (allTenants || !tenantSchema) {
      const results = await runAllTenantMigrations(prisma);
      res.status(200).json({
        success: true,
        message: `Migrations applied across ${(results || []).length} tenant schemas`,
        data: results,
      });
      return;
    }
  } catch (error: any) {
    console.error('[Migration API Error]:', error);
    res.status(500).json({
      success: false,
      error: 'Migration Execution Failed',
      message: error.message || 'An error occurred while running tenant migrations.',
    });
  }
});

export default router;
