import { Router, Request, Response } from 'express';
import { BroadcastService } from '../services/broadcastService';

const router = Router();

/**
 * POST /api/v1/admin/broadcast/verify-passcode
 * Validates master passcode before opening Admin Broadcast Console.
 */
router.post('/verify-passcode', async (req: Request, res: Response): Promise<void> => {
  try {
    const { passcode } = req.body;

    if (!passcode) {
      res.status(400).json({ success: false, error: 'Master passcode is required.' });
      return;
    }

    const isValid = BroadcastService.verifyPasscode(passcode);

    if (isValid) {
      res.status(200).json({ success: true, message: 'Passcode verified successfully.' });
    } else {
      res.status(401).json({ success: false, error: 'Invalid master passcode. Access denied.' });
    }
  } catch (error: any) {
    console.error('[AdminBroadcast] Error verifying passcode:', error);
    res.status(500).json({ success: false, error: 'Internal server error.' });
  }
});

/**
 * POST /api/v1/admin/broadcast/send
 * Executes batch email & SMS broadcast to all tenant business owners.
 */
router.post('/send', async (req: Request, res: Response): Promise<void> => {
  try {
    const { passcode, subject, message, channel, targetTier } = req.body;

    if (!passcode || !subject || !message) {
      res.status(400).json({ success: false, error: 'Passcode, subject, and message are required.' });
      return;
    }

    if (!BroadcastService.verifyPasscode(passcode)) {
      res.status(401).json({ success: false, error: 'Unauthorized: Invalid master passcode.' });
      return;
    }

    const result = await BroadcastService.executeBroadcast({
      passcode,
      subject,
      message,
      channel: channel || 'BOTH',
      targetTier: targetTier ? Number(targetTier) : undefined,
    });

    res.status(200).json({
      success: true,
      message: 'System broadcast dispatched successfully.',
      data: result,
    });
  } catch (error: any) {
    console.error('[AdminBroadcast] Error executing broadcast:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to execute system broadcast.' });
  }
});

export default router;
