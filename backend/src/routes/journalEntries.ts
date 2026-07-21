import { Router, Request, Response } from 'express';
import { authenticateJwt } from '../middleware/authMiddleware';
import { tenantContextMiddleware } from '../middleware/tenantContextMiddleware';
import { requireRole } from '../middleware/rbacMiddleware';
import * as journalEntryService from '../services/journalEntryService';
import { JournalEntryServiceError } from '../services/journalEntryService';
import { JournalEntryStatus } from '../repository/journalEntryRepository';

const router = Router();

// Enforce authentication & tenant context on all journal entry endpoints
router.use(authenticateJwt);
router.use(tenantContextMiddleware);

/**
 * GET /api/v1/journal-entries
 * Description: Retrieve list of journal entries for active tenant with optional filters (status, startDate, endDate, search).
 * Access: Viewer role or higher
 */
router.get('/', requireRole('Viewer'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { status, startDate, endDate, search } = req.query;

    const filters = {
      ...(status ? { status: (status as string).toUpperCase() as JournalEntryStatus } : {}),
      ...(startDate ? { startDate: startDate as string } : {}),
      ...(endDate ? { endDate: endDate as string } : {}),
      ...(search ? { search: search as string } : {}),
    };

    const entries = await journalEntryService.listJournalEntries(filters);
    res.status(200).json({
      success: true,
      data: {
        journalEntries: entries,
      },
    });
  } catch (error: any) {
    if (error instanceof JournalEntryServiceError) {
      res.status(error.statusCode).json({
        success: false,
        error: error.message,
      });
      return;
    }
    res.status(500).json({
      success: false,
      error: error.message || 'Internal Server Error while listing journal entries.',
    });
  }
});

/**
 * GET /api/v1/journal-entries/:id
 * Description: Retrieve a single journal entry by ID with its lines for active tenant.
 * Access: Viewer role or higher
 */
router.get('/:id', requireRole('Viewer'), async (req: Request, res: Response): Promise<void> => {
  try {
    const journalEntry = await journalEntryService.getJournalEntryById(req.params.id);
    if (!journalEntry) {
      res.status(404).json({
        success: false,
        error: `Journal entry with ID "${req.params.id}" not found.`,
      });
      return;
    }
    res.status(200).json({
      success: true,
      data: {
        journalEntry,
      },
    });
  } catch (error: any) {
    if (error instanceof JournalEntryServiceError) {
      res.status(error.statusCode).json({
        success: false,
        error: error.message,
      });
      return;
    }
    res.status(500).json({
      success: false,
      error: error.message || 'Internal Server Error while retrieving journal entry.',
    });
  }
});

/**
 * POST /api/v1/journal-entries
 * Description: Create a new journal entry (Draft or Posted) with line items.
 * Access: Accountant role or higher
 */
router.post('/', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const journalEntry = await journalEntryService.createJournalEntry(req.body);
    res.status(201).json({
      success: true,
      message: 'Journal entry created successfully',
      data: {
        journalEntry,
      },
    });
  } catch (error: any) {
    if (error instanceof JournalEntryServiceError) {
      res.status(error.statusCode).json({
        success: false,
        error: error.message,
      });
      return;
    }
    res.status(500).json({
      success: false,
      error: error.message || 'Internal Server Error while creating journal entry.',
    });
  }
});

/**
 * POST /api/v1/journal-entries/:id/post
 * Description: Post a draft journal entry to the general ledger.
 * Access: Accountant role or higher
 */
router.post('/:id/post', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const journalEntry = await journalEntryService.postJournalEntry(req.params.id);
    res.status(200).json({
      success: true,
      message: 'Journal entry posted successfully',
      data: {
        journalEntry,
      },
    });
  } catch (error: any) {
    if (error instanceof JournalEntryServiceError) {
      res.status(error.statusCode).json({
        success: false,
        error: error.message,
      });
      return;
    }
    res.status(500).json({
      success: false,
      error: error.message || 'Internal Server Error while posting journal entry.',
    });
  }
});

/**
 * POST /api/v1/journal-entries/:id/void
 * Description: Void a journal entry.
 * Access: Accountant role or higher
 */
router.post('/:id/void', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const journalEntry = await journalEntryService.voidJournalEntry(req.params.id);
    res.status(200).json({
      success: true,
      message: 'Journal entry voided successfully',
      data: {
        journalEntry,
      },
    });
  } catch (error: any) {
    if (error instanceof JournalEntryServiceError) {
      res.status(error.statusCode).json({
        success: false,
        error: error.message,
      });
      return;
    }
    res.status(500).json({
      success: false,
      error: error.message || 'Internal Server Error while voiding journal entry.',
    });
  }
});

export default router;
