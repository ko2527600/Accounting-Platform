import { Router, Request, Response } from 'express';
import { prisma } from '../config/db';
import { authenticateJwt } from '../middleware/authMiddleware';
import { BroadcastService } from '../services/broadcastService';

const router = Router();

// ComplianceUpdate is platform-wide (no tenantId - the same GRA/tax rules
// apply to every tenant), so reads only need an authenticated user (any
// tenant), while writes are gated by the platform admin passcode rather than
// a per-tenant Admin role - see the model comment in schema.prisma for why.

/**
 * GET /api/v1/compliance/last-update
 * The single most recent compliance verification event - the "last
 * compliance update" timestamp Settings/Reports display.
 */
router.get('/last-update', authenticateJwt, async (_req: Request, res: Response): Promise<void> => {
  try {
    const latest = await prisma.complianceUpdate.findFirst({ orderBy: { verifiedAt: 'desc' } });
    res.status(200).json({ success: true, data: latest });
  } catch (error: any) {
    console.error('[Compliance] Error fetching last update:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch compliance status.' });
  }
});

/**
 * GET /api/v1/compliance/updates
 * Full verification history, most recent first - lets a tenant confirm the
 * claim is backed by real, dated records rather than a single unauditable line.
 */
router.get('/updates', authenticateJwt, async (_req: Request, res: Response): Promise<void> => {
  try {
    const updates = await prisma.complianceUpdate.findMany({ orderBy: { verifiedAt: 'desc' }, take: 100 });
    res.status(200).json({ success: true, data: updates });
  } catch (error: any) {
    console.error('[Compliance] Error listing updates:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch compliance history.' });
  }
});

/**
 * POST /api/v1/compliance/updates (platform admin passcode required)
 * Records a new compliance verification event. Not exposed to tenant Admins
 * - this is platform-wide data every tenant sees, so only the same passcode
 * gate as AdminCoreEngine's other platform-wide actions can write it.
 */
router.post('/updates', async (req: Request, res: Response): Promise<void> => {
  try {
    const { passcode, source, area, description, verifiedAt, verifiedBy } = req.body;

    if (!passcode || !BroadcastService.verifyPasscode(passcode)) {
      res.status(401).json({ success: false, error: 'Unauthorized: valid master passcode required.' });
      return;
    }
    if (!source || !area || !description || !verifiedAt) {
      res.status(400).json({ success: false, error: 'source, area, description, and verifiedAt are required.' });
      return;
    }
    const parsedDate = new Date(verifiedAt);
    if (isNaN(parsedDate.getTime())) {
      res.status(400).json({ success: false, error: 'Invalid verifiedAt date.' });
      return;
    }

    const created = await prisma.complianceUpdate.create({
      data: {
        source: String(source).trim(),
        area: String(area).trim(),
        description: String(description).trim(),
        verifiedAt: parsedDate,
        verifiedBy: verifiedBy ? String(verifiedBy).trim() : null,
      },
    });

    res.status(201).json({ success: true, data: created });
  } catch (error: any) {
    console.error('[Compliance] Error recording update:', error);
    res.status(500).json({ success: false, error: 'Failed to record compliance update.' });
  }
});

export default router;
