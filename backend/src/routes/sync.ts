import { Router, Request, Response } from 'express';
import { prisma } from '../config/db';
import { withCurrentTenantDb } from '../database/tenantClient';
import { authenticateJwt } from '../middleware/authMiddleware';
import { tenantContextMiddleware } from '../middleware/tenantContextMiddleware';
import { requireTenantContext } from '../context/tenantContext';
import * as accountRepository from '../repository/accountRepository';
import { getCurrentSequence, getChangesSince } from '../services/syncChangeLogService';

const router = Router();

router.use(authenticateJwt);
router.use(tenantContextMiddleware);

/**
 * GET /api/v1/sync/bootstrap
 * Full current-state snapshot of every syncable entity (local-first sync
 * pilot: Chart of Accounts + Invoices - see STATUS.md), for a device's first
 * login or a from-scratch resync. Pairs with GET /sync/changes for ongoing
 * catch-up so a client never has to re-fetch everything on every login.
 */
router.get('/bootstrap', async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();

    const { accounts, invoices, sequence } = await withCurrentTenantDb(prisma, async (client) => {
      const [accountRows, invoiceRows, seq] = await Promise.all([
        accountRepository.listAccounts(client),
        (client as any).invoice.findMany({
          where: { tenantId },
          include: { customer: true, items: true },
          orderBy: { createdAt: 'desc' },
        }),
        getCurrentSequence(client, tenantId),
      ]);
      return { accounts: accountRows, invoices: invoiceRows, sequence: seq };
    });

    res.status(200).json({
      success: true,
      data: {
        sequence: sequence.toString(),
        accounts,
        invoices,
      },
    });
  } catch (error: any) {
    console.error('[Sync] Error building bootstrap snapshot:', error);
    res.status(500).json({ success: false, error: 'Failed to build sync bootstrap snapshot.' });
  }
});

/**
 * GET /api/v1/sync/changes?since=<sequence>
 * Everything appended to this tenant's change log after `since`, oldest
 * first - what a client applies, in order, to catch up after being offline
 * or backgrounded. `since=0` (or omitted) returns the tenant's entire
 * history, which is unbounded in principle but in practice never larger
 * than what GET /sync/bootstrap already covers for a fresh device, so real
 * callers always pass a real cursor from their last bootstrap/changes call.
 */
router.get('/changes', async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();

    const sinceRaw = typeof req.query.since === 'string' ? req.query.since : '0';
    if (!/^\d+$/.test(sinceRaw)) {
      res.status(400).json({ success: false, error: '"since" must be a non-negative integer sequence number.' });
      return;
    }
    const since = BigInt(sinceRaw);

    const changes = await withCurrentTenantDb(prisma, async (client) => {
      return getChangesSince(client, tenantId, since);
    });

    const newSequence = changes.length > 0 ? changes[changes.length - 1].sequence : sinceRaw;

    res.status(200).json({
      success: true,
      data: {
        sequence: newSequence,
        changes,
      },
    });
  } catch (error: any) {
    console.error('[Sync] Error fetching changes:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch sync changes.' });
  }
});

export default router;
