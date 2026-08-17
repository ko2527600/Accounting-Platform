import axios from 'axios';
import crypto from 'crypto';
import { decryptCredential } from '../utils/credentialEncryption';

const DEFAULT_BASE_URL = 'https://sandbox.momodeveloper.mtn.com';

export interface MomoTenantCredentials {
  momoApiUser: string | null;
  momoSubscriptionKeyEncrypted: string | null;
  momoApiKeyEncrypted: string | null;
}

interface ResolvedMomoCredentials {
  apiUser: string;
  subscriptionKey: string;
  apiKey: string;
}

export interface MomoRequestToPayInput {
  amount: number;
  currency: string;
  phoneNumber: string;
  externalId: string;
  payerMessage?: string;
  payeeNote?: string;
}

export interface MomoTransactionStatus {
  status: 'PENDING' | 'SUCCESSFUL' | 'FAILED';
  financialTransactionId?: string;
  reason?: string;
}

export interface MomoAccountBalance {
  availableBalance: number;
  currency: string;
}

export class MomoServiceError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number = 502) {
    super(message);
    this.name = 'MomoServiceError';
    this.statusCode = statusCode;
  }
}

/**
 * True only if this tenant has their own real MTN MoMo Collections
 * credentials configured: a subscription key (Ocp-Apim-Subscription-Key)
 * plus an API user/key pair the tenant pre-provisioned themselves via MTN's
 * POST /v1_0/apiuser and POST /v1_0/apiuser/{userId}/apikey endpoints -
 * per-tenant so each tenant's collected customer payments land in their own
 * MTN merchant account, not a shared Ledgio one. Callers must check this and
 * refuse to fall back to fake data when false.
 */
export function isMomoConfigured(tenant: MomoTenantCredentials): boolean {
  return Boolean(tenant.momoApiUser && tenant.momoSubscriptionKeyEncrypted && tenant.momoApiKeyEncrypted);
}

function resolveCredentials(tenant: MomoTenantCredentials): ResolvedMomoCredentials {
  if (!isMomoConfigured(tenant)) {
    throw new MomoServiceError('Mobile Money integration is not configured for this business yet.', 503);
  }
  return {
    apiUser: tenant.momoApiUser as string,
    subscriptionKey: decryptCredential(tenant.momoSubscriptionKeyEncrypted as string),
    apiKey: decryptCredential(tenant.momoApiKeyEncrypted as string),
  };
}

function baseUrl(): string {
  return process.env.MOMO_BASE_URL || DEFAULT_BASE_URL;
}

function targetEnvironment(): string {
  return process.env.MOMO_TARGET_ENVIRONMENT || 'sandbox';
}

// Per-tenant token cache, keyed by apiUser (unique per tenant's MTN API
// user). A single global cache would leak one tenant's bearer token into
// another tenant's requests.
const tokenCache = new Map<string, { value: string; expiresAt: number }>();

/**
 * POST /collection/token/ - exchanges the tenant's pre-provisioned API
 * user/key (Basic Auth) for a short-lived Bearer access token. Cached
 * in-memory per tenant until shortly before its real expiry (per MTN's
 * expires_in, typically 3600s) so every requesttopay/status/balance call
 * doesn't re-authenticate.
 */
async function getAccessToken(creds: ResolvedMomoCredentials): Promise<string> {
  const cached = tokenCache.get(creds.apiUser);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  try {
    const response = await axios.post(
      `${baseUrl()}/collection/token/`,
      {},
      {
        auth: { username: creds.apiUser, password: creds.apiKey },
        headers: { 'Ocp-Apim-Subscription-Key': creds.subscriptionKey },
      }
    );
    const token = response.data.access_token;
    const expiresInSeconds = Number(response.data.expires_in) || 3600;
    tokenCache.set(creds.apiUser, { value: token, expiresAt: Date.now() + (expiresInSeconds - 60) * 1000 });
    return token;
  } catch (error: any) {
    throw new MomoServiceError(
      error.response?.data?.message || 'Failed to authenticate with MTN MoMo.',
      error.response?.status || 502
    );
  }
}

/**
 * POST /collection/v1_0/requesttopay - sends a real USSD payment prompt to
 * the customer's phone for them to approve. Returns 202 with no body; the
 * caller-generated X-Reference-Id (a UUID) is the only handle to check the
 * result later via getTransactionStatus - MTN's Collections API has no
 * synchronous "did it work" response.
 */
export async function requestToPay(tenant: MomoTenantCredentials, input: MomoRequestToPayInput): Promise<{ referenceId: string }> {
  const creds = resolveCredentials(tenant);
  const token = await getAccessToken(creds);
  const referenceId = crypto.randomUUID();

  try {
    await axios.post(
      `${baseUrl()}/collection/v1_0/requesttopay`,
      {
        amount: input.amount.toFixed(2),
        currency: input.currency,
        externalId: input.externalId,
        payer: { partyIdType: 'MSISDN', partyId: input.phoneNumber },
        payerMessage: input.payerMessage || 'Invoice payment',
        payeeNote: input.payeeNote || 'Invoice payment',
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Ocp-Apim-Subscription-Key': creds.subscriptionKey,
          'X-Target-Environment': targetEnvironment(),
          'X-Reference-Id': referenceId,
          'Content-Type': 'application/json',
        },
      }
    );
    return { referenceId };
  } catch (error: any) {
    throw new MomoServiceError(
      error.response?.data?.message || 'Failed to initiate MTN MoMo payment request.',
      error.response?.status || 502
    );
  }
}

/**
 * GET /collection/v1_0/requesttopay/{referenceId} - polls the real result of
 * a previously-initiated request. MTN's Collections API has no bulk
 * transaction-history endpoint (unlike Mono's bank-feed model, which lists
 * an account's whole statement), so this per-reference poll is the only way
 * to learn whether the customer approved the prompt.
 */
export async function getTransactionStatus(tenant: MomoTenantCredentials, referenceId: string): Promise<MomoTransactionStatus> {
  const creds = resolveCredentials(tenant);
  const token = await getAccessToken(creds);
  try {
    const response = await axios.get(`${baseUrl()}/collection/v1_0/requesttopay/${referenceId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Ocp-Apim-Subscription-Key': creds.subscriptionKey,
        'X-Target-Environment': targetEnvironment(),
      },
    });
    return {
      status: response.data.status,
      financialTransactionId: response.data.financialTransactionId,
      reason: response.data.reason,
    };
  } catch (error: any) {
    throw new MomoServiceError(
      error.response?.data?.message || 'Failed to fetch MTN MoMo transaction status.',
      error.response?.status || 502
    );
  }
}

/**
 * GET /collection/v1_0/account/balance - the tenant's real MoMo wallet
 * available balance.
 */
export async function getAccountBalance(tenant: MomoTenantCredentials): Promise<MomoAccountBalance> {
  const creds = resolveCredentials(tenant);
  const token = await getAccessToken(creds);
  try {
    const response = await axios.get(`${baseUrl()}/collection/v1_0/account/balance`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Ocp-Apim-Subscription-Key': creds.subscriptionKey,
        'X-Target-Environment': targetEnvironment(),
      },
    });
    return {
      availableBalance: Number(response.data.availableBalance) || 0,
      currency: response.data.currency || 'GHS',
    };
  } catch (error: any) {
    throw new MomoServiceError(
      error.response?.data?.message || 'Failed to fetch MTN MoMo account balance.',
      error.response?.status || 502
    );
  }
}
