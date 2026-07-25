import { Router, Request, Response } from 'express';
import { prisma } from '../config/db';
import { withCurrentTenantDb } from '../database/tenantClient';
import { authenticateJwt } from '../middleware/authMiddleware';
import { tenantContextMiddleware } from '../middleware/tenantContextMiddleware';
import { requireCustomizationTier } from '../middleware/tierEnforcementMiddleware';
import { requireTenantContext } from '../context/tenantContext';

const router = Router();

const VALID_FIELD_TYPES = ['TEXT', 'NUMBER', 'DATE', 'BOOLEAN', 'SELECT', 'MULTI_SELECT'];

/**
 * GET /api/v1/custom-fields
 * Lists custom field definitions for the active tenant, optionally filtered by entityType.
 */
router.get(
  '/',
  authenticateJwt,
  tenantContextMiddleware,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { tenantId } = requireTenantContext();
      const { entityType } = req.query;

      const customFields = await withCurrentTenantDb(prisma, async (client) => {
        return (client as any).customField.findMany({
          where: {
            tenantId,
            ...(entityType ? { entityType: String(entityType) } : {}),
          },
          orderBy: { displayOrder: 'asc' },
        });
      });

      res.status(200).json({ success: true, data: { customFields } });
    } catch (error: any) {
      console.error('[CustomFields] Error listing custom fields:', error);
      res.status(500).json({ success: false, error: 'Failed to retrieve custom fields.' });
    }
  }
);

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
    try {
      const { tenantId } = requireTenantContext();
      const { entityType, fieldName, fieldType, label, isRequired, options, defaultValue, displayOrder } = req.body;

      if (!entityType || !fieldName || !fieldType || !label) {
        res.status(400).json({
          error: 'Validation Error',
          message: 'entityType, fieldName, fieldType, and label are required fields.',
        });
        return;
      }

      if (!VALID_FIELD_TYPES.includes(fieldType)) {
        res.status(400).json({
          error: 'Validation Error',
          message: `fieldType must be one of: ${VALID_FIELD_TYPES.join(', ')}.`,
        });
        return;
      }

      const normalizedFieldName = fieldName.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');

      const created = await withCurrentTenantDb(prisma, async (client) => {
        const existing = await (client as any).customField.findFirst({
          where: { tenantId, entityType, fieldName: normalizedFieldName },
        });
        if (existing) {
          throw new Error('DuplicateCustomField');
        }

        return (client as any).customField.create({
          data: {
            tenantId,
            entityType,
            fieldName: normalizedFieldName,
            fieldLabel: label.trim(),
            fieldType,
            isRequired: Boolean(isRequired),
            options: options ?? undefined,
            defaultValue: defaultValue ?? null,
            displayOrder: Number(displayOrder) || 0,
          },
        });
      });

      res.status(201).json({
        success: true,
        message: 'Custom field created successfully.',
        data: {
          id: created.id,
          entityType: created.entityType,
          fieldName: created.fieldName,
          fieldType: created.fieldType,
          label: created.fieldLabel,
          tenantId: created.tenantId,
          createdAt: created.createdAt,
        },
      });
    } catch (error: any) {
      if (error.message === 'DuplicateCustomField') {
        res.status(409).json({
          error: 'Duplicate Field',
          message: `A custom field named "${req.body.fieldName}" already exists for entity type "${req.body.entityType}".`,
        });
        return;
      }
      console.error('[CustomFields] Error creating custom field:', error);
      res.status(500).json({ error: 'Internal Server Error', message: 'Failed to create custom field.' });
    }
  }
);

export default router;
