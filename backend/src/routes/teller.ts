import { Router, Request, Response } from 'express';
import { prisma } from '../config/db';
import { withCurrentTenantDb } from '../database/tenantClient';
import { authenticateJwt } from '../middleware/authMiddleware';
import { tenantContextMiddleware } from '../middleware/tenantContextMiddleware';
import { requireRole } from '../middleware/rbacMiddleware';
import { requireTenantContext } from '../context/tenantContext';
import * as tellerService from '../services/tellerService';
import { TellerServiceError, TellerNetwork } from '../services/tellerService';
import * as invoicePaymentService from '../services/invoicePaymentService';
import { InvoicePaymentServiceError } from '../services/invoicePaymentService';
import { actorFromRequest, recordAuditLog } from '../services/auditLogService';

const router = Router();

router.use(authenticateJwt);
router.use(tenantContextMiddleware);

// TheTeller (PaySwitch) covers Telecel Cash, AirtelTigo Money, Zeepay, and
// G-Money through one API - MTN is deliberately excluded here since it
// already has its own dedicated integration (routes/momo.ts). Rejecting MTN
// here (rather than silently accepting it) keeps every MTN collection going
// through the one MomoPaymentRequest table, instead of the same real-world
// network producing two differently-shaped rows across two tables.
const VALID_NETWORKS: TellerNetwork[] = ['VDF', 'ATL', 'TGO', 'ZPY', 'GMY'];

/**
 * GET /api/v1/teller/invoices/:invoiceId/requests
 * Lists every TheTeller payment-collection attempt made against an invoice.
 */
router.get('/invoices/:invoiceId/requests', async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const { invoiceId } = req.params;

    const requests = await withCurrentTenantDb(prisma, async (client) => {
      return (client as any).tellerPaymentRequest.findMany({
        where: { tenantId, invoiceId },
        orderBy: { createdAt: 'desc' },
      });
    });

    res.status(200).json({ success: true, data: { requests } });
  } catch (error: any) {
    console.error('[Teller] Error listing payment requests:', error);
    res.status(500).json({ success: false, error: 'Failed to retrieve Mobile Money payment requests.' });
  }
});

/**
 * POST /api/v1/teller/invoices/:invoiceId/request
 * Debits the customer's mobile money wallet on a non-MTN network for the
 * invoice's outstanding total via TheTeller. Returns 503 (no fake success)
 * if TheTeller credentials aren't configured. Unlike MTN's always-202
 * flow, TheTeller can resolve synchronously in this same response - when it
 * does, the invoice is marked PAID immediately rather than forcing a
 * redundant "Check Status" click.
 */
router.post('/invoices/:invoiceId/request', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const { invoiceId } = req.params;
    const { phoneNumber, network } = req.body;

    if (!tellerService.isTellerConfigured()) {
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

    if (!network || !VALID_NETWORKS.includes(network)) {
      res.status(400).json({
        success: false,
        error: `network must be one of ${VALID_NETWORKS.join(', ')} (use the MoMo endpoints for MTN).`,
      });
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

    const amount = Number(invoice.total);

    const result = await tellerService.processTransaction({
      amount,
      phoneNumber: phoneNumber.trim(),
      network,
      description: `Payment for invoice ${invoice.invoiceNumber}`,
    });

    const request = await withCurrentTenantDb(prisma, async (client) => {
      return (client as any).tellerPaymentRequest.create({
        data: {
          tenantId,
          invoiceId,
          network,
          phoneNumber: phoneNumber.trim(),
          amount,
          currency: invoice.currency,
          transactionId: result.transactionId,
          status: result.status,
          responseCode: result.responseCode || null,
          failureReason: result.status === 'FAILED' ? result.reason || 'Payment failed or was declined.' : null,
        },
      });
    });

    await recordAuditLog({
      action: 'TELLER_PAYMENT_REQUEST.SENT',
      entity: 'Invoice',
      entityId: invoiceId,
      actor: actorFromRequest(req),
      details: `TheTeller (${network}) payment request sent to ${phoneNumber.trim()} for invoice ${invoice.invoiceNumber} (${amount} ${invoice.currency}).`,
    });

    // A real behavioral difference from MTN: TheTeller's process response
    // can already be a synchronous approved/declined result, not always
    // pending-then-poll. Post the payment immediately in that case rather
    // than waiting on a "Check Status" click the user would otherwise have
    // to make for no reason.
    if (result.status === 'SUCCESSFUL') {
      const actor = actorFromRequest(req);
      await invoicePaymentService.markInvoicePaid(
        invoiceId,
        actor,
        `TheTeller ${network} payment received (txn ${result.transactionId})`
      );
    }

    res.status(201).json({
      success: true,
      message:
        result.status === 'SUCCESSFUL'
          ? 'Payment confirmed immediately - invoice marked PAID.'
          : 'Mobile Money payment request sent. The customer must approve the prompt on their phone, then check status to confirm.',
      data: { request },
    });
  } catch (error: any) {
    console.error('[Teller] Error requesting payment:', error);
    if (error instanceof TellerServiceError || error instanceof InvoicePaymentServiceError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to send Mobile Money payment request.' });
  }
});

/**
 * POST /api/v1/teller/requests/:transactionId/check-status
 * Polls TheTeller's real result for a previously-sent request that was
 * still PENDING. On SUCCESSFUL, marks the invoice PAID through the same
 * shared invoicePaymentService the manual "/pay" route and MoMo both use.
 */
router.post('/requests/:transactionId/check-status', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const { transactionId } = req.params;

    if (!tellerService.isTellerConfigured()) {
      res.status(503).json({
        success: false,
        error: 'Mobile Money integration is not configured for this environment.',
      });
      return;
    }

    const request = await withCurrentTenantDb(prisma, async (client) => {
      return (client as any).tellerPaymentRequest.findFirst({ where: { transactionId, tenantId } });
    });

    if (!request) {
      res.status(404).json({ success: false, error: 'Mobile Money payment request not found.' });
      return;
    }

    if (request.status !== 'PENDING') {
      res.status(200).json({ success: true, message: 'Request already resolved.', data: { request } });
      return;
    }

    const result = await tellerService.checkTransactionStatus(transactionId);

    const updated = await withCurrentTenantDb(prisma, async (client) => {
      return (client as any).tellerPaymentRequest.update({
        where: { id: request.id },
        data: {
          status: result.status,
          responseCode: result.responseCode || null,
          failureReason: result.status === 'FAILED' ? result.reason || 'Payment failed or was declined.' : null,
        },
      });
    });

    if (result.status === 'SUCCESSFUL') {
      const actor = actorFromRequest(req);
      await invoicePaymentService.markInvoicePaid(
        request.invoiceId,
        actor,
        `TheTeller ${request.network} payment received (txn ${transactionId})`
      );
    }

    res.status(200).json({
      success: true,
      message: `Mobile Money request status: ${result.status}.`,
      data: { request: updated },
    });
  } catch (error: any) {
    console.error('[Teller] Error checking payment status:', error);
    if (error instanceof TellerServiceError || error instanceof InvoicePaymentServiceError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to check Mobile Money payment status.' });
  }
});

export default router;
