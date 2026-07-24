import { Router, Request, Response } from 'express';
import { prisma } from '../config/db';
import { authenticateJwt } from '../middleware/authMiddleware';
import { tenantContextMiddleware } from '../middleware/tenantContextMiddleware';
import { requireRole } from '../middleware/rbacMiddleware';
import * as accountService from '../services/accountService';
import * as journalService from '../services/journalEntryService';

const router = Router();

router.use(authenticateJwt);
router.use(tenantContextMiddleware);

/**
 * POST /api/v1/import/accounts
 * Imports array of account records into Chart of Accounts.
 * Access: Accountant role or higher.
 */
router.post('/accounts', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { accounts } = req.body;

    if (!Array.isArray(accounts) || accounts.length === 0) {
      res.status(400).json({
        success: false,
        error: 'An array of accounts is required for import.',
      });
      return;
    }

    const createdAccounts = [];
    const errors = [];

    for (let i = 0; i < accounts.length; i++) {
      const acc = accounts[i];
      try {
        const created = await accountService.createAccount({
          code: String(acc.code).trim(),
          name: String(acc.name).trim(),
          type: String(acc.type).toUpperCase() as any,
          currency: acc.currency || 'USD',
        });
        createdAccounts.push(created);
      } catch (err: any) {
        errors.push({ row: i + 1, code: acc.code, error: err.message });
      }
    }

    res.status(200).json({
      success: true,
      message: `Imported ${createdAccounts.length} accounts. ${errors.length} errors.`,
      data: {
        importedCount: createdAccounts.length,
        errorCount: errors.length,
        errors,
      },
    });
  } catch (error: any) {
    console.error('[Import] Account import error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to complete account import.',
    });
  }
});

/**
 * POST /api/v1/import/journals
 * Imports array of journal entries.
 * Access: Accountant role or higher.
 */
router.post('/journals', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { entries } = req.body;

    if (!Array.isArray(entries) || entries.length === 0) {
      res.status(400).json({
        success: false,
        error: 'An array of journal entries is required for import.',
      });
      return;
    }

    const createdEntries = [];
    const errors = [];

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      try {
        const created = await journalService.createJournalEntry({
          entryDate: entry.entryDate || new Date().toISOString(),
          description: entry.description,
          lines: entry.lines.map((line: any) => ({
            accountId: line.accountId,
            debit: Number(line.debit) || 0,
            credit: Number(line.credit) || 0,
            description: line.description,
          })),
        });
        createdEntries.push(created);
      } catch (err: any) {
        errors.push({ row: i + 1, description: entry.description, error: err.message });
      }
    }

    res.status(200).json({
      success: true,
      message: `Imported ${createdEntries.length} journal entries. ${errors.length} errors.`,
      data: {
        importedCount: createdEntries.length,
        errorCount: errors.length,
        errors,
      },
    });
  } catch (error: any) {
    console.error('[Import] Journal import error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to complete journal import.',
    });
  }
});

export default router;
