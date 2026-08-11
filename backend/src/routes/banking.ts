import { Router, Request, Response } from 'express';
import { prisma } from '../config/db';
import { withCurrentTenantDb } from '../database/tenantClient';
import { authenticateJwt } from '../middleware/authMiddleware';
import { tenantContextMiddleware } from '../middleware/tenantContextMiddleware';
import { requireRole } from '../middleware/rbacMiddleware';
import { requireTenantContext } from '../context/tenantContext';
import * as monoService from '../services/monoService';
import { MonoServiceError } from '../services/monoService';
import { recordAuditLogTx, actorFromRequest, diffFields } from '../services/auditLogService';

const router = Router();

/**
 * Pulls fresh transactions and the latest balance for a linked BankAccount
 * from Mono and persists them. Shared by the manual "sync" endpoint and the
 * Mono webhook handler so both stay in sync with the same logic. Called
 * with a plain BankAccount row (not a tenant-scoped client), since the
 * webhook path has no active tenant context to filter through.
 */
async function syncAccountTransactions(bankAccount: { id: string; tenantId: string; monoAccountId: string | null; lastSyncedAt: Date | null }) {
  if (!bankAccount.monoAccountId) {
    throw new MonoServiceError('This bank account is not linked to a real Mono feed.', 400);
  }

  const [accountDetails, transactions] = await Promise.all([
    monoService.getAccountDetails(bankAccount.monoAccountId),
    monoService.getTransactions(bankAccount.monoAccountId, {
      start: bankAccount.lastSyncedAt ? bankAccount.lastSyncedAt.toISOString().split('T')[0] : undefined,
    }),
  ]);

  if (transactions.length > 0) {
    await (prisma as any).bankTransaction.createMany({
      data: transactions.map((tx) => ({
        tenantId: bankAccount.tenantId,
        bankAccountId: bankAccount.id,
        amount: tx.amount,
        payee: tx.narration,
        postedDate: new Date(tx.postedDate),
        status: 'UNRECONCILED',
        monoTransactionId: tx.monoTransactionId,
      })),
      skipDuplicates: true,
    });
  }

  return (prisma as any).bankAccount.update({
    where: { id: bankAccount.id },
    data: {
      currentBalance: accountDetails.currentBalance,
      lastSyncedAt: new Date(),
    },
  });
}

/**
 * POST /api/v1/banking/webhooks/mono
 * Mono's server-to-server webhook - no tenant JWT, verified instead via the
 * mono-webhook-secret header. Must come before the authenticateJwt/
 * tenantContextMiddleware gate below, which only applies to the
 * tenant-facing routes.
 */
router.post('/webhooks/mono', async (req: Request, res: Response): Promise<void> => {
  if (!monoService.verifyWebhookSecret(req.headers['mono-webhook-secret'] as string | undefined)) {
    res.status(401).json({ success: false, error: 'Invalid webhook secret.' });
    return;
  }

  try {
    const { event, data } = req.body;
    if (event === 'mono.events.account_connected' || event === 'mono.events.account_updated') {
      const monoAccountId = data?.id;
      const bankAccount = await (prisma as any).bankAccount.findUnique({ where: { monoAccountId } });
      if (bankAccount) {
        await syncAccountTransactions(bankAccount);
      }
    }
    res.status(200).json({ success: true });
  } catch (error: any) {
    console.error('[Banking] Error processing Mono webhook:', error);
    // Still acknowledge with 2xx per Mono's requirements; the sync will
    // simply be retried on the next webhook event or manual sync.
    res.status(200).json({ success: false });
  }
});

router.use(authenticateJwt);
router.use(tenantContextMiddleware);

/**
 * GET /api/v1/banking/accounts
 * Retrieves all linked bank accounts for the tenant.
 */
router.get('/accounts', async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const bankAccounts = await withCurrentTenantDb(prisma, async (client) => {
      return (client as any).bankAccount.findMany({
        where: { tenantId, isActive: true },
        orderBy: { createdAt: 'desc' },
      });
    });

    res.status(200).json({
      success: true,
      data: { bankAccounts },
    });
  } catch (error: any) {
    console.error('[Banking] Error fetching bank accounts:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve bank accounts.',
    });
  }
});

/**
 * POST /api/v1/banking/connect
 * Links a real bank account feed via Mono Connect. Expects `monoCode`, the
 * one-time code returned by the frontend Connect widget. Returns 503
 * (not a fake success) if MONO_SECRET_KEY isn't configured - no demo-data
 * fallback.
 */
