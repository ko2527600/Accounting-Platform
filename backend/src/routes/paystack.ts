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
import { actorFromRequest, recordAuditLog, recordAuditLogTx } from '../services/auditLogService';

const router = Router();

router.use(authenticateJwt);
router.use(tenantContextMiddleware);

// Ledgio's own platform cut on every split payment, 0-100. Defaults to 0
// (tenant keeps everything Paystack itself doesn't take as its processing
// fee) - a real percentage is a pricing decision, not something to invent
// here, so it stays 0 until deliberately configured.
function platformFeePercent(): number {
  const raw = Number(process.env.PAYSTACK_PLATFORM_FEE_PERCENT);
  return Number.isFinite(raw) && raw >= 0 && raw <= 100 ? raw : 0;
}

/**
 * GET /api/v1/paystack/banks?channel=ghipss|mobile_money
 * Real list of Ghanaian settlement destinations a tenant can pick from when
 * setting up their subaccount - real banks (default) or MTN/AirtelTigo/
 * Telecel Cash mobile money, for a tenant with no bank account.
 */
router.get('/banks', async (req: Request, res: Response): Promise<void> => {
  try {
    if (!paystackService.isPaystackConfigured()) {
      res.status(503).json({ success: false, error: 'Paystack integration is not configured for this environment.' });
      return;
    }
    const channel = req.query.channel === 'mobile_money' ? 'mobile_money' : 'ghipss';
    const banks = await paystackService.listBanks(channel);
    res.status(200).json({ success: true, data: { banks } });
  } catch (error: any) {
    console.error('[Paystack] Error fetching bank list:', error);
    if (error instanceof PaystackServiceError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to fetch bank list.' });
  }
});

/**
 * POST /api/v1/paystack/resolve-account
 * Confirms the real account name for a bank/account number before the
 * tenant commits to creating a subaccount with it - catches a typo'd
 * account number before money would ever be routed to it.
 */
router.post('/resolve-account', requireRole('Admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    if (!paystackService.isPaystackConfigured()) {
      res.status(503).json({ success: false, error: 'Paystack integration is not configured for this environment.' });
      return;
    }
    const { accountNumber, bankCode } = req.body;
    if (!accountNumber || !bankCode) {
      res.status(400).json({ success: false, error: 'accountNumber and bankCode are required.' });
      return;
    }
    const resolved = await paystackService.resolveAccountNumber(String(accountNumber).trim(), String(bankCode).trim());
    res.status(200).json({ success: true, data: { account: resolved } });
  } catch (error: any) {
    console.error('[Paystack] Error resolving account number:', error);
    if (error instanceof PaystackServiceError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to resolve account number.' });
  }
});

/**
 * POST /api/v1/paystack/subaccount
 * Creates a real Paystack subaccount for this tenant so their customers'
 * payments settle directly to their own bank account - the one-time setup
 * step that replaces asking a tenant for their own Paystack API keys.
 */
router.post('/subaccount', requireRole('Admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    if (!paystackService.isPaystackConfigured()) {
      res.status(503).json({ success: false, error: 'Paystack integration is not configured for this environment.' });
      return;
    }
    const { accountNumber, bankCode } = req.body;
    if (!accountNumber || !bankCode) {
      res.status(400).json({ success: false, error: 'accountNumber and bankCode are required.' });
      return;
    }

    const tenant = await tenantRepository.findTenantById(prisma, tenantId);
    if (!tenant) {
      res.status(404).json({ success: false, error: 'Tenant not found.' });
      return;
    }
    if (paystackService.isSubaccountConfigured(tenant)) {
      res.status(400).json({ success: false, error: 'A Paystack subaccount is already configured for this business.' });
      return;
    }

    const result = await paystackService.createSubaccount({
      businessName: tenant.name,
      bankCode: String(bankCode).trim(),
      accountNumber: String(accountNumber).trim(),
      percentageCharge: platformFeePercent(),
    });

    const updated = await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        paystackSubaccountCode: result.subaccountCode,
        paystackBankCode: String(bankCode).trim(),
        paystackAccountNumber: String(accountNumber).trim(),
        paystackAccountName: result.accountName,
      },
    });

    await recordAuditLog({
      action: 'PAYSTACK_SUBACCOUNT.CREATED',
      entity: 'Tenant',
      entityId: tenantId,
      tenantId,
      actor: actorFromRequest(req),
      details: `Paystack subaccount ${result.subaccountCode} created for ${tenant.name} (${result.accountName}).`,
    });

    res.status(201).json({
      success: true,
      message: 'Paystack subaccount created. Customer payments will now settle directly to this bank account.',
      data: {
        subaccountCode: updated.paystackSubaccountCode,
        accountName: updated.paystackAccountName,
        bankCode: updated.paystackBankCode,
        accountNumber: updated.paystackAccountNumber,
        isVerified: result.isVerified,
      },
    });
  } catch (error: any) {
    console.error('[Paystack] Error creating subaccount:', error);
    if (error instanceof PaystackServiceError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to create Paystack subaccount.' });
  }
});

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
    if (!tenant || !paystackService.isPaystackConfigured() || !paystackService.isSubaccountConfigured(tenant)) {
      res.status(503).json({
        success: false,
        error: 'Paystack payment collection is not set up for this business yet - add your bank details in Settings > Payment Collection.',
      });
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

    const result = await paystackService.initializeTransaction({
      email: invoice.customer.email,
      amount,
      currency: invoice.currency,
      reference,
      callbackUrl: process.env.PAYSTACK_CALLBACK_URL,
      subaccountCode: tenant.paystackSubaccountCode as string,
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
 * invoicePaymentService the manual "/pay" route also uses.
 */
router.post('/requests/:reference/verify', requireRole('Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const { reference } = req.params;

    if (!paystackService.isPaystackConfigured()) {
      res.status(503).json({ success: false, error: 'Paystack integration is not configured for this environment.' });
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

    const result = await paystackService.verifyTransaction(reference);
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
