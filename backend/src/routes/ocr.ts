import { Router, Request, Response } from 'express';
import axios from 'axios';
import { authenticateJwt } from '../middleware/authMiddleware';
import { tenantContextMiddleware } from '../middleware/tenantContextMiddleware';
import { requireRole } from '../middleware/rbacMiddleware';

const router = Router();
router.use(authenticateJwt);
router.use(tenantContextMiddleware);

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const OCR_MODEL = 'claude-haiku-4-5-20251001';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
type AllowedMime = (typeof ALLOWED_MIME_TYPES)[number];

/**
 * POST /api/v1/ocr/receipt
 * Accepts a base64-encoded receipt or vendor-bill image and uses Claude
 * vision to extract key fields (vendor, amount, date, description, category).
 * Returns the extracted fields so the caller can pre-fill an expense claim
 * or vendor bill form without manual data entry.
 */
router.post(
  '/receipt',
  requireRole('Viewer', 'Auditor', 'HR', 'Shop Manager', 'Cashier'),
  async (req: Request, res: Response): Promise<void> => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      res.status(503).json({ success: false, error: 'OCR service not configured.' });
      return;
    }

    const { imageBase64, mimeType = 'image/jpeg' } = req.body ?? {};

    if (!imageBase64 || typeof imageBase64 !== 'string') {
      res.status(400).json({ success: false, error: 'imageBase64 is required.' });
      return;
    }

    if (!ALLOWED_MIME_TYPES.includes(mimeType as AllowedMime)) {
      res.status(400).json({
        success: false,
        error: 'Unsupported image type. Use JPEG, PNG, GIF, or WebP.',
      });
      return;
    }

    // Rough size guard — base64 is ~1.33× raw bytes; 5 MB raw ≈ 6.7 MB base64
    if (imageBase64.length > 7_000_000) {
      res.status(413).json({ success: false, error: 'Image too large. Keep under 5 MB.' });
      return;
    }

    try {
      const response = await axios.post(
        ANTHROPIC_API_URL,
        {
          model: OCR_MODEL,
          max_tokens: 512,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: { type: 'base64', media_type: mimeType, data: imageBase64 },
                },
                {
                  type: 'text',
                  text: `You are a receipt OCR assistant. Extract the following fields from this receipt or invoice image. Return ONLY a valid JSON object with exactly these keys. Use null for any field you cannot clearly read.

{
  "vendor": "store or supplier name",
  "amount": "total amount as a numeric string without currency symbol (e.g. \"45.50\")",
  "date": "transaction date in YYYY-MM-DD format",
  "description": "brief description of what was purchased (1-2 sentences, max 120 chars)",
  "category": "one of: Food & Beverage, Transport, Office Supplies, Utilities, Professional Services, Equipment, Other"
}

Return only the JSON object. No preamble, no explanation, no markdown fences.`,
                },
              ],
            },
          ],
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
          },
          timeout: 30_000,
        }
      );

      const rawText: string = response.data?.content?.[0]?.text ?? '';
      let extracted: Record<string, string | null> = {};
      try {
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (jsonMatch) extracted = JSON.parse(jsonMatch[0]);
      } catch {
        // Parsing failed — return empty object; caller treats nulls as "not found"
      }

      res.json({ success: true, data: extracted });
    } catch (error: any) {
      const httpStatus = error.response?.status;
      if (httpStatus === 400) {
        res.status(400).json({ success: false, error: 'Invalid image data sent to OCR service.' });
      } else if (httpStatus === 429) {
        res.status(429).json({
          success: false,
          error: 'OCR rate limit reached. Please try again in a moment.',
        });
      } else {
        console.error('[OCR] Anthropic error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to process receipt image.' });
      }
    }
  }
);

export default router;
