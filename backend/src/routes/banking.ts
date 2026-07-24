import { Router, Request, Response } from 'express';
import { prisma } from '../config/db';
import { withCurrentTenantDb } from '../database/tenantClient';
import { authenticateJwt } from '../middleware/authMiddleware';
import { tenantContextMiddleware } from '../middleware/tenantContextMiddleware';
import { requireRole } from '../middleware/rbacMiddleware';

const router = Router();

router.use(authenticateJwt);
router.use(tenantContextMiddleware);

/**
 * GET /api/v1/banking/accounts
 * Retrieves all linked bank accounts for the tenant.
 */
router.get('/accounts', async (req: Request, res: Response): Promise<void> => {
  try {
    const bankAccounts = await withCurrentTenantDb(prisma, async (client) => {
      return (client as any).bankAccount.findMany({
        where: { isActive: true },
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
 * Links a new bank account feed (Plaid / Salt Edge simulation).
 */
router.post('/connect', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { accountName, bankName, accountNumber, initialBalance, currency = 'USD' } = req.body;

    if (!accountName || !bankName || !accountNumber) {
      res.status(400).json({
        success: false,
        error: 'Account name, bank name, and account number are required.',
      });
      return;
    }

    const createdAccount = await withCurrentTenantDb(prisma, async (client) => {
      return (client as any).bankAccount.create({
        data: {
          accountName: accountName.trim(),
          bankName: bankName.trim(),
          accountNumber: String(accountNumber).slice(-4),
          currency,
          currentBalance: Number(initialBalance) || 12500.00,
        },
      });
    });

    // Seed initial bank feed transactions for testing reconciliation
    await withCurrentTenantDb(prisma, async (client) => {
      await (client as any).bankTransaction.createMany({
        data: [
          {
            bankAccountId: createdAccount.id,
            amount: 2500.00,
            payee: 'Acme Client Corp',
            description: 'Direct Deposit Payment',
            status: 'UNRECONCILED',
          },
          {
            bankAccountId: createdAccount.id,
            amount: -450.00,
            payee: 'AWS Web Services',
            description: 'Monthly Infrastructure Bill',
            status: 'UNRECONCILED',
          },
        ],
      });
    });

    res.status(201).json({
      success: true,
      message: 'Bank account connected successfully',
      data: { bankAccount: createdAccount },
    });
  } catch (error: any) {
    console.error('[Banking] Error connecting bank account:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to connect bank account.',
    });
  }
});

/**
 * GET /api/v1/banking/transactions
 * Retrieves bank statement lines for reconciliation.
 */
router.get('/transactions', async (req: Request, res: Response): Promise<void> => {
  try {
    const transactions = await withCurrentTenantDb(prisma, async (client) => {
      return (client as any).bankTransaction.findMany({
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
    const { transactionId, ledgerId } = req.body;

    if (!transactionId) {
      res.status(400).json({
        success: false,
        error: 'Bank transactionId is required.',
      });
      return;
    }

    const updatedTx = await withCurrentTenantDb(prisma, async (client) => {
      return (client as any).bankTransaction.update({
        where: { id: transactionId },
        data: {
          status: 'RECONCILED',
          ledgerId: ledgerId || undefined,
        },
      });
    });

    res.status(200).json({
      success: true,
      message: 'Bank transaction reconciled successfully.',
      data: { transaction: updatedTx },
    });
  } catch (error: any) {
    console.error('[Banking] Error reconciling transaction:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to reconcile bank transaction.',
    });
  }
});

export default router;
