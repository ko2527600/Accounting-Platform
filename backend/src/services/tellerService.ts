import axios from 'axios';
import { decryptCredential } from '../utils/credentialEncryption';

const DEFAULT_BASE_URL = 'https://test.theteller.net';

export type TellerNetwork = 'VDF' | 'ATL' | 'TGO' | 'ZPY' | 'GMY';

export interface TellerTenantCredentials {
  tellerApiUsername: string | null;
  tellerMerchantId: string | null;
  tellerApiKeyEncrypted: string | null;
}

interface ResolvedTellerCredentials {
  apiUsername: string;
  apiKey: string;
  merchantId: string;
}

export interface TellerProcessInput {
  amount: number;
  phoneNumber: string;
  network: TellerNetwork;
  description?: string;
}

export interface TellerTransactionResult {
  transactionId: string;
  status: 'PENDING' | 'SUCCESSFUL' | 'FAILED';
  responseCode?: string;
  reason?: string;
}

export class TellerServiceError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number = 502) {
    super(message);
    this.name = 'TellerServiceError';
    this.statusCode = statusCode;
  }
}

/**
 * True only if this tenant has their own real TheTeller (PaySwitch) merchant
 * credentials configured - per-tenant so each tenant's collected customer
 * payments land in their own PaySwitch merchant account, not a shared
 * Ledgio one. Callers must check this and refuse to fall back to fake data
 * when false.
 */
export function isTellerConfigured(tenant: TellerTenantCredentials): boolean {
  return Boolean(tenant.tellerApiUsername && tenant.tellerApiKeyEncrypted && tenant.tellerMerchantId);
}

function resolveCredentials(tenant: TellerTenantCredentials): ResolvedTellerCredentials {
  if (!isTellerConfigured(tenant)) {
    throw new TellerServiceError('Mobile Money integration is not configured for this business yet.', 503);
  }
  return {
    apiUsername: tenant.tellerApiUsername as string,
    merchantId: tenant.tellerMerchantId as string,
    apiKey: decryptCredential(tenant.tellerApiKeyEncrypted as string),
  };
}

function baseUrl(): string {
  return process.env.TELLER_BASE_URL || DEFAULT_BASE_URL;
}

function authHeader(apiUsername: string, apiKey: string): string {
  return `Basic ${Buffer.from(`${apiUsername}:${apiKey}`).toString('base64')}`;
}

/**
 * Generates a unique 12-digit numeric transaction_id, as TheTeller's process
 * endpoint requires (not a UUID like MTN's referenceId). Built from a
 * millisecond timestamp's low-order digits plus random padding, truncated to
 * exactly 12 digits - collision odds are negligible but not zero, so the
 * real safety net is TellerPaymentRequest.transactionId's DB-level unique
 * constraint, same idempotency pattern already used elsewhere (hybrid-offline
 * POS's clientTxnId).
 */
function generateTransactionId(): string {
  const timestampPart = Date.now().toString().slice(-8);
  const randomPart = Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, '0');
  return `${timestampPart}${randomPart}`.slice(-12).padStart(12, '0');
}

function mapResult(fallbackTransactionId: string, data: any): TellerTransactionResult {
  const rawStatus = String(data?.status || '').toLowerCase();
  let status: 'PENDING' | 'SUCCESSFUL' | 'FAILED';
  if (rawStatus === 'approved') status = 'SUCCESSFUL';
  else if (rawStatus === 'declined') status = 'FAILED';
  else status = 'PENDING'; // undocumented/absent status string - treat defensively as pending
  return {
    transactionId: data?.transaction_id || fallbackTransactionId,
    status,
    responseCode: data?.code,
    reason: data?.reason,
  };
}

/**
 * POST /v1.1/transaction/process - debits the customer's mobile money
 * wallet on the given network. May return a synchronous approved/declined
 * result in the same HTTP response (unlike MTN's always-202-then-poll flow),
 * but a real USSD-prompt-to-phone approval can still leave it genuinely
 * pending, so any status that isn't a recognized approved/declined code is
 * treated as PENDING and left for checkTransactionStatus to resolve later.
 */
export async function processTransaction(tenant: TellerTenantCredentials, input: TellerProcessInput): Promise<TellerTransactionResult> {
  const creds = resolveCredentials(tenant);
  const transactionId = generateTransactionId();

  try {
    const response = await axios.post(
      `${baseUrl()}/v1.1/transaction/process`,
      {
        processing_code: '000200',
        merchant_id: creds.merchantId,
        transaction_id: transactionId,
        amount: input.amount.toFixed(2),
        subscriber_number: input.phoneNumber,
        'r-switch': input.network,
        desc: input.description || 'Invoice payment',
      },
      {
        headers: {
          Authorization: authHeader(creds.apiUsername, creds.apiKey),
          'Content-Type': 'application/json',
        },
      }
    );
    return mapResult(transactionId, response.data);
  } catch (error: any) {
    // A declined/failed response may itself arrive as a non-2xx with a body
    // shaped like the success case (status/code/reason) - surface it as a
    // mapped FAILED result rather than a generic error where possible.
    if (error.response?.data?.status || error.response?.data?.code) {
      return mapResult(transactionId, error.response.data);
    }
    throw new TellerServiceError(
      error.response?.data?.reason || 'Failed to initiate TheTeller Mobile Money transaction.',
      error.response?.status || 502
    );
  }
}

/**
 * GET /v1.1/users/transactions/{transaction_id}/status - polls the real
 * result of a previously-initiated transaction.
 */
export async function checkTransactionStatus(tenant: TellerTenantCredentials, transactionId: string): Promise<TellerTransactionResult> {
  const creds = resolveCredentials(tenant);
  try {
    const response = await axios.get(`${baseUrl()}/v1.1/users/transactions/${transactionId}/status`, {
      headers: { Authorization: authHeader(creds.apiUsername, creds.apiKey) },
    });
    return mapResult(transactionId, response.data);
  } catch (error: any) {
    throw new TellerServiceError(
      error.response?.data?.reason || 'Failed to fetch TheTeller transaction status.',
      error.response?.status || 502
    );
  }
}
