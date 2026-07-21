import { Router, Request, Response } from 'express';
import { authenticateJwt } from '../middleware/authMiddleware';
import { tenantContextMiddleware } from '../middleware/tenantContextMiddleware';
import { requireRole } from '../middleware/rbacMiddleware';
import * as accountService from '../services/accountService';
import { AccountServiceError } from '../services/accountService';

const router = Router();

// Enforce authentication & tenant context on all accounts endpoints
router.use(authenticateJwt);
router.use(tenantContextMiddleware);

/**
 * GET /api/v1/accounts
 * Description: Retrieve list of all accounts for the active tenant, including flat list and nested tree structure.
 * Access: Viewer role or higher
 */
router.get('/', requireRole('Viewer'), async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await accountService.listAccounts();
    res.status(200).json({
      success: true,
      data: {
        accounts: result.accounts,
        tree: result.tree,
      },
    });
  } catch (error: any) {
    if (error instanceof AccountServiceError) {
      res.status(error.statusCode).json({
        success: false,
        error: error.message,
      });
      return;
    }
    res.status(500).json({
      success: false,
      error: error.message || 'Internal Server Error while listing accounts.',
    });
  }
});

/**
 * GET /api/v1/accounts/:id
 * Description: Retrieve a single account by ID for the active tenant.
 * Access: Viewer role or higher
 */
router.get('/:id', requireRole('Viewer'), async (req: Request, res: Response): Promise<void> => {
  try {
    const account = await accountService.getAccountById(req.params.id);
    if (!account) {
      res.status(404).json({
        success: false,
        error: `Account with ID "${req.params.id}" not found.`,
      });
      return;
    }
    res.status(200).json({
      success: true,
      data: {
        account,
      },
    });
  } catch (error: any) {
    if (error instanceof AccountServiceError) {
      res.status(error.statusCode).json({
        success: false,
        error: error.message,
      });
      return;
    }
    res.status(500).json({
      success: false,
      error: error.message || 'Internal Server Error while retrieving account.',
    });
  }
});

/**
 * POST /api/v1/accounts
 * Description: Create a new account in the Chart of Accounts for the active tenant.
 * Access: Accountant role or higher
 */
router.post('/', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const account = await accountService.createAccount(req.body);
    res.status(201).json({
      success: true,
      message: 'Account created successfully',
      data: {
        account,
      },
    });
  } catch (error: any) {
    if (error instanceof AccountServiceError) {
      res.status(error.statusCode).json({
        success: false,
        error: error.message,
      });
      return;
    }
    res.status(500).json({
      success: false,
      error: error.message || 'Internal Server Error while creating account.',
    });
  }
});

/**
 * PUT /api/v1/accounts/:id
 * Description: Update an existing account by ID for the active tenant.
 * Access: Accountant role or higher
 */
router.put('/:id', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const account = await accountService.updateAccount(req.params.id, req.body);
    res.status(200).json({
      success: true,
      message: 'Account updated successfully',
      data: {
        account,
      },
    });
  } catch (error: any) {
    if (error instanceof AccountServiceError) {
      res.status(error.statusCode).json({
        success: false,
        error: error.message,
      });
      return;
    }
    res.status(500).json({
      success: false,
      error: error.message || 'Internal Server Error while updating account.',
    });
  }
});

/**
 * DELETE /api/v1/accounts/:id
 * Description: Delete an account by ID for the active tenant.
 * Access: Accountant role or higher
 */
router.delete('/:id', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    await accountService.deleteAccount(req.params.id);
    res.status(200).json({
      success: true,
      message: 'Account deleted successfully',
    });
  } catch (error: any) {
    if (error instanceof AccountServiceError) {
      res.status(error.statusCode).json({
        success: false,
        error: error.message,
      });
      return;
    }
    res.status(500).json({
      success: false,
      error: error.message || 'Internal Server Error while deleting account.',
    });
  }
});

export default router;