router.post('/connect', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const { monoCode } = req.body;

    if (!monoService.isMonoConfigured()) {
      res.status(503).json({
        success: false,
        error: 'Bank feed integration is not configured for this environment.',
      });
      return;
    }

    if (!monoCode) {
      res.status(400).json({
        success: false,
        error: 'A Mono authorization code (monoCode) is required.',
      });
      return;
    }

    const monoAccountId = await monoService.exchangeCodeForAccountId(monoCode);
    const accountDetails = await monoService.getAccountDetails(monoAccountId);

    const createdAccount = await withCurrentTenantDb(prisma, async (client) => {
      const createdAccount = await (client as any).bankAccount.create({
        data: {
          tenantId,
          accountName: accountDetails.accountName,
          bankName: accountDetails.institutionName,
          institutionName: accountDetails.institutionName,
          accountNumber: accountDetails.accountNumber.slice(-4),
          currency: accountDetails.currency,
          currentBalance: accountDetails.currentBalance,
          monoAccountId,
        },
      });

      await recordAuditLogTx(client, {
        action: 'BANK_ACCOUNT.CONNECTED',
        entity: 'BankAccount',
        entityId: createdAccount.id,
        actor: actorFromRequest(req),
        details: `Bank account "${createdAccount.accountName}" (${createdAccount.bankName}) connected via Mono.`,
      });

      return createdAccount;
    });

    await syncAccountTransactions(createdAccount);

    res.status(201).json({
      success: true,
      message: 'Bank account connected successfully',
      data: { bankAccount: createdAccount },
    });
  } catch (error: any) {
    console.error('[Banking] Error connecting bank account:', error);
    if (error instanceof MonoServiceError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
      return;
    }
    res.status(500).json({
      success: false,
      error: 'Failed to connect bank account.',
    });
  }
});

/**
 * POST /api/v1/banking/accounts/:id/sync
 * Manually pulls fresh transactions and balance from Mono for a linked
 * account - what the frontend's "Sync Feeds" button actually calls now,
 * instead of just re-reading the same local rows.
 */
router.post('/accounts/:id/sync', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const { id } = req.params;

    if (!monoService.isMonoConfigured()) {
      res.status(503).json({
        success: false,
        error: 'Bank feed integration is not configured for this environment.',
      });
      return;
    }

    const bankAccount = await withCurrentTenantDb(prisma, async (client) => {
      return (client as any).bankAccount.findFirst({ where: { id, tenantId } });
    });

    if (!bankAccount) {
      res.status(404).json({ success: false, error: 'Bank account not found.' });
      return;
    }

    const updated = await syncAccountTransactions(bankAccount);

    res.status(200).json({
      success: true,
      message: 'Bank feed synced successfully.',
      data: { bankAccount: updated },
    });
  } catch (error: any) {
    console.error('[Banking] Error syncing bank account:', error);
    if (error instanceof MonoServiceError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to sync bank feed.' });
  }
});

/**
 * GET /api/v1/banking/transactions
 * Retrieves bank statement lines for reconciliation.
 */
router.get('/transactions', async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const transactions = await withCurrentTenantDb(prisma, async (client) => {
      return (client as any).bankTransaction.findMany({
        where: { tenantId },
        orderBy: { postedDate: 'desc' },
        include: { bankAccount: true },
      });
    });

    res.status(200).json({
      success: true,
      data: { transactions },
    });
  } catch (error: any) {
    console.error('[Banking] Error fetching bank transactions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve bank transactions.',
    });
  }
});

/**
 * POST /api/v1/banking/reconcile
 * Matches a bank transaction with a ledger entry.
 */
router.post('/reconcile', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const { transactionId, ledgerId } = req.body;

    if (!transactionId) {
      res.status(400).json({
        success: false,
        error: 'Bank transactionId is required.',
      });
      return;
    }

    const updatedTx = await withCurrentTenantDb(prisma, async (client) => {
      const existing = await (client as any).bankTransaction.findFirst({ where: { id: transactionId, tenantId } });
      if (!existing) {
        throw new Error('Bank transaction not found.');
      }

      const updated = await (client as any).bankTransaction.update({
        where: { id: transactionId },
        data: {
          status: 'RECONCILED',
          ledgerId: ledgerId || undefined,
        },
      });

      await recordAuditLogTx(client, {
        action: 'BANK_TRANSACTION.RECONCILED',
        entity: 'BankTransaction',
        entityId: transactionId,
        actor: actorFromRequest(req),
        changes: diffFields(existing, updated, ['status', 'ledgerId']),
      });

      return updated;
    });

    res.status(200).json({
      success: true,
      message: 'Bank transaction reconciled successfully.',
      data: { transaction: updatedTx },
    });
  } catch (error: any) {
    console.error('[Banking] Error reconciling transaction:', error);
    if (error.message === 'Bank transaction not found.') {
      res.status(404).json({ success: false, error: error.message });
      return;
    }
    res.status(500).json({
      success: false,
      error: 'Failed to reconcile bank transaction.',
    });
  }
});

export default router;
