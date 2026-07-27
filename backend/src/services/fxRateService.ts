import axios from 'axios';
import * as fxRateCache from '../cache/fxRateCache';

const FX_API_BASE = 'https://v6.exchangerate-api.com/v6';

export class FxRateServiceError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number = 503) {
    super(message);
    this.name = 'FxRateServiceError';
    this.statusCode = statusCode;
  }
}

/**
 * True only if a real FX_RATE_API_KEY is configured. Same-currency
 * conversions never need this (handled before any API call), so most
 * tenants operating in a single currency never touch this at all.
 */
export function isFxConfigured(): boolean {
  return Boolean(process.env.FX_RATE_API_KEY);
}

function apiKey(): string {
  const key = process.env.FX_RATE_API_KEY;
  if (!key) {
    throw new FxRateServiceError('Live currency conversion is not configured for this environment.', 503);
  }
  return key;
}

/**
 * Fetches live rates for `baseCurrency` from exchangerate-api.com
 * (GET /v6/{key}/latest/{base} -> { conversion_rates: { USD: 1, EUR: 0.92, ... } }),
 * checking the Redis cache first so most requests never hit the network.
 */
export async function getLatestRates(baseCurrency: string): Promise<Record<string, number>> {
  const cached = await fxRateCache.getRatesFromCache(baseCurrency);
  if (cached) {
    return cached;
  }

  try {
    const response = await axios.get(`${FX_API_BASE}/${apiKey()}/latest/${baseCurrency}`);
    const rates = response.data?.conversion_rates;
    if (!rates || typeof rates !== 'object') {
      throw new FxRateServiceError('Unexpected response shape from FX rate provider.', 502);
    }
    await fxRateCache.setRatesInCache(baseCurrency, rates);
    return rates;
  } catch (error: any) {
    if (error instanceof FxRateServiceError) throw error;
    throw new FxRateServiceError(
      error.response?.data?.['error-type'] || 'Failed to fetch live exchange rates.',
      error.response?.status || 502
    );
  }
}

/**
 * Converts `amount` from `fromCurrency` to `toCurrency`. Same-currency
 * conversions are always exact and never touch the network or require
 * configuration - this is the common case for single-currency tenants.
 */
export async function convertAmount(amount: number, fromCurrency: string, toCurrency: string): Promise<number> {
  if (fromCurrency === toCurrency) {
    return amount;
  }

  const rates = await getLatestRates(fromCurrency);
  const rate = rates[toCurrency];
  if (typeof rate !== 'number') {
    throw new FxRateServiceError(`No exchange rate available from ${fromCurrency} to ${toCurrency}.`, 502);
  }

  return Math.round(amount * rate * 100) / 100;
}
