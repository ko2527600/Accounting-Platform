import { Router, Request, Response } from 'express';
import { BroadcastService } from '../services/broadcastService';
import * as gaService from '../services/googleAnalyticsService';

const router = Router();

/**
 * GET /api/v1/admin/analytics
 * Returns GA4 traffic data for the Core Control Engine.
 * Passcode-gated — same mechanism as all other /admin routes.
 *
 * Query params:
 *   days  — lookback window in days (default: 28, max: 90)
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const passcode = (req.headers['x-admin-passcode'] as string | undefined) ?? '';
  if (!BroadcastService.verifyPasscode(passcode)) {
    res.status(401).json({ success: false, error: 'Invalid master passcode.' });
    return;
  }

  const days = Math.min(90, Math.max(1, Number(req.query.days) || 28));

  try {
    const data = await gaService.getAnalyticsOverview(days);
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message ?? 'Failed to fetch analytics.' });
  }
});

export default router;
