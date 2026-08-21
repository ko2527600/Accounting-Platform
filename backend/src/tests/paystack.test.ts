import { deleteAuditLogs } from './testHelpers';
import request from 'supertest';
import axios from 'axios';
import app from '../app';
import { prisma } from '../config/db';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

/**
 * Mocking Paystack's API itself (the external service) is legitimate per
 * CLAUDE.md's "mocking external services is allowed for unit testing" -
 * this proves our own request/response mapping and DB persistence logic,
 * not Paystack's API. Real response shapes verified against Paystack's own
 * documentation (paystack.com/docs/api/subaccount, /miscellaneous,
 * /verification) before writing this, not guessed.
 */
function mockPaystackBanks() {
  const banks = [
    { name: 'Ecobank Ghana Limited', code: '130' },
    { name: 'GCB Bank Limited', code: '040' },
  ];
  mockedAxios.get.mockImplementation((url: string) => {
    if (url.endsWith('/bank')) {
      return Promise.resolve({ data: { status: true, message: 'Banks retrieved', data: banks } });
    }
    return Promise.reject(new Error(`Unexpected GET ${url}`));
  });
  return banks;
}

function mockPaystackMobileMoneyBanks() {
  const banks = [
    { name: 'MTN Mobile Money', code: 'MTN' },
    { name: 'AirtelTigo Money', code: 'ATL' },
    { name: 'Telecel Cash', code: 'VOD' },
  ];
  mockedAxios.get.mockImplementation((url: string) => {
    if (url.endsWith('/bank')) {
      return Promise.resolve({ data: { status: true, message: 'Banks retrieved', data: banks } });
    }
    return Promise.reject(new Error(`Unexpected GET ${url}`));
  });
  return banks;
}

function mockPaystackResolve(accountName: string) {
  mockedAxios.get.mockImplementation((url: string, config: any) => {
    if (url.includes('/bank/resolve')) {
      return Promise.resolve({
        data: {
          status: true,
          message: 'Account number resolved',
          data: { account_number: config?.params?.account_number, account_name: accountName },
        },
      });
    }
    return Promise.reject(new Error(`Unexpected GET ${url}`));
  });
}

function mockPaystackCreateSubaccount(subaccountCode: string, accountName: string, isVerified = false) {
  mockedAxios.post.mockImplementation((url: string) => {
    if (url.endsWith('/subaccount')) {
      return Promise.resolve({
        data: {
          status: true,
          message: 'Subaccount created',
          data: { subaccount_code: subaccountCode, account_name: accountName, is_verified: isVerified },
        },
      });
    }
    return Promise.reject(new Error(`Unexpected POST ${url}`));
  });
}

function mockPaystackInitialize() {
  mockedAxios.post.mockImplementation((url: string, body: any) => {
    if (url.includes('/transaction/initialize')) {
      return Promise.resolve({
        data: {
          status: true,
          data: {
            authorization_url: 'https://checkout.paystack.com/mock123',
            access_code: 'mock_access_code',
            reference: body?.reference,
          },
        },
      });
    }
    return Promise.reject(new Error(`Unexpected POST ${url}`));
  });
}

function mockPaystackVerify(status: 'success' | 'failed' | 'abandoned', amountSubunit: number, extra: any = {}) {
  mockedAxios.get.mockImplementation((url: string) => {
    if (url.includes('/transaction/verify/')) {
      const reference = decodeURIComponent(url.split('/transaction/verify/')[1]);
      return Promise.resolve({
        data: { status: true, data: { status, reference, amount: amountSubunit, currency: 'GHS', ...extra } },
      });
    }
    return Promise.reject(new Error(`Unexpected GET ${url}`));
  });
}

