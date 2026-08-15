import { Router, Request, Response } from 'express';
import { prisma } from '../config/db';
import { withCurrentTenantDb } from '../database/tenantClient';
import { authenticateJwt } from '../middleware/authMiddleware';
import { tenantContextMiddleware } from '../middleware/tenantContextMiddleware';
import { requireRole } from '../middleware/rbacMiddleware';
import { requireTenantContext } from '../context/tenantContext';
import * as momoService from '../services/momoService';
import { MomoServiceError } from '../services/momoService';
import * as invoicePaymentService from '../services/invoicePaymentService';
import { InvoicePaymentServiceError } from '../services/invoicePaymentService';
import { actorFromRequest, recordAuditLogTx } from '../services/auditLogService';

const router = Router();

router.use(authenticateJwt);
router.use(tenantContextMiddleware);

/**
 * GET /api/v1/momo/balance
 * The tenant's real MTN MoMo merchant wallet balance. This is a
 * platform-wide integration (one set of MTN Collections credentials, same
 * as Mono's single MONO_SECRET_KEY), not per-tenant - every tenant with
 * Mobile Money enabled shares the same underlying MoMo merchant account
 * until per-tenant credential storage is built.
 */
router.get('/balance', async (req: Request, res: Response): Promise<void> => {
  try {
    if (!momoService.isMomoConfigured()) {
      res.status(503).json({
        success: false,
        error: 'Mobile Money integration is not configured for this environment.',
      });
      return;
    }
    const balance = await momoService.getAccountBalance();
    res.status(200).json({ success: true, data: { balance } });
  } catch (error: any) {
    console.error('[Momo] Error fetching account balance:', error);
    if (error instanceof MomoServiceError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to retrieve Mobile Money balance.' });
  }
});

/**
 * GET /api/v1/momo/invoices/:invoiceId/requests
 * Lists every MoMo payment-collection attempt made against an invoice.
 */
router.get('/invoices/:invoiceId/requests', async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const { invoiceId } = req.params;

    const requests = await withCurrentTenantDb(prisma, async (client) => {
      return (client as any).momoPaymentRequest.findMany({
        where: { tenantId, invoiceId },
        orderBy: { createdAt: 'desc' },
      });
    });

    res.status(200).json({ success: true, data: { requests } });
  } catch (error: any) {
    console.error('[Momo] Error listing payment requests:', error);
    res.status(500).json({ success: false, error: 'Failed to retrieve Mobile Money payment requests.' });
  }
});

/**
 * POST /api/v1/momo/invoices/:invoiceId/request
 * Sends a real MTN MoMo "Request to Pay" USSD prompt to the customer's
 * phone for the invoice's outstanding total. Returns 503 (no fake success)
 * if Mobile Money credentials aren't configured.
 */
