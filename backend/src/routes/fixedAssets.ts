import { Router, Request, Response } from 'express';
import { authenticateJwt } from '../middleware/authMiddleware';
import { tenantContextMiddleware } from '../middleware/tenantContextMiddleware';
import { requireRole } from '../middleware/rbacMiddleware';
import { requireTenantContext } from '../context/tenantContext';
import * as fixedAssetService from '../services/fixedAssetService';
import { FixedAssetServiceError } from '../services/fixedAssetService';
import { actorFromRequest } from '../services/auditLogService';

const router = Router();

router.use(authenticateJwt);
router.use(tenantContextMiddleware);

router.get('/', requireRole('Viewer'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const assets = await fixedAssetService.listFixedAssets(tenantId);
    res.status(200).json({ success: true, data: { assets } });
  } catch (error: any) {
    console.error('[FixedAssets] Error listing:', error);
    res.status(500).json({ success: false, error: 'Failed to retrieve fixed assets.' });
  }
});

router.get('/:id', requireRole('Viewer'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const asset = await fixedAssetService.getFixedAssetById(tenantId, req.params.id);
    res.status(200).json({ success: true, data: { asset } });
  } catch (error: any) {
    if (error instanceof FixedAssetServiceError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
      return;
    }
    console.error('[FixedAssets] Error retrieving:', error);
    res.status(500).json({ success: false, error: 'Failed to retrieve fixed asset.' });
  }
});

router.post('/', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const {
      name, category, serialNumber, acquisitionDate, cost, residualValue,
      depreciationMethod, usefulLifeMonths, depreciationRatePercent,
      assetAccountId, paymentAccountId, notes,
    } = req.body;

    const result = await fixedAssetService.createFixedAsset(
      tenantId,
      {
        name, category, serialNumber, acquisitionDate, cost, residualValue,
        depreciationMethod, usefulLifeMonths, depreciationRatePercent,
        assetAccountId, paymentAccountId, notes,
      },
      actorFromRequest(req)
    );

    res.status(201).json({
      success: true,
      message: 'Fixed asset created and acquisition posted.',
      data: { asset: result.asset },
    });
  } catch (error: any) {
    if (error instanceof FixedAssetServiceError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
      return;
    }
    console.error('[FixedAssets] Error creating:', error);
    res.status(500).json({ success: false, error: 'Failed to create fixed asset.' });
  }
});

/**
 * PUT /api/v1/fixed-assets/:id/dispose
 * Marks a fixed asset disposed, stopping all further depreciation. No
 * write-off/gain-or-loss journal entry in this pass - see
 * fixedAssetService.disposeFixedAsset's own doc comment.
 */
router.put('/:id/dispose', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const { disposalDate, notes } = req.body;
    const asset = await fixedAssetService.disposeFixedAsset(tenantId, req.params.id, disposalDate, notes);
    res.status(200).json({ success: true, message: 'Fixed asset marked disposed.', data: { asset } });
  } catch (error: any) {
    if (error instanceof FixedAssetServiceError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
      return;
    }
    console.error('[FixedAssets] Error disposing:', error);
    res.status(500).json({ success: false, error: 'Failed to dispose fixed asset.' });
  }
});

export default router;