describe('Paystack pay-now link on invoices - Subaccounts (platform-wide key + per-tenant bank settlement)', () => {
  const runId = Date.now();
  const tenantSlug = `paystack-corp-${runId}`;
  const tenantSchema = `tenant_paystack_corp_${runId}`;
  const adminEmail = `admin_paystack_${runId}@corp.com`;

  let adminToken: string;
  let tenantId: string;
  let cashAccountId: string;
  let revenueAccountId: string;
  let customerId: string;
  let originalSecretKey: string | undefined;

  async function cleanupTestData() {
    if (tenantId) {
      await deleteAuditLogs(prisma, { tenantId });
    }
    await deleteTenantBySlug(prisma, tenantSlug).catch(() => {});
    await deleteUserByEmail(prisma, adminEmail).catch(() => {});
    await dropTenantSchema(prisma, tenantSchema).catch(() => {});
  }

  function authed(req: request.Test): request.Test {
    return req.set('Authorization', `Bearer ${adminToken}`).set('X-Tenant-ID', tenantSlug);
  }

  async function createInvoice(amount: number) {
    const res = await authed(request(app).post('/api/v1/invoices')).send({
      customerId,
      items: [{ description: 'Consulting', quantity: 1, unitPrice: amount }],
    });
    expect(res.status).toBe(201);
    return res.body.data.invoice;
  }

  // Platform-wide Ledgio Paystack key (not per-tenant - see paystackService.ts).
  function enablePlatformPaystack() {
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_platform_mock';
  }

  // This tenant's subaccount, as if they'd already completed the real
  // bank-details setup in Settings - proves the invoice-collection flow
  // independently of the setup flow itself (covered separately below).
  async function givenTenantHasSubaccount() {
    await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        paystackSubaccountCode: 'ACCT_test123',
        paystackBankCode: '130',
        paystackAccountNumber: '1234567890',
        paystackAccountName: 'Paystack Corp Test Business',
      },
    });
  }

  async function clearTenantSubaccount() {
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { paystackSubaccountCode: null, paystackBankCode: null, paystackAccountNumber: null, paystackAccountName: null },
    });
  }

  beforeAll(async () => {
    await prisma.$connect();
    await ensureTenantTableExists(prisma);
    await ensureUserTableExists(prisma);
    await cleanupTestData();

    originalSecretKey = process.env.PAYSTACK_SECRET_KEY;

    const onboard = await onboardTenant(prisma, {
      companyName: 'Paystack Corp',
      slug: tenantSlug,
      adminEmail,
      adminPassword: 'Password123!',
      adminName: 'Paystack Admin',
    });
    adminToken = onboard.token;
    tenantId = onboard.tenant.id;

    const cashAcc = await authed(request(app).post('/api/v1/accounts')).send({ code: '1010', name: 'Cash & Bank', type: 'ASSET' });
    cashAccountId = cashAcc.body.data.account.id;

    const revAcc = await authed(request(app).post('/api/v1/accounts')).send({ code: '4010', name: 'Sales Revenue', type: 'REVENUE' });
    revenueAccountId = revAcc.body.data.account.id;

    const customer = await authed(request(app).post('/api/v1/invoices/customers')).send({
      name: 'Paystack Client', email: `paystackclient_${runId}@client.com`,
    });
    customerId = customer.body.data.customer.id;
  }, 120000);

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    process.env.PAYSTACK_SECRET_KEY = originalSecretKey;
    await cleanupTestData();
    await prisma.$disconnect();
  });

  describe('Bank setup (GET /banks, POST /resolve-account, POST /subaccount)', () => {
    it('returns 503 for every setup endpoint when the platform Paystack key is not configured', async () => {
      delete process.env.PAYSTACK_SECRET_KEY;

      const banks = await authed(request(app).get('/api/v1/paystack/banks'));
      expect(banks.status).toBe(503);

      const resolve = await authed(request(app).post('/api/v1/paystack/resolve-account')).send({ accountNumber: '123', bankCode: '130' });
      expect(resolve.status).toBe(503);

      const sub = await authed(request(app).post('/api/v1/paystack/subaccount')).send({ accountNumber: '123', bankCode: '130' });
      expect(sub.status).toBe(503);
    });

    it('returns the real bank list, defaulting to real Ghanaian banks', async () => {
      enablePlatformPaystack();
      const banks = mockPaystackBanks();

      const res = await authed(request(app).get('/api/v1/paystack/banks'));
      expect(res.status).toBe(200);
      expect(res.body.data.banks).toEqual(banks);

      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.stringContaining('/bank'),
        expect.objectContaining({ params: expect.objectContaining({ type: 'ghipss' }) })
      );
    });

    it("returns MTN/AirtelTigo/Telecel Mobile Money as settlement options for a tenant with no bank account", async () => {
      enablePlatformPaystack();
      const banks = mockPaystackMobileMoneyBanks();

      const res = await authed(request(app).get('/api/v1/paystack/banks').query({ channel: 'mobile_money' }));
      expect(res.status).toBe(200);
      expect(res.body.data.banks).toEqual(banks);

      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.stringContaining('/bank'),
        expect.objectContaining({ params: expect.objectContaining({ type: 'mobile_money' }) })
      );
    });

    it('resolves a real account name for a bank/account number', async () => {
      enablePlatformPaystack();
      mockPaystackResolve('Paystack Corp Test Business');

      const res = await authed(request(app).post('/api/v1/paystack/resolve-account')).send({
        accountNumber: '1234567890',
        bankCode: '130',
      });
      expect(res.status).toBe(200);
      expect(res.body.data.account.accountName).toBe('Paystack Corp Test Business');
    });

    it('creates a real subaccount and persists it on the tenant, never asking for a Paystack secret key', async () => {
      await clearTenantSubaccount();
      enablePlatformPaystack();
      mockPaystackCreateSubaccount('ACCT_realsub456', 'Paystack Corp Test Business', true);

      const res = await authed(request(app).post('/api/v1/paystack/subaccount')).send({
        accountNumber: '1234567890',
        bankCode: '130',
      });

      expect(res.status).toBe(201);
      expect(res.body.data.subaccountCode).toBe('ACCT_realsub456');
      expect(res.body.data.accountName).toBe('Paystack Corp Test Business');

      // Real DB persistence, not just the response.
      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
      expect(tenant?.paystackSubaccountCode).toBe('ACCT_realsub456');
      expect(tenant?.paystackAccountNumber).toBe('1234567890');

      const settingsRes = await authed(request(app).get('/api/v1/tenants/current'));
      expect(settingsRes.body.data.tenant.paystackConfigured).toBe(true);
      expect(settingsRes.body.data.tenant.paystackSubaccountCode).toBe('ACCT_realsub456');
    });

    it('refuses to create a second subaccount when one is already configured', async () => {
      enablePlatformPaystack();
      mockPaystackCreateSubaccount('ACCT_shouldnothappen', 'X');

      const res = await authed(request(app).post('/api/v1/paystack/subaccount')).send({
        accountNumber: '9999999999',
        bankCode: '040',
      });
      expect(res.status).toBe(400);
    });
  });

  describe('Invoice pay-now links', () => {
    it('refuses to generate a link (and creates no fake data) when this tenant has not set up bank settlement', async () => {
      enablePlatformPaystack();
      await clearTenantSubaccount();

      const invoice = await createInvoice(500);
      const res = await authed(request(app).post(`/api/v1/paystack/invoices/${invoice.id}/initialize`));
      expect(res.status).toBe(503);
      expect(res.body.success).toBe(false);

      const list = await authed(request(app).get(`/api/v1/paystack/invoices/${invoice.id}/requests`));
      expect(list.body.data.requests.length).toBe(0);
    });

    it('refuses to generate a link for an already-paid invoice', async () => {
      enablePlatformPaystack();
      await givenTenantHasSubaccount();
      mockPaystackInitialize();

      const invoice = await createInvoice(150);
      const initRes = await authed(request(app).post(`/api/v1/paystack/invoices/${invoice.id}/initialize`));
      const reference = initRes.body.data.request.reference;

      mockPaystackVerify('success', 15000);
      await authed(request(app).post(`/api/v1/paystack/requests/${reference}/verify`));

      const secondLink = await authed(request(app).post(`/api/v1/paystack/invoices/${invoice.id}/initialize`));
      expect(secondLink.status).toBe(400);
    });

    it("generates a real Paystack payment link that routes the split to this tenant's subaccount", async () => {
      enablePlatformPaystack();
      await givenTenantHasSubaccount();
      mockPaystackInitialize();

      const invoice = await createInvoice(1000);
      const res = await authed(request(app).post(`/api/v1/paystack/invoices/${invoice.id}/initialize`));

      expect(res.status).toBe(201);
      expect(res.body.data.request.status).toBe('PENDING');
      expect(Number(res.body.data.request.amount)).toBe(1000);
      expect(res.body.data.request.authorizationUrl).toBe('https://checkout.paystack.com/mock123');
      expect(res.body.data.request.reference).toBeTruthy();

      // The actual regression check: this tenant's subaccount code (not
      // another tenant's, not omitted) is what routes the split.
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('/transaction/initialize'),
        expect.objectContaining({ subaccount: 'ACCT_test123' }),
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer sk_test_platform_mock' }) })
      );
    });

    it('verifying a successful transaction marks the invoice PAID with a real journal entry', async () => {
      enablePlatformPaystack();
      await givenTenantHasSubaccount();
      mockPaystackInitialize();

      const invoice = await createInvoice(800);

      const beforeLedger = await authed(request(app).get('/api/v1/ledgers/summary'));
      const cashBefore = beforeLedger.body.data.accounts.find((a: any) => a.id === cashAccountId).closingBalance;
      const revenueBefore = beforeLedger.body.data.accounts.find((a: any) => a.id === revenueAccountId).closingBalance;

      const initRes = await authed(request(app).post(`/api/v1/paystack/invoices/${invoice.id}/initialize`));
      const reference = initRes.body.data.request.reference;

      mockPaystackVerify('success', 80000);

      const verifyRes = await authed(request(app).post(`/api/v1/paystack/requests/${reference}/verify`));
      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.data.request.status).toBe('SUCCESSFUL');

      const invoicesRes = await authed(request(app).get('/api/v1/invoices'));
      const paidInvoice = invoicesRes.body.data.invoices.find((i: any) => i.id === invoice.id);
      expect(paidInvoice.status).toBe('PAID');

      const afterLedger = await authed(request(app).get('/api/v1/ledgers/summary'));
      const cashAfter = afterLedger.body.data.accounts.find((a: any) => a.id === cashAccountId).closingBalance;
      const revenueAfter = afterLedger.body.data.accounts.find((a: any) => a.id === revenueAccountId).closingBalance;
      expect(cashAfter).toBe(cashBefore + 800);
      expect(revenueAfter).toBe(revenueBefore - 800);
    });

    it('records a FAILED status without touching the invoice when verification fails', async () => {
      enablePlatformPaystack();
      await givenTenantHasSubaccount();
      mockPaystackInitialize();

      const invoice = await createInvoice(400);
      const initRes = await authed(request(app).post(`/api/v1/paystack/invoices/${invoice.id}/initialize`));
      const reference = initRes.body.data.request.reference;

      mockPaystackVerify('failed', 40000, { gateway_response: 'Declined' });

      const verifyRes = await authed(request(app).post(`/api/v1/paystack/requests/${reference}/verify`));
      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.data.request.status).toBe('FAILED');

      const invoicesRes = await authed(request(app).get('/api/v1/invoices'));
      const stillUnpaid = invoicesRes.body.data.invoices.find((i: any) => i.id === invoice.id);
      expect(stillUnpaid.status).not.toBe('PAID');
    });

    it('re-verifying an already-successful request is a no-op that does not double-pay', async () => {
      enablePlatformPaystack();
      await givenTenantHasSubaccount();
      mockPaystackInitialize();

      const invoice = await createInvoice(250);
      const initRes = await authed(request(app).post(`/api/v1/paystack/invoices/${invoice.id}/initialize`));
      const reference = initRes.body.data.request.reference;

      mockPaystackVerify('success', 25000);
      const firstVerify = await authed(request(app).post(`/api/v1/paystack/requests/${reference}/verify`));
      expect(firstVerify.body.data.request.status).toBe('SUCCESSFUL');

      const secondVerify = await authed(request(app).post(`/api/v1/paystack/requests/${reference}/verify`));
      expect(secondVerify.status).toBe(200);
      expect(secondVerify.body.message).toBe('Payment already verified.');

      const invoicesRes = await authed(request(app).get('/api/v1/invoices'));
      const paidInvoice = invoicesRes.body.data.invoices.find((i: any) => i.id === invoice.id);
      expect(paidInvoice.status).toBe('PAID');
      expect(Number(paidInvoice.amountPaid)).toBe(250);
    });
  });
});
