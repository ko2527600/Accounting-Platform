import { Router, Request, Response } from 'express';
import { prisma } from '../config/db';
import { withCurrentTenantDb } from '../database/tenantClient';
import { authenticateJwt } from '../middleware/authMiddleware';
import { tenantContextMiddleware } from '../middleware/tenantContextMiddleware';
import { requireRole } from '../middleware/rbacMiddleware';
import { requireTier } from '../middleware/tierEnforcementMiddleware';
import { requireTenantContext } from '../context/tenantContext';
import * as monoService from '../services/monoService';
import { MonoServiceError } from '../services/monoService';
import { recordAuditLogTx, actorFromRequest, diffFields } from '../services/auditLogService';
import * as ledgerRepository from '../repository/ledgerRepository';

// Bank posting dates commonly lag or lead the book/ledger date by a few
// days (batch processing, weekends/holidays), so the match window can't be
// same-day-only without missing obviously-correct matches.
const RECONCILE_MATCH_DAY_WINDOW = 10;
// Tolerance for float/decimal rounding noise when comparing a Ledger row's
// (debit - credit) against a bank transaction's amount - not a "close
// enough" fuzzy match, just enough to absorb representation noise.
const RECONCILE_AMOUNT_TOLERANCE = 0.01;

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
router.use(requireTier(2, 'Bank Reconciliation'));

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
 * GET /api/v1/banking/transactions/:id/suggestions
 * Real matching logic: finds candidate General Ledger entries (on
 * cash/bank-equivalent accounts) whose amount and date plausibly correspond
 * to this bank statement line, instead of requiring the user to already
 * know a ledgerId. Amount must match exactly (debit - credit, same sign
 * convention as the bank transaction's amount); date must be within
 * RECONCILE_MATCH_DAY_WINDOW days either side. Ledger rows already linked
 * to another bank transaction are excluded so the same ledger entry can't
 * be suggested for two different statement lines.
 */
router.get('/transactions/:id/suggestions', async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const { id } = req.params;

    const transaction = await withCurrentTenantDb(prisma, async (client) => {
      return (client as any).bankTransaction.findFirst({ where: { id, tenantId } });
    });

    if (!transaction) {
      res.status(404).json({ success: false, error: 'Bank transaction not found.' });
      return;
    }

    const alreadyLinked = await withCurrentTenantDb(prisma, async (client) => {
      return (client as any).bankTransaction.findMany({
        where: { tenantId, ledgerId: { not: null }, id: { not: id } },
        select: { ledgerId: true },
      });
    });
    const excludeLedgerIds = alreadyLinked.map((t: any) => t.ledgerId as string);

    const candidates = await withCurrentTenantDb(prisma, (client) =>
      ledgerRepository.findCashLedgerMatchCandidates(client, {
        amount: Number(transaction.amount),
        targetDate: transaction.postedDate,
        dayWindow: RECONCILE_MATCH_DAY_WINDOW,
        excludeLedgerIds,
      })
    );

    res.status(200).json({
      success: true,
      data: { candidates },
    });
  } catch (error: any) {
    console.error('[Banking] Error finding reconciliation suggestions:', error);
    res.status(500).json({ success: false, error: 'Failed to find matching ledger entries.' });
  }
});

/**
 * POST /api/v1/banking/reconcile
 * Confirms a bank transaction matches a specific ledger entry - unlike the
 * old version of this endpoint, this actually validates the match rather
 * than blindly flipping status: the ledgerId is required, must reference a
 * real Ledger row, and that row's net amount (debit - credit) must equal
 * the bank transaction's amount within RECONCILE_AMOUNT_TOLERANCE. Rejects
 * matching a ledger row that's already linked to a different bank
 * transaction.
 */
router.post('/reconcile', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const { transactionId, ledgerId } = req.body;

    if (!transactionId) {
      res.status(400).json({ success: false, error: 'Bank transactionId is required.' });
      return;
    }
    if (!ledgerId) {
      res.status(400).json({ success: false, error: 'A matching ledgerId is required to reconcile.' });
      return;
    }

    const existing = await withCurrentTenantDb(prisma, async (client) => {
      return (client as any).bankTransaction.findFirst({ where: { id: transactionId, tenantId } });
    });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Bank transaction not found.' });
      return;
    }

    const ledgerEntry = await withCurrentTenantDb(prisma, (client) => ledgerRepository.getLedgerById(client, ledgerId));
    if (!ledgerEntry) {
      res.status(404).json({ success: false, error: 'Ledger entry not found.' });
      return;
    }

    const ledgerAmount = ledgerEntry.debit - ledgerEntry.credit;
    if (Math.abs(ledgerAmount - Number(existing.amount)) > RECONCILE_AMOUNT_TOLERANCE) {
      res.status(400).json({
        success: false,
        error: `Selected ledger entry (${ledgerAmount}) does not match the bank transaction amount (${Number(existing.amount)}).`,
      });
      return;
    }

    const conflictingTx = await withCurrentTenantDb(prisma, async (client) => {
      return (client as any).bankTransaction.findFirst({
        where: { tenantId, ledgerId, id: { not: transactionId } },
      });
    });
    if (conflictingTx) {
      res.status(409).json({ success: false, error: 'This ledger entry is already matched to a different bank transaction.' });
      return;
    }

    const updatedTx = await withCurrentTenantDb(prisma, async (client) => {
      const updated = await (client as any).bankTransaction.update({
        where: { id: transactionId },
        data: { status: 'RECONCILED', ledgerId },
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
    res.status(500).json({ success: false, error: 'Failed to reconcile bank transaction.' });
  }
});

export default router;
