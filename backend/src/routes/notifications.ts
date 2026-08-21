import { Router, Request, Response } from 'express';
import { prisma } from '../config/db';
import { withCurrentTenantDb } from '../database/tenantClient';
import { authenticateJwt } from '../middleware/authMiddleware';
import { tenantContextMiddleware } from '../middleware/tenantContextMiddleware';
import { requireTenantContext } from '../context/tenantContext';
import {
  getCachedNotifications,
  setCachedNotifications,
  invalidateNotificationCache,
  invalidateAllNotificationCaches,
} from '../cache/notificationCache';

const router = Router();

router.use(authenticateJwt);
router.use(tenantContextMiddleware);

/**
 * GET /api/v1/notifications
 * Fetches notifications for the active user/tenant.
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const userId = (req as any).user?.id;

    type NotifPayload = { notifications: any[]; unreadCount: number };
    const cached = await getCachedNotifications<NotifPayload>(tenantId, userId);
    if (cached) {
      res.status(200).json({ success: true, data: cached });
      return;
    }

    const notifications = await withCurrentTenantDb(prisma, async (client) => {
      return (client as any).notification.findMany({
        where: {
          tenantId,
          OR: [{ userId: null }, { userId }],
        },
        orderBy: { createdAt: 'desc' },
        take: 30,
      });
    });

    const unreadCount = notifications.filter((n: any) => !n.read).length;
    const payload: NotifPayload = { notifications, unreadCount };

    void setCachedNotifications(tenantId, userId, payload);
    res.status(200).json({ success: true, data: payload });
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
    const { tenantId } = requireTenantContext();
    const { title, message, type = 'SYSTEM', link, userId } = req.body;

    if (!title || !message) {
      res.status(400).json({ success: false, error: 'Title and message are required.' });
      return;
    }

    const created = await withCurrentTenantDb(prisma, async (client) => {
      return (client as any).notification.create({
        data: {
          tenantId,
          title,
          message,
          type,
          link,
          userId: userId || null,
        },
      });
    });

    // Broadcast notification: wipe all per-user caches for this tenant
    void invalidateAllNotificationCaches(tenantId);
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
    const { tenantId } = requireTenantContext();
    const { id } = req.params;
    const userId = (req as any).user?.id;

    const updated = await withCurrentTenantDb(prisma, async (client) => {
      const existing = await (client as any).notification.findFirst({
        where: { id, tenantId, OR: [{ userId: null }, { userId }] },
      });
      if (!existing) {
        throw new Error('Notification not found.');
      }

      return (client as any).notification.update({
        where: { id },
        data: { read: true },
      });
    });

    void invalidateNotificationCache(tenantId, userId);
    res.status(200).json({ success: true, data: { notification: updated } });
  } catch (error: any) {
    console.error('[Notifications] Error marking notification as read:', error);
    if (error.message === 'Notification not found.') {
      res.status(404).json({ success: false, error: error.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to update notification.' });
  }
});

/**
 * PUT /api/v1/notifications/read-all
 * Marks all notifications as read.
 */
router.put('/read-all', async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const userId = (req as any).user?.id;

    await withCurrentTenantDb(prisma, async (client) => {
      return (client as any).notification.updateMany({
        where: {
          tenantId,
          read: false,
          OR: [{ userId: null }, { userId }],
        },
        data: { read: true },
      });
    });

    void invalidateNotificationCache(tenantId, userId);
    res.status(200).json({ success: true, message: 'All notifications marked as read' });
  } catch (error: any) {
    console.error('[Notifications] Error marking all as read:', error);
    res.status(500).json({ success: false, error: 'Failed to mark all as read.' });
  }
});

export default router;
