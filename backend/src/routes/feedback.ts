import { Router, Request, Response } from 'express';
import { prisma } from '../config/db';
import { withCurrentTenantDb } from '../database/tenantClient';
import { authenticateJwt } from '../middleware/authMiddleware';
import { tenantContextMiddleware } from '../middleware/tenantContextMiddleware';
import { requireRole } from '../middleware/rbacMiddleware';
import { requireTenantContext } from '../context/tenantContext';

const router = Router();

const CATEGORIES = ['GENERAL', 'BUG', 'FEATURE_REQUEST'];

router.use(authenticateJwt);
router.use(tenantContextMiddleware);

/**
 * POST /api/v1/feedback
 * Submits a feedback item. Open to every role - unlike most write routes
 * in this app, feedback isn't an operational action gated to a role's
 * scope, it's every user's channel to reach the tenant's Admin/Auditor.
 */
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const user = req.user!;
    const { message, category = 'GENERAL' } = req.body || {};

    const trimmedMessage = typeof message === 'string' ? message.trim() : '';
    if (!trimmedMessage) {
      res.status(400).json({ success: false, error: 'Message is required.' });
      return;
    }
    if (!CATEGORIES.includes(category)) {
      res.status(400).json({ success: false, error: `Category must be one of: ${CATEGORIES.join(', ')}.` });
      return;
    }

    const created = await withCurrentTenantDb(prisma, async (client) => {
      return (client as any).feedback.create({
        data: {
          tenantId,
          userId: user.id,
          userName: user.name || user.email,
          userRole: user.role,
          category,
          message: trimmedMessage,
        },
      });
    });

    res.status(201).json({ success: true, message: 'Feedback submitted', data: { feedback: created } });
  } catch (error: any) {
    console.error('[Feedback] Error submitting feedback:', error);
    res.status(500).json({ success: false, error: 'Failed to submit feedback.' });
  }
});

/**
 * GET /api/v1/feedback
 * Lists feedback for the tenant. Admin/Auditor only - same review-screen
 * access level as GET /help-assistant/conversations.
 */
router.get('/', requireRole('Auditor'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20));
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;

    const where = { tenantId, ...(status ? { status } : {}) };

    const { items, total } = await withCurrentTenantDb(prisma, async (client) => {
      const [items, total] = await Promise.all([
        (client as any).feedback.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        (client as any).feedback.count({ where }),
      ]);
      return { items, total };
    });

    res.status(200).json({
      success: true,
      data: {
        feedback: items,
        pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
      },
    });
  } catch (error: any) {
    console.error('[Feedback] Error listing feedback:', error);
    res.status(500).json({ success: false, error: 'Failed to retrieve feedback.' });
  }
});

/**
 * PUT /api/v1/feedback/:id/status
 * Marks a feedback item reviewed/new. Admin/Auditor only.
 */
router.put('/:id/status', requireRole('Auditor'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const { id } = req.params;
    const { status } = req.body || {};

    if (status !== 'NEW' && status !== 'REVIEWED') {
      res.status(400).json({ success: false, error: 'Status must be NEW or REVIEWED.' });
      return;
    }

    const updated = await withCurrentTenantDb(prisma, async (client) => {
      const existing = await (client as any).feedback.findFirst({ where: { id, tenantId } });
      if (!existing) {
        throw new Error('Feedback not found.');
      }
      return (client as any).feedback.update({ where: { id }, data: { status } });
    });

    res.status(200).json({ success: true, data: { feedback: updated } });
  } catch (error: any) {
    console.error('[Feedback] Error updating feedback status:', error);
    if (error.message === 'Feedback not found.') {
      res.status(404).json({ success: false, error: error.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to update feedback.' });
  }
});

export default router;