router.post('/invoices/:invoiceId/request', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const { invoiceId } = req.params;
    const { phoneNumber } = req.body;

    if (!momoService.isMomoConfigured()) {
      res.status(503).json({
        success: false,
        error: 'Mobile Money integration is not configured for this environment.',
      });
      return;
    }

    if (!phoneNumber || typeof phoneNumber !== 'string' || !phoneNumber.trim()) {
      res.status(400).json({ success: false, error: 'A customer phoneNumber is required.' });
      return;
    }

    const invoice = await withCurrentTenantDb(prisma, async (client) => {
      return (client as any).invoice.findFirst({ where: { id: invoiceId, tenantId } });
    });

    if (!invoice) {
      res.status(404).json({ success: false, error: 'Invoice not found.' });
      return;
    }
    if (invoice.status === 'PAID') {
      res.status(400).json({ success: false, error: 'Invoice is already paid.' });
      return;
    }

    // The remaining balance, not the original total - a prior manual
    // partial payment (or an earlier failed/expired MoMo attempt that still
    // partially posted) must not be re-requested from the customer.
    const amount = Math.round((Number(invoice.total) - Number(invoice.amountPaid)) * 100) / 100;
    const externalId = `${invoice.invoiceNumber}-${Date.now()}`;

    const { referenceId } = await momoService.requestToPay({
      amount,
      currency: invoice.currency,
      phoneNumber: phoneNumber.trim(),
      externalId,
      payerMessage: `Payment for invoice ${invoice.invoiceNumber}`,
      payeeNote: `Invoice ${invoice.invoiceNumber}`,
    });

    const request = await withCurrentTenantDb(prisma, async (client) => {
      const request = await (client as any).momoPaymentRequest.create({
        data: {
          tenantId,
          invoiceId,
          phoneNumber: phoneNumber.trim(),
          amount,
          currency: invoice.currency,
          referenceId,
          externalId,
          status: 'PENDING',
        },
      });

      await recordAuditLogTx(client, {
        action: 'MOMO_PAYMENT_REQUEST.SENT',
        entity: 'Invoice',
        entityId: invoiceId,
        actor: actorFromRequest(req),
        details: `MTN MoMo payment request sent to ${phoneNumber.trim()} for invoice ${invoice.invoiceNumber} (${amount} ${invoice.currency}).`,
      });

      return request;
    });

    res.status(201).json({
      success: true,
      message: 'MTN MoMo payment request sent. The customer must approve the prompt on their phone, then check status to confirm.',
      data: { request },
    });
  } catch (error: any) {
    console.error('[Momo] Error requesting payment:', error);
    if (error instanceof MomoServiceError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to send Mobile Money payment request.' });
  }
});

/**
 * POST /api/v1/momo/requests/:referenceId/check-status
 * Polls MTN's real result for a previously-sent request. MTN's Collections
 * API has no webhook-delivery guarantee documented with a verifiable
 * signing mechanism, so this manual poll is the reliable, honestly-scoped
 * path (rather than building an unauthenticated webhook of unclear
 * trustworthiness). On SUCCESSFUL, marks the invoice PAID through the same
 * shared invoicePaymentService the manual "/pay" route uses.
 */
router.post('/requests/:referenceId/check-status', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const { referenceId } = req.params;

    if (!momoService.isMomoConfigured()) {
      res.status(503).json({
        success: false,
        error: 'Mobile Money integration is not configured for this environment.',
      });
      return;
    }

    const request = await withCurrentTenantDb(prisma, async (client) => {
      return (client as any).momoPaymentRequest.findFirst({ where: { referenceId, tenantId } });
    });

    if (!request) {
      res.status(404).json({ success: false, error: 'Mobile Money payment request not found.' });
      return;
    }

    if (request.status !== 'PENDING') {
      res.status(200).json({ success: true, message: 'Request already resolved.', data: { request } });
      return;
    }

    const result = await momoService.getTransactionStatus(referenceId);

    const updated = await withCurrentTenantDb(prisma, async (client) => {
      return (client as any).momoPaymentRequest.update({
        where: { id: request.id },
        data: {
          status: result.status,
          financialTransactionId: result.financialTransactionId || null,
          failureReason: result.status === 'FAILED' ? result.reason || 'Payment failed or was declined.' : null,
        },
      });
    });

    if (result.status === 'SUCCESSFUL') {
      const actor = actorFromRequest(req);
      // No `amount` - the request itself was already sized to the
      // remaining balance at send time (see POST /request-to-pay above), so
      // this pays off whatever's still outstanding now.
      await invoicePaymentService.recordInvoicePayment(request.invoiceId, actor, {
        method: 'MOMO',
        description: `MTN MoMo payment received (ref ${referenceId.slice(0, 8)})`,
      });
    }

    res.status(200).json({
      success: true,
      message: `Mobile Money request status: ${result.status}.`,
      data: { request: updated },
    });
  } catch (error: any) {
    console.error('[Momo] Error checking payment status:', error);
    if (error instanceof MomoServiceError || error instanceof InvoicePaymentServiceError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to check Mobile Money payment status.' });
  }
});

export default router;
