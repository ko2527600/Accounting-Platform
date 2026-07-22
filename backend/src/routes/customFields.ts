import { Router, Request, Response } from 'express';
import { authenticateJwt } from '../middleware/authMiddleware';
import { tenantContextMiddleware } from '../middleware/tenantContextMiddleware';
import { requireCustomizationTier } from '../middleware/tierEnforcementMiddleware';

const router = Router();

/**
 * POST /api/v1/custom-fields
 * Creates a user-defined custom field. Protected by authentication, tenant context, and Tier 2 tier check.
 */
router.post(
  '/',
  authenticateJwt,
  tenantContextMiddleware,
  requireCustomizationTier(2), // Requires Tier 2 (Functional Customization)
  async (req: Request, res: Response): Promise<void> => {
    const { entityType, fieldName, fieldType, label } = req.body;

    if (!entityType || !fieldName || !fieldType || !label) {
      res.status(400).json({
        error: 'Validation Error',
        message: 'entityType, fieldName, fieldType, and label are required fields.',
      });
      return;
    }

    // Mock successful creation response
    res.status(201).json({
      success: true,
      message: 'Custom field created successfully.',
      data: {
        id: 'cf_' + Math.random().toString(36).substr(2, 9),
        entityType,
        fieldName: fieldName.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'),
        fieldType,
        label: label.trim(),
        tenantId: req.tenantContext?.tenantId,
        createdAt: new Date().toISOString(),
      },
    });
  }
);

export default router;
