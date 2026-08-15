import axios from 'axios';

const DEFAULT_BASE_URL = 'https://api.paystack.co';

export interface PaystackInitializeInput {
  email: string;
  amount: number; // native-currency (major unit) amount, e.g. 150.50
  currency: string;
  reference: string;
  callbackUrl?: string;
}

export interface PaystackInitializeResult {
  authorizationUrl: string;
  accessCode: string;
  reference: string;
}

export type PaystackVerifiedStatus = 'success' | 'failed' | 'abandoned' | 'pending';

export interface PaystackVerifyResult {
  status: PaystackVerifiedStatus;
  reference: string;
  amount: number; // converted back to native-currency major unit
  currency: string;
  gatewayResponse?: string;
}

export class PaystackServiceError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number = 502) {
    super(message);
    this.name = 'PaystackServiceError';
    this.statusCode = statusCode;
  }
}

/**
 * True only if a real Paystack secret key is configured. Callers must check
 * this and refuse to fall back to fake data when false - same contract as
 * isTellerConfigured()/isMomoConfigured().
 */
export function isPaystackConfigured(): boolean {
  return Boolean(process.env.PAYSTACK_SECRET_KEY);
}

function config() {
  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) {
    throw new PaystackServiceError('Paystack integration is not configured for this environment.', 503);
  }
  return {
    secretKey,
    baseUrl: process.env.PAYSTACK_BASE_URL || DEFAULT_BASE_URL,
  };
}

function authHeader(secretKey: string): string {
  return `Bearer ${secretKey}`;
}

// Paystack amounts are always in the smallest currency unit (kobo/pesewas/
// cents), never the major unit our own Decimal columns use.
function toSubunit(amount: number): number {
  return Math.round(amount * 100);
}

function fromSubunit(amount: number): number {
  return Math.round(amount) / 100;
}

/**
 * POST /transaction/initialize - creates a hosted-checkout session and
 * returns the URL the customer is redirected to in order to pay by card or
 * bank transfer. Nothing is marked paid yet; that only happens once
 * verifyTransaction confirms a real "success" status.
 */
export async function initializeTransaction(input: PaystackInitializeInput): Promise<PaystackInitializeResult> {
  const cfg = config();
  try {
    const response = await axios.post(
      `${cfg.baseUrl}/transaction/initialize`,
      {
        email: input.email,
        amount: toSubunit(input.amount),
        currency: input.currency,
        reference: input.reference,
        callback_url: input.callbackUrl,
      },
      { headers: { Authorization: authHeader(cfg.secretKey), 'Content-Type': 'application/json' } }
    );
    const data = response.data?.data;
    if (!data?.authorization_url) {
      throw new PaystackServiceError('Paystack did not return a checkout URL.', 502);
    }
    return { authorizationUrl: data.authorization_url, accessCode: data.access_code, reference: data.reference || input.reference };
  } catch (error: any) {
    if (error instanceof PaystackServiceError) throw error;
    throw new PaystackServiceError(
      error.response?.data?.message || 'Failed to initialize Paystack checkout.',
      error.response?.status || 502
    );
  }
}

/**
 * GET /transaction/verify/:reference - the only source of truth for whether
 * a checkout actually completed. Must be called (not trusted from the
 * client-side redirect alone) before an invoice is ever marked paid, since
 * the redirect callback is not itself proof of payment.
 */
export async function verifyTransaction(reference: string): Promise<PaystackVerifyResult> {
  const cfg = config();
  try {
    const response = await axios.get(`${cfg.baseUrl}/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: authHeader(cfg.secretKey) },
    });
    const data = response.data?.data;
    const rawStatus = String(data?.status || '').toLowerCase();
    const status: PaystackVerifiedStatus =
      rawStatus === 'success' || rawStatus === 'failed' || rawStatus === 'abandoned' ? rawStatus : 'pending';
    return {
      status,
      reference: data?.reference || reference,
      amount: fromSubunit(Number(data?.amount || 0)),
      currency: data?.currency || 'GHS',
      gatewayResponse: data?.gateway_response,
    };
  } catch (error: any) {
    throw new PaystackServiceError(
      error.response?.data?.message || 'Failed to verify Paystack transaction.',
      error.response?.status || 502
    );
  }
}
