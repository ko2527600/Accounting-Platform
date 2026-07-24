import { Router, Request, Response } from 'express';
import { prisma } from '../config/db';
import { withCurrentTenantDb } from '../database/tenantClient';
import { authenticateJwt } from '../middleware/authMiddleware';
import { tenantContextMiddleware } from '../middleware/tenantContextMiddleware';

const router = Router();

router.use(authenticateJwt);
router.use(tenantContextMiddleware);

/**
 * GET /api/v1/notifications
 * Fetches notifications for the active user/tenant.
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.id;

    const notifications = await withCurrentTenantDb(prisma, async (client) => {
      return (client as any).notification.findMany({
        where: {
          OR: [{ userId: null }, { userId }],
        },
        orderBy: { createdAt: 'desc' },
        take: 30,
      });
    });

    const unreadCount = notifications.filter((n: any) => !n.read).length;

    res.status(200).json({
      success: true,
      data: { notifications, unreadCount },
    });
  } catch (error: any) {
    console.error('[Notifications] Error fetching notifications:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch notifications.' });
  }
});

/**
 * POST /api/v1/notifications
 * Creates a notification.
 */
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { title, message, type = 'SYSTEM', link, userId } = req.body;

    if (!title || !message) {
      res.status(400).json({ success: false, error: 'Title and message are required.' });
      return;
    }

    const created = await withCurrentTenantDb(prisma, async (client) => {
      return (client as any).notification.create({
        data: {
          title,
          message,
          type,
          link,
          userId: userId || null,
        },
      });
    });

    res.status(201).json({ success: true, message: 'Notification created', data: { notification: created } });
  } catch (error: any) {
    console.error('[Notifications] Error creating notification:', error);
    res.status(500).json({ success: false, error: 'Failed to create notification.' });
  }
});

/**
 * PUT /api/v1/notifications/:id/read
 * Marks a single notification as read.
 */
router.put('/:id/read', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const updated = await withCurrentTenantDb(prisma, async (client) => {
      return (client as any).notification.update({
        where: { id },
        data: { read: true },
      });
    });

    res.status(200).json({ success: true, data: { notification: updated } });
  } catch (error: any) {
    console.error('[Notifications] Error marking notification as read:', error);
    res.status(500).json({ success: false, error: 'Failed to update notification.' });
  }
});

/**
 * PUT /api/v1/notifications/read-all
 * Marks all notifications as read.
 */
router.put('/read-all', async (req: Request, res: Response): Promise<void> => {
  try {
    await withCurrentTenantDb(prisma, async (client) => {
      return (client as any).notification.updateMany({
        where: { read: false },
        data: { read: true },
      });
    });

    res.status(200).json({ success: true, message: 'All notifications marked as read' });
  } catch (error: any) {
    console.error('[Notifications] Error marking all as read:', error);
    res.status(500).json({ success: false, error: 'Failed to mark all as read.' });
  }
});

export default router;
