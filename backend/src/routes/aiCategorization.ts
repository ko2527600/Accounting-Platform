import { Router, Request, Response } from 'express';
import { prisma } from '../config/db';
import { withCurrentTenantDb } from '../database/tenantClient';
import { authenticateJwt } from '../middleware/authMiddleware';
import { tenantContextMiddleware } from '../middleware/tenantContextMiddleware';

const router = Router();

router.use(authenticateJwt);
router.use(tenantContextMiddleware);

/**
 * POST /api/v1/ai/categorize
 * Analyzes transaction description text and recommends the matching Account from COA.
 */
router.post('/categorize', async (req: Request, res: Response): Promise<void> => {
  try {
    const { description } = req.body;

    if (!description || typeof description !== 'string' || !description.trim()) {
      res.status(400).json({
        success: false,
        error: 'Description text is required for AI categorization.',
      });
      return;
    }

    // Fetch tenant accounts
    const accounts = await withCurrentTenantDb(prisma, async (client) => {
      return (client as any).account.findMany({
        where: { isActive: true },
      });
    });

    const text = description.toLowerCase().trim();
    let bestMatch: any = null;
    let confidence = 0.5;
    let rationale = 'Category matched based on accounting pattern.';

    // Pattern matching rules
    if (text.includes('rent') || text.includes('office space') || text.includes('lease')) {
      bestMatch = accounts.find((a: any) => a.type === 'EXPENSE' && (a.name.toLowerCase().includes('rent') || a.name.toLowerCase().includes('office')));
      confidence = 0.92;
      rationale = 'Identified occupancy expense pattern.';
    } else if (text.includes('aws') || text.includes('cloud') || text.includes('software') || text.includes('subscription')) {
      bestMatch = accounts.find((a: any) => a.type === 'EXPENSE' && (a.name.toLowerCase().includes('supplies') || a.name.toLowerCase().includes('office') || a.name.toLowerCase().includes('software')));
      confidence = 0.88;
      rationale = 'Identified software/utility expense pattern.';
    } else if (text.includes('sales') || text.includes('client') || text.includes('invoice') || text.includes('fee') || text.includes('service')) {
      bestMatch = accounts.find((a: any) => a.type === 'REVENUE');
      confidence = 0.95;
      rationale = 'Identified revenue / earned income pattern.';
    } else if (text.includes('bank') || text.includes('cash') || text.includes('transfer')) {
      bestMatch = accounts.find((a: any) => a.type === 'ASSET');
      confidence = 0.90;
      rationale = 'Identified asset / liquid funds transfer pattern.';
    }

    // Fallback match if no specific keyword triggered
    if (!bestMatch && accounts.length > 0) {
      bestMatch = accounts.find((a: any) => a.type === 'EXPENSE') || accounts[0];
      confidence = 0.65;
      rationale = 'General expense fallback suggestion.';
    }

    res.status(200).json({
      success: true,
      data: {
        suggestion: bestMatch
          ? {
              accountId: bestMatch.id,
              accountCode: bestMatch.code,
              accountName: bestMatch.name,
              type: bestMatch.type,
              confidence,
              rationale,
            }
          : null,
      },
    });
  } catch (error: any) {
    console.error('[AICategorization] Error suggesting category:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate AI categorization.',
    });
  }
});

export default router;
