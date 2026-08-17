import { Router, Request, Response } from 'express';
import { prisma } from '../config/db';
import { withCurrentTenantDb } from '../database/tenantClient';
import { authenticateJwt } from '../middleware/authMiddleware';
import { tenantContextMiddleware } from '../middleware/tenantContextMiddleware';
import { requireRole } from '../middleware/rbacMiddleware';
import { requireTenantContext } from '../context/tenantContext';
import * as tenantRepository from '../repository/tenantRepository';
import * as paystackService from '../services/paystackService';
import { PaystackServiceError } from '../services/paystackService';
import * as invoicePaymentService from '../services/invoicePaymentService';
import { InvoicePaymentServiceError } from '../services/invoicePaymentService';
import { actorFromRequest, recordAuditLogTx } from '../services/auditLogService';

const router = Router();

router.use(authenticateJwt);
router.use(tenantContextMiddleware);

/**
 * GET /api/v1/paystack/invoices/:invoiceId/requests
 * Lists every Paystack "Pay Now" link generated for an invoice.
 */
router.get('/invoices/:invoiceId/requests', async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const { invoiceId } = req.params;

    const requests = await withCurrentTenantDb(prisma, async (client) => {
      return (client as any).paystackPaymentRequest.findMany({
        where: { tenantId, invoiceId },
        orderBy: { createdAt: 'desc' },
      });
    });

    res.status(200).json({ success: true, data: { requests } });
  } catch (error: any) {
    console.error('[Paystack] Error listing payment requests:', error);
    res.status(500).json({ success: false, error: 'Failed to retrieve Paystack payment requests.' });
  }
});

/**
 * POST /api/v1/paystack/invoices/:invoiceId/initialize
 * Generates a hosted-checkout "Pay Now" link for the invoice's outstanding
 * balance. Returns 503 (no fake link) if PAYSTACK_SECRET_KEY isn't
 * configured. Nothing is marked paid here - only verify does that.
 */
router.post('/invoices/:invoiceId/initialize', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const { invoiceId } = req.params;

    const tenant = await tenantRepository.findTenantById(prisma, tenantId);
    if (!tenant || !paystackService.isPaystackConfigured(tenant)) {
      res.status(503).json({ success: false, error: 'Paystack integration is not configured for this business yet.' });
      return;
    }

    const invoice = await withCurrentTenantDb(prisma, async (client) => {
      return (client as any).invoice.findFirst({ where: { id: invoiceId, tenantId }, include: { customer: true } });
    });

    if (!invoice) {
      res.status(404).json({ success: false, error: 'Invoice not found.' });
      return;
    }
    if (invoice.status === 'DRAFT') {
      res.status(400).json({ success: false, error: 'Cannot generate a payment link for a draft invoice - send it first.' });
      return;
    }
    if (invoice.status === 'PAID') {
      res.status(400).json({ success: false, error: 'Invoice is already paid.' });
      return;
    }
    if (!invoice.customer?.email) {
      res.status(400).json({ success: false, error: 'Customer must have an email address to generate a Paystack link.' });
      return;
    }

    // The remaining balance, not the original total - a prior partial
    // payment must not be re-requested from the customer.
    const amount = Math.round((Number(invoice.total) - Number(invoice.amountPaid)) * 100) / 100;
    const reference = `INV-${invoice.invoiceNumber}-${Date.now()}`;

    const result = await paystackService.initializeTransaction(tenant, {
      email: invoice.customer.email,
      amount,
      currency: invoice.currency,
      reference,
      callbackUrl: process.env.PAYSTACK_CALLBACK_URL,
    });

    const request = await withCurrentTenantDb(prisma, async (client) => {
      const request = await (client as any).paystackPaymentRequest.create({
        data: {
          tenantId,
          invoiceId,
          reference: result.reference,
          amount,
          currency: invoice.currency,
          authorizationUrl: result.authorizationUrl,
          status: 'PENDING',
        },
      });

      await recordAuditLogTx(client, {
        action: 'PAYSTACK_PAYMENT_REQUEST.CREATED',
        entity: 'Invoice',
        entityId: invoiceId,
        actor: actorFromRequest(req),
        details: `Paystack pay-now link generated for invoice ${invoice.invoiceNumber} (${amount} ${invoice.currency}).`,
      });

      return request;
    });

    res.status(201).json({
      success: true,
      message: 'Paystack payment link generated. Share it with the customer, then verify once they confirm payment.',
      data: { request },
    });
  } catch (error: any) {
    console.error('[Paystack] Error initializing payment:', error);
    if (error instanceof PaystackServiceError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to generate Paystack payment link.' });
  }
});

/**
 * POST /api/v1/paystack/requests/:reference/verify
 * Confirms the real result of a previously-generated payment link directly
 * with Paystack (never trusts a client-side claim of "I paid"). On a
 * verified success, marks the invoice paid through the same shared
 * invoicePaymentService the manual "/pay" route, MoMo, and TheTeller all use.
 */
router.post('/requests/:reference/verify', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const { reference } = req.params;

    const tenant = await tenantRepository.findTenantById(prisma, tenantId);
    if (!tenant || !paystackService.isPaystackConfigured(tenant)) {
      res.status(503).json({ success: false, error: 'Paystack integration is not configured for this business yet.' });
      return;
    }

    const request = await withCurrentTenantDb(prisma, async (client) => {
      return (client as any).paystackPaymentRequest.findFirst({ where: { reference, tenantId } });
    });

    if (!request) {
      res.status(404).json({ success: false, error: 'Paystack payment request not found.' });
      return;
    }

    if (request.status === 'SUCCESSFUL') {
      res.status(200).json({ success: true, message: 'Payment already verified.', data: { request } });
      return;
    }

    const result = await paystackService.verifyTransaction(tenant, reference);
    const mappedStatus = result.status === 'success' ? 'SUCCESSFUL' : result.status === 'pending' ? 'PENDING' : 'FAILED';

    const updated = await withCurrentTenantDb(prisma, async (client) => {
      return (client as any).paystackPaymentRequest.update({
        where: { id: request.id },
        data: {
          status: mappedStatus,
          failureReason: mappedStatus === 'FAILED' ? result.gatewayResponse || 'Payment failed or was not completed.' : null,
        },
      });
    });

    if (mappedStatus === 'SUCCESSFUL') {
      const actor = actorFromRequest(req);
      await invoicePaymentService.recordInvoicePayment(request.invoiceId, actor, {
        amount: Number(request.amount),
        method: 'PAYSTACK',
        description: `Paystack payment received (ref ${reference})`,
      });
    }

    res.status(200).json({
      success: true,
      message: `Paystack payment status: ${mappedStatus}.`,
      data: { request: updated },
    });
  } catch (error: any) {
    console.error('[Paystack] Error verifying payment:', error);
    if (error instanceof PaystackServiceError || error instanceof InvoicePaymentServiceError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to verify Paystack payment.' });
  }
});

export default router;
