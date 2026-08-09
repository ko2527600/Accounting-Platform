import axios from 'axios';
import crypto from 'crypto';

const DEFAULT_BASE_URL = 'https://sandbox.momodeveloper.mtn.com';

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
 * True only if real MTN MoMo Collections credentials are configured: a
 * subscription key (Ocp-Apim-Subscription-Key) plus an API user/key pair
 * pre-provisioned once via MTN's POST /v1_0/apiuser and
 * POST /v1_0/apiuser/{userId}/apikey endpoints - that provisioning is a
 * one-time setup step, not something this service does per request.
 * Callers must check this and refuse to fall back to fake data when false.
 */
export function isMomoConfigured(): boolean {
  return Boolean(process.env.MOMO_SUBSCRIPTION_KEY && process.env.MOMO_API_USER && process.env.MOMO_API_KEY);
}

function config() {
  const subscriptionKey = process.env.MOMO_SUBSCRIPTION_KEY;
  const apiUser = process.env.MOMO_API_USER;
  const apiKey = process.env.MOMO_API_KEY;
  if (!subscriptionKey || !apiUser || !apiKey) {
    throw new MomoServiceError('Mobile Money integration is not configured for this environment.', 503);
  }
  return {
    subscriptionKey,
    apiUser,
    apiKey,
    baseUrl: process.env.MOMO_BASE_URL || DEFAULT_BASE_URL,
    targetEnvironment: process.env.MOMO_TARGET_ENVIRONMENT || 'sandbox',
  };
}

let cachedToken: { value: string; expiresAt: number } | null = null;

/**
 * POST /collection/token/ - exchanges the pre-provisioned API user/key
 * (Basic Auth) for a short-lived Bearer access token. Cached in-memory
 * until shortly before its real expiry (per MTN's expires_in, typically
 * 3600s) so every requesttopay/status/balance call doesn't re-authenticate.
 */
async function getAccessToken(): Promise<string> {
  const cfg = config();
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.value;
  }
  try {
    const response = await axios.post(
      `${cfg.baseUrl}/collection/token/`,
      {},
      {
        auth: { username: cfg.apiUser, password: cfg.apiKey },
        headers: { 'Ocp-Apim-Subscription-Key': cfg.subscriptionKey },
      }
    );
    const token = response.data.access_token;
    const expiresInSeconds = Number(response.data.expires_in) || 3600;
    cachedToken = { value: token, expiresAt: Date.now() + (expiresInSeconds - 60) * 1000 };
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
export async function requestToPay(input: MomoRequestToPayInput): Promise<{ referenceId: string }> {
  const cfg = config();
  const token = await getAccessToken();
  const referenceId = crypto.randomUUID();

  try {
    await axios.post(
      `${cfg.baseUrl}/collection/v1_0/requesttopay`,
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
          'Ocp-Apim-Subscription-Key': cfg.subscriptionKey,
          'X-Target-Environment': cfg.targetEnvironment,
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
export async function getTransactionStatus(referenceId: string): Promise<MomoTransactionStatus> {
  const cfg = config();
  const token = await getAccessToken();
  try {
    const response = await axios.get(`${cfg.baseUrl}/collection/v1_0/requesttopay/${referenceId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Ocp-Apim-Subscription-Key': cfg.subscriptionKey,
        'X-Target-Environment': cfg.targetEnvironment,
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
 * GET /collection/v1_0/account/balance - the merchant's real MoMo wallet
 * available balance.
 */
export async function getAccountBalance(): Promise<MomoAccountBalance> {
  const cfg = config();
  const token = await getAccessToken();
  try {
    const response = await axios.get(`${cfg.baseUrl}/collection/v1_0/account/balance`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Ocp-Apim-Subscription-Key': cfg.subscriptionKey,
        'X-Target-Environment': cfg.targetEnvironment,
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
