import { Router, Request, Response } from 'express';
import { authenticateJwt } from '../middleware/authMiddleware';
import { tenantContextMiddleware } from '../middleware/tenantContextMiddleware';
import { helpAssistantRateLimiter } from '../middleware/rateLimiterMiddleware';
import * as helpAssistantService from '../services/helpAssistantService';
import { HelpAssistantServiceError } from '../services/helpAssistantService';

const router = Router();

router.use(authenticateJwt);
router.use(tenantContextMiddleware);

/**
 * GET /api/v1/help-assistant/status
 * Whether the Help Assistant is configured for this environment - the
 * frontend widget checks this once to decide whether to show a real chat
 * or a "not set up yet" message, instead of discovering it on the first
 * failed send.
 */
router.get('/status', async (_req: Request, res: Response): Promise<void> => {
  res.status(200).json({ success: true, data: { configured: helpAssistantService.isHelpAssistantConfigured() } });
});

/**
 * POST /api/v1/help-assistant/chat
 * One turn of the help conversation. Every tool the assistant can use
 * forwards THIS request's own Authorization/tenant headers, so it can
 * never see more than the calling user already can through the normal UI.
 */
router.post('/chat', helpAssistantRateLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    if (!helpAssistantService.isHelpAssistantConfigured()) {
      res.status(503).json({ success: false, error: 'Help Assistant is not configured for this environment.' });
      return;
    }

    const { message, history } = req.body || {};
    const authHeader = req.headers.authorization || '';
    const tenantHeader = (req.headers['x-tenant-id'] as string) || '';

    const result = await helpAssistantService.chat(
      message,
      Array.isArray(history) ? history : [],
      authHeader,
      tenantHeader
    );

    res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    if (error instanceof HelpAssistantServiceError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
      return;
    }
    console.error('[HelpAssistant] Error:', error);
    res.status(500).json({ success: false, error: 'Help Assistant request failed.' });
  }
});

export default router;
