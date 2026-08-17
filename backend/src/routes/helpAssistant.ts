import { Router, Request, Response } from 'express';
import { prisma } from '../config/db';
import { authenticateJwt } from '../middleware/authMiddleware';
import { tenantContextMiddleware } from '../middleware/tenantContextMiddleware';
import { requireRole } from '../middleware/rbacMiddleware';
import { helpAssistantRateLimiter } from '../middleware/rateLimiterMiddleware';
import { requireTenantContext } from '../context/tenantContext';
import * as helpAssistantService from '../services/helpAssistantService';
import { HelpAssistantServiceError } from '../services/helpAssistantService';
import { logConversation, listConversationsForTenant } from '../repository/helpAssistantConversationRepository';

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
    const { message, history } = req.body || {};
    const { tenantId } = requireTenantContext();
    const user = req.user!;

    if (!helpAssistantService.isHelpAssistantConfigured()) {
      res.status(503).json({ success: false, error: 'Help Assistant is not configured for this environment.' });
      return;
    }

    const authHeader = req.headers.authorization || '';
    const tenantHeader = (req.headers['x-tenant-id'] as string) || '';

    let result;
    try {
      result = await helpAssistantService.chat(message, Array.isArray(history) ? history : [], authHeader, tenantHeader);
    } catch (chatError: any) {
      // Log real conversation failures (a lookup was denied, Anthropic
      // itself errored, the assistant gave up after too many tool calls) -
      // these are exactly the turns the daily review queue exists to
      // surface. A plain "message is required" (400) never reached the
      // assistant at all, so it isn't a real conversation attempt worth
      // logging.
      if (chatError instanceof HelpAssistantServiceError && chatError.statusCode !== 400 && typeof message === 'string' && message.trim()) {
        await logConversation(prisma, {
          tenantId,
          userId: user.id,
          userEmail: user.email,
          userMessage: message.trim(),
          assistantReply: '',
          toolsUsed: [],
          flagged: true,
          flagReason: chatError.message,
        });
      }
      throw chatError;
    }

    await logConversation(prisma, {
      tenantId,
      userId: user.id,
      userEmail: user.email,
      userMessage: message.trim(),
      assistantReply: result.reply,
      toolsUsed: result.toolsUsed,
      flagged: result.hadToolError,
      flagReason: result.hadToolError ? 'A tool lookup was denied or failed during this turn.' : null,
    });

    res.status(200).json({ success: true, data: { reply: result.reply, history: result.history } });
  } catch (error: any) {
    if (error instanceof HelpAssistantServiceError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
      return;
    }
    console.error('[HelpAssistant] Error:', error);
    res.status(500).json({ success: false, error: 'Help Assistant request failed.' });
  }
});

/**
 * GET /api/v1/help-assistant/conversations
 * This tenant's own Help Assistant conversation history - the human side of
 * the "learn from usage" loop. Defaults to flagged-only (where a tool
 * lookup failed/was denied, or the assistant gave up) since that's what's
 * actually actionable; ?flagged=false shows everything. Never returns
 * another tenant's conversations - scoped by the same tenant context every
 * other route uses.
 */
router.get('/conversations', requireRole('Auditor'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const { limit = '50', page = '1', flagged = 'true' } = req.query;
    const take = parseInt(limit as string, 10);
    const skip = (parseInt(page as string, 10) - 1) * take;

    const { conversations, total } = await listConversationsForTenant(prisma, tenantId, {
      flaggedOnly: flagged !== 'false',
      take,
      skip,
    });

    res.status(200).json({
      success: true,
      data: {
        conversations,
        pagination: { total, page: parseInt(page as string, 10), limit: take, totalPages: Math.ceil(total / take) },
      },
    });
  } catch (error: any) {
    console.error('[HelpAssistant] Error fetching conversations:', error);
    res.status(500).json({ success: false, error: 'Failed to retrieve Help Assistant conversations.' });
  }
});

export default router;
