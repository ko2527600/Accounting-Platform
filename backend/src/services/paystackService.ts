import axios from 'axios';

const DEFAULT_BASE_URL = 'https://api.paystack.co';

export interface PaystackInitializeInput {
  email: string;
  amount: number; // native-currency (major unit) amount, e.g. 150.50
  currency: string;
  reference: string;
  callbackUrl?: string;
  // The tenant's Paystack subaccount code (ACCT_...) - when present,
  // Paystack automatically splits and settles this payment directly to the
  // tenant's own bank account (see Subaccount below). Omitted for a tenant
  // that hasn't set up their subaccount yet - Paystack then simply settles
  // the whole payment to Ledgio's own account, same as before subaccounts
  // existed, so callers must check isSubaccountConfigured() first and
  // refuse instead of silently taking a tenant's customer's money.
  subaccountCode?: string;
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

export interface PaystackBank {
  name: string;
  code: string;
}

export interface PaystackResolvedAccount {
  accountNumber: string;
  accountName: string;
}

export interface PaystackSubaccountInput {
  businessName: string;
  bankCode: string;
  accountNumber: string;
  // Ledgio's platform cut, 0-100. 0 means the tenant keeps everything
  // Paystack doesn't itself take as its own processing fee - see
  // https://paystack.com/docs/api/subaccount/ ("If a subaccount was
  // created with percentage_charge: 20, 20% goes to the main account and
  // the rest goes to the subaccount").
  percentageCharge: number;
}

export interface PaystackSubaccountResult {
  subaccountCode: string;
  accountName: string;
  isVerified: boolean;
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
 * True only if Ledgio's own platform-wide Paystack account is configured.
 * Unlike MoMo/TheTeller, this is intentionally platform-wide - Ledgio holds
 * one Paystack account and creates a subaccount per tenant under it (see
 * isSubaccountConfigured below for the per-tenant half of this check).
 */
export function isPaystackConfigured(): boolean {
  return Boolean(process.env.PAYSTACK_SECRET_KEY);
}

/** True only if this tenant has completed their own subaccount setup. */
export function isSubaccountConfigured(tenant: { paystackSubaccountCode?: string | null }): boolean {
  return Boolean(tenant.paystackSubaccountCode);
}

function secretKey(): string {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) {
    throw new PaystackServiceError('Paystack integration is not configured for this environment.', 503);
  }
  return key;
}

function baseUrl(): string {
  return process.env.PAYSTACK_BASE_URL || DEFAULT_BASE_URL;
}

function authHeader(): string {
  return `Bearer ${secretKey()}`;
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
 * GET /bank?country=ghana&currency=GHS&type=ghipss - the real list of banks
 * a tenant can pick from when entering their settlement bank account, per
 * https://paystack.com/docs/api/miscellaneous/. `type=ghipss` is Paystack's
 * documented value for Ghanaian bank-transfer settlement channels. Ghana
 * also has a `mobile_money` channel type - MTN/AirtelTigo/Telecel Cash each
 * appear here as their own "bank" entries (real code, real name) - since
 * Paystack settles a subaccount to a mobile money wallet exactly the same
 * way it settles to a bank account (same `settlement_bank`/`account_number`
 * fields on POST /subaccount), letting a tenant without a bank account use
 * their MoMo number instead.
 */
export type PaystackSettlementChannel = 'ghipss' | 'mobile_money';

export async function listBanks(channel: PaystackSettlementChannel = 'ghipss'): Promise<PaystackBank[]> {
  try {
    const response = await axios.get(`${baseUrl()}/bank`, {
      headers: { Authorization: authHeader() },
      params: { country: 'ghana', currency: 'GHS', type: channel, perPage: 100 },
    });
    const banks = response.data?.data || [];
    return banks.map((b: any) => ({ name: b.name, code: b.code }));
  } catch (error: any) {
    throw new PaystackServiceError(error.response?.data?.message || 'Failed to fetch bank list from Paystack.', error.response?.status || 502);
  }
}

/**
 * GET /bank/resolve?account_number=&bank_code= - confirms a real account
 * name for the entered bank details before creating a subaccount, so a
 * tenant can catch a typo'd account number themselves instead of money
 * later routing to the wrong bank account.
 */
export async function resolveAccountNumber(accountNumber: string, bankCode: string): Promise<PaystackResolvedAccount> {
  try {
    const response = await axios.get(`${baseUrl()}/bank/resolve`, {
      headers: { Authorization: authHeader() },
      params: { account_number: accountNumber, bank_code: bankCode },
    });
    const data = response.data?.data;
    return { accountNumber: data?.account_number || accountNumber, accountName: data?.account_name || '' };
  } catch (error: any) {
    throw new PaystackServiceError(
      error.response?.data?.message || 'Could not verify that account number with the selected bank.',
      error.response?.status || 502
    );
  }
}

/**
 * POST /subaccount - creates a real Paystack subaccount for this tenant so
 * their customers' payments settle directly to their own bank account
 * instead of Ledgio's. Real success returns Paystack's own subaccount_code
 * (ACCT_...), which is what gets passed as the `subaccount` parameter on
 * every future POST /transaction/initialize for this tenant.
 */
export async function createSubaccount(input: PaystackSubaccountInput): Promise<PaystackSubaccountResult> {
  try {
    const response = await axios.post(
      `${baseUrl()}/subaccount`,
      {
        business_name: input.businessName,
        settlement_bank: input.bankCode,
        account_number: input.accountNumber,
        percentage_charge: input.percentageCharge,
      },
      { headers: { Authorization: authHeader(), 'Content-Type': 'application/json' } }
    );
    const data = response.data?.data;
    if (!data?.subaccount_code) {
      throw new PaystackServiceError('Paystack did not return a subaccount code.', 502);
    }
    return { subaccountCode: data.subaccount_code, accountName: data.account_name || '', isVerified: Boolean(data.is_verified) };
  } catch (error: any) {
    if (error instanceof PaystackServiceError) throw error;
    throw new PaystackServiceError(error.response?.data?.message || 'Failed to create Paystack subaccount.', error.response?.status || 502);
  }
}

/**
 * POST /transaction/initialize - creates a hosted-checkout session and
 * returns the URL the customer is redirected to in order to pay by card,
 * bank transfer, or Mobile Money (Paystack supports MoMo as a channel in
 * Ghana). Nothing is marked paid yet; that only happens once
 * verifyTransaction confirms a real "success" status. When
 * input.subaccountCode is set, Paystack automatically splits and settles
 * this payment to that tenant's own bank account per
 * https://paystack.com/docs/payments/split-payments/.
 */
export async function initializeTransaction(input: PaystackInitializeInput): Promise<PaystackInitializeResult> {
  try {
    const response = await axios.post(
      `${baseUrl()}/transaction/initialize`,
      {
        email: input.email,
        amount: toSubunit(input.amount),
        currency: input.currency,
        reference: input.reference,
        callback_url: input.callbackUrl,
        ...(input.subaccountCode && { subaccount: input.subaccountCode }),
      },
      { headers: { Authorization: authHeader(), 'Content-Type': 'application/json' } }
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
  try {
    const response = await axios.get(`${baseUrl()}/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: authHeader() },
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
