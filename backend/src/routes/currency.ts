import { Router, Request, Response } from 'express';
import { authenticateJwt } from '../middleware/authMiddleware';

const router = Router();

router.use(authenticateJwt);

/**
 * GET /api/v1/currency/rates
 * Returns FX rates relative to USD.
 */
router.get('/rates', (req: Request, res: Response) => {
  const baseCurrency = 'USD';
  const rates: Record<string, number> = {
    USD: 1.0,
    EUR: 0.92,
    GBP: 0.78,
    GHS: 15.40,
    JPY: 155.20,
    CAD: 1.36,
  };

  res.status(200).json({
    success: true,
    data: {
      baseCurrency,
      updatedAt: new Date(),
      rates,
    },
  });
});

export default router;
