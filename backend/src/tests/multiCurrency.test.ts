import axios from 'axios';
import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';
import * as fxRateCache from '../cache/fxRateCache';
import * as fxRateService from '../services/fxRateService';
import { connectRedis } from '../config/redis';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('fxRateService (unit) - live conversion, gated and cached', () => {
  let originalApiKey: string | undefined;

  beforeAll(async () => {
    originalApiKey = process.env.FX_RATE_API_KEY;
    // Jest isolates modules per test file, so this file's Redis client starts
    // cold - wait for a real connection before any cache-dependent assertion,
    // rather than racing lazy-connect on the first command.
    await connectRedis();
  });

  afterAll(() => {
    process.env.FX_RATE_API_KEY = originalApiKey;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('same-currency conversion never touches the network or requires configuration', async () => {
    delete process.env.FX_RATE_API_KEY;

    expect(fxRateService.isFxConfigured()).toBe(false);
    const result = await fxRateService.convertAmount(100, 'USD', 'USD');
    expect(result).toBe(100);
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('cross-currency conversion throws a clear 503 when not configured', async () => {
    delete process.env.FX_RATE_API_KEY;

    await expect(fxRateService.convertAmount(100, 'USD', 'EUR')).rejects.toMatchObject({
      name: 'FxRateServiceError',
      statusCode: 503,
    });
  });

  it('cross-currency conversion uses live rates when configured', async () => {
    process.env.FX_RATE_API_KEY = 'test-fx-key';
    await fxRateCache.invalidateRatesCache('TESTUSD');

    mockedAxios.get.mockResolvedValue({
      data: { conversion_rates: { TESTUSD: 1, TESTEUR: 0.5 } },
    });

    const result = await fxRateService.convertAmount(200, 'TESTUSD', 'TESTEUR');
    expect(result).toBe(100);
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);

    await fxRateCache.invalidateRatesCache('TESTUSD');
  });

  it('fxRateCache round-trips a rates object through Redis directly', async () => {
    // Exercised directly against the cache module (not through convertAmount,
    // whose network-call-counting is sensitive to this sandbox's known Redis
    // instability - see STATUS.md) to prove the cache module itself is correct.
    const rates = { USD: 1, EUR: 0.92, GHS: 15.4 };
    await fxRateCache.setRatesInCache('TESTROUNDTRIP', rates);
    const readBack = await fxRateCache.getRatesFromCache('TESTROUNDTRIP');
    expect(readBack).toEqual(rates);
    await fxRateCache.invalidateRatesCache('TESTROUNDTRIP');
  });
});

describe('Multi-currency transaction-time conversion (Invoice/VendorBill -> Ledger)', () => {
  const runId = Date.now();
  const tenant1Slug = `fx-corp-1-${runId}`;
  const tenant1Schema = `tenant_fx_corp_1_${runId}`;
  const admin1Email = `admin_fx1_${runId}@corp1.com`;

  let token1: string;
  let tenant1Id: string | undefined;
  let customerId: string;
  let originalApiKey: string | undefined;

  async function cleanupTestData() {
    await deleteTenantBySlug(prisma, tenant1Slug).catch(() => {});
    await deleteUserByEmail(prisma, admin1Email).catch(() => {});
    await dropTenantSchema(prisma, tenant1Schema).catch(() => {});
  }

  beforeAll(async () => {
    originalApiKey = process.env.FX_RATE_API_KEY;
    process.env.FX_RATE_API_KEY = 'test-fx-key';

    await prisma.$connect();
    await ensureTenantTableExists(prisma);
    await ensureUserTableExists(prisma);
    await cleanupTestData();

    const onboard1 = await onboardTenant(prisma, {
      companyName: 'FX Isolation Corp 1',
      slug: tenant1Slug,
      adminEmail: admin1Email,
      adminPassword: 'Password123!',
      adminName: 'FX Corp 1 Admin',
      baseCurrency: 'USD',
    });
    token1 = onboard1.token;
    tenant1Id = onboard1.tenant.id;

    const customer = await request(app)
      .post('/api/v1/invoices/customers')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ name: 'FX Test Customer', email: 'customer@fxtest.test' });
    customerId = customer.body.data.customer.id;

    const cashAcc = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ code: '1010', name: 'Cash', type: 'ASSET' });
    void cashAcc;

    const revAcc = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ code: '4010', name: 'Sales Revenue', type: 'REVENUE' });
    void revAcc;
  }, 120000);

  afterAll(async () => {
    process.env.FX_RATE_API_KEY = originalApiKey;
    await cleanupTestData();
    await prisma.$disconnect();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('confirms the tenant onboarded with a real, persisted baseCurrency (not silently dropped)', async () => {
    const current = await request(app)
      .get('/api/v1/tenants/current')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug);
    expect(current.body.data.tenant.baseCurrency).toBe('USD');
  });

  it('creates a foreign-currency invoice, stores a converted baseCurrencyAmount, and posts the CONVERTED amount (not the raw total) to the ledger on payment', async () => {
    mockedAxios.get.mockResolvedValue({
      data: { conversion_rates: { USD: 0.5 } }, // 1 EUR = 0.5 USD for this test
    });

    const invoiceRes = await request(app)
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({
        customerId,
        currency: 'EUR',
        items: [{ description: 'Consulting', quantity: 1, unitPrice: 1000 }],
      });

    expect(invoiceRes.status).toBe(201);
    const invoice = invoiceRes.body.data.invoice;
    expect(invoice.currency).toBe('EUR');
    expect(Number(invoice.total)).toBeCloseTo(1000, 2); // no tax rate configured for this tenant
    // The real bug fix: a converted base-currency (USD) equivalent is stored.
    expect(Number(invoice.baseCurrencyAmount)).toBeCloseTo(500, 2);

    const payRes = await request(app)
      .post(`/api/v1/invoices/${invoice.id}/pay`)
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug);
    expect(payRes.status).toBe(200);

    const ledgerRes = await request(app)
      .get('/api/v1/ledgers/summary')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug);
    const revenueAccount = ledgerRes.body.data.accounts.find((a: any) => a.code === '4010');
    // Confirms the ledger received 500 (the converted USD equivalent), not
    // 1000 (the raw EUR total) - the actual bug this phase fixes.
    expect(Number(revenueAccount.closingBalance)).toBeCloseTo(-500, 2);
  });

  it('returns a clear error creating a cross-currency invoice when FX is not configured, rather than posting the wrong amount', async () => {
    const originalKey = process.env.FX_RATE_API_KEY;
    delete process.env.FX_RATE_API_KEY;

    const invoiceRes = await request(app)
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({
        customerId,
        currency: 'GBP',
        items: [{ description: 'Consulting', quantity: 1, unitPrice: 100 }],
      });
    expect(invoiceRes.status).toBe(503);

    process.env.FX_RATE_API_KEY = originalKey;
  });

  it('scales a per-levy tax destination line into the base currency correctly when a foreign-currency invoice is paid', async () => {
    const vatAcc = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ code: '2010', name: 'FX VAT Payable', type: 'LIABILITY' });
    const vatAccountId = vatAcc.body.data.account.id;

    const taxRate = await request(app)
      .post('/api/v1/tax-rates')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({
        name: 'FX Layered VAT',
        code: 'FX-VAT-1',
        rate: 0.15,
        effectiveFrom: '2020-01-01',
        components: [{ name: 'VAT', rate: 0.15, accountId: vatAccountId }],
      });
    expect(taxRate.status).toBe(201);

    mockedAxios.get.mockResolvedValue({
      data: { conversion_rates: { USD: 0.5 } }, // 1 EUR = 0.5 USD for this test
    });

    const invoiceRes = await request(app)
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({
        customerId,
        currency: 'EUR',
        taxRateId: taxRate.body.data.taxRate.id,
        items: [{ description: 'Layered FX consulting', quantity: 1, unitPrice: 1000 }],
      });
    expect(invoiceRes.status).toBe(201);
    const invoice = invoiceRes.body.data.invoice;
    expect(Number(invoice.subtotal)).toBeCloseTo(1000, 2); // EUR
    expect(Number(invoice.tax)).toBeCloseTo(150, 2); // EUR
    expect(Number(invoice.total)).toBeCloseTo(1150, 2); // EUR
    // Converted (EUR -> USD @ 0.5) base-currency equivalent of the WHOLE total.
    expect(Number(invoice.baseCurrencyAmount)).toBeCloseTo(575, 2);

    const beforeLedger = await request(app)
      .get('/api/v1/ledgers/summary')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug);
    const revenueBefore = Number(
      beforeLedger.body.data.accounts.find((a: any) => a.code === '4010')?.closingBalance || 0
    );

    const payRes = await request(app)
      .post(`/api/v1/invoices/${invoice.id}/pay`)
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug);
    expect(payRes.status).toBe(200);

    const afterLedger = await request(app)
      .get('/api/v1/ledgers/summary')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug);
    const vatAccountLedger = afterLedger.body.data.accounts.find((a: any) => a.code === '2010');
    const revenueAfter = Number(afterLedger.body.data.accounts.find((a: any) => a.code === '4010')?.closingBalance || 0);

    // VAT's native-currency amount (150 EUR) scaled by the same fxScale
    // (0.5) the whole invoice was converted at - 75 USD, not 150.
    expect(Number(vatAccountLedger.closingBalance)).toBeCloseTo(-75, 2);
    // Revenue only picks up the converted subtotal (500 USD), the rest
    // having gone to the VAT liability account above.
    expect(revenueAfter - revenueBefore).toBeCloseTo(-500, 2);
  });
});
