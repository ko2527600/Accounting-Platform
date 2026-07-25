import axios from 'axios';

const MONO_API_BASE = 'https://api.withmono.com';

export interface MonoAccountDetails {
  id: string;
  institutionName: string;
  accountName: string;
  accountNumber: string;
  currency: string;
  currentBalance: number;
}

export interface MonoTransaction {
  monoTransactionId: string;
  amount: number;
  narration: string;
  postedDate: string;
}

export class MonoServiceError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number = 502) {
    super(message);
    this.name = 'MonoServiceError';
    this.statusCode = statusCode;
  }
}

/**
 * True only if a real Mono secret key is configured. Callers must check
 * this and refuse to fall back to fake data when it's false - that
 * silent-fake-data fallback is the exact bug this integration replaces.
 */
export function isMonoConfigured(): boolean {
  return Boolean(process.env.MONO_SECRET_KEY);
}

function secretKey(): string {
  const key = process.env.MONO_SECRET_KEY;
  if (!key) {
    throw new MonoServiceError('Bank feed integration is not configured for this environment.', 503);
  }
  return key;
}

/**
 * Exchanges the one-time code returned by the Mono Connect widget for a
 * permanent Mono account id. POST /v2/accounts/auth, header mono-sec-key,
 * body { code }, response { id }. The code expires 10 minutes after issue.
 */
export async function exchangeCodeForAccountId(code: string): Promise<string> {
  try {
    const response = await axios.post(
      `${MONO_API_BASE}/v2/accounts/auth`,
      { code },
      {
        headers: {
          'mono-sec-key': secretKey(),
          'Content-Type': 'application/json',
          accept: 'application/json',
        },
      }
    );
    return response.data.id;
  } catch (error: any) {
    throw new MonoServiceError(
      error.response?.data?.message || 'Failed to exchange Mono authorization code.',
      error.response?.status || 502
    );
  }
}

/**
 * GET /v2/accounts/{id} - real institution name, account name/number,
 * currency, and current balance for a linked account.
 */
export async function getAccountDetails(monoAccountId: string): Promise<MonoAccountDetails> {
  try {
    const response = await axios.get(`${MONO_API_BASE}/v2/accounts/${monoAccountId}`, {
      headers: { 'mono-sec-key': secretKey() },
    });
    const account = response.data.account || response.data;
    return {
      id: monoAccountId,
      institutionName: account.institution?.name || account.institution || 'Unknown Institution',
      accountName: account.name || account.accountName || 'Bank Account',
      accountNumber: account.accountNumber || account.account_number || '',
      currency: account.currency || 'GHS',
      currentBalance: Number(account.balance) || 0,
    };
  } catch (error: any) {
    throw new MonoServiceError(
      error.response?.data?.message || 'Failed to fetch account details from Mono.',
      error.response?.status || 502
    );
  }
}

/**
 * GET /v2/accounts/{id}/transactions?paginate=false[&start=&end=] - real
 * statement transactions. Maps Mono's shape into the fields BankTransaction
 * actually stores (amount, payee/narration, postedDate) plus Mono's own
 * transaction id for dedupe on repeated syncs.
 */
export async function getTransactions(
  monoAccountId: string,
  opts: { start?: string; end?: string } = {}
): Promise<MonoTransaction[]> {
  try {
    const params: Record<string, string> = { paginate: 'false' };
    if (opts.start) params.start = opts.start;
    if (opts.end) params.end = opts.end;

    const response = await axios.get(`${MONO_API_BASE}/v2/accounts/${monoAccountId}/transactions`, {
      headers: { 'mono-sec-key': secretKey() },
      params,
    });

    const rawTransactions = response.data.data || response.data.transactions || [];
    return rawTransactions.map((tx: any) => ({
      monoTransactionId: tx.id || tx._id,
      amount: tx.type === 'debit' ? -Math.abs(Number(tx.amount)) : Math.abs(Number(tx.amount)),
      narration: tx.narration || 'Bank transaction',
      postedDate: tx.date || tx.postedDate || new Date().toISOString(),
    }));
  } catch (error: any) {
    throw new MonoServiceError(
      error.response?.data?.message || 'Failed to fetch transactions from Mono.',
      error.response?.status || 502
    );
  }
}

/**
 * Verifies the `mono-webhook-secret` header Mono sends on every webhook
 * request against our configured MONO_WEBHOOK_SECRET.
 */
export function verifyWebhookSecret(headerValue: string | undefined): boolean {
  const expected = process.env.MONO_WEBHOOK_SECRET;
  return Boolean(expected) && headerValue === expected;
}
