import request from 'supertest';
import axios from 'axios';
import app from '../app';
import { prisma } from '../config/db';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';
import { encryptCredential } from '../utils/credentialEncryption';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

/**
 * Mocking Paystack's API itself (the external service) is legitimate per
 * CLAUDE.md's "mocking external services is allowed for unit testing" -
 * this proves our own request/response mapping and DB persistence logic,
 * not Paystack's API. Mirrors teller.test.ts's mock pattern.
 */
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

describe('Paystack pay-now link on invoices - per-tenant credentials', () => {
  const runId = Date.now();
  const tenantSlug = `paystack-corp-${runId}`;
  const tenantSchema = `tenant_paystack_corp_${runId}`;
  const adminEmail = `admin_paystack_${runId}@corp.com`;

  let adminToken: string;
  let tenantId: string;
  let cashAccountId: string;
  let revenueAccountId: string;
  let customerId: string;

  async function cleanupTestData() {
    if (tenantId) {
      await prisma.auditLog.deleteMany({ where: { tenantId } }).catch(() => {});
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

  // This tenant's own Paystack secret key, set directly on the Tenant row
  // (same as a real tenant saving it in Settings) - proves the per-tenant
  // credential model, not a shared platform-wide env var.
  async function enablePaystack() {
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { paystackSecretKeyEncrypted: encryptCredential('sk_test_mock') },
    });
  }

  async function disablePaystack() {
    await prisma.tenant.update({ where: { id: tenantId }, data: { paystackSecretKeyEncrypted: null } });
  }

  beforeAll(async () => {
    await prisma.$connect();
    await ensureTenantTableExists(prisma);
    await ensureUserTableExists(prisma);
    await cleanupTestData();

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
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it('refuses to generate a link (and creates no fake data) when this tenant has not configured Paystack', async () => {
    await disablePaystack();

    const invoice = await createInvoice(500);
    const res = await authed(request(app).post(`/api/v1/paystack/invoices/${invoice.id}/initialize`));
    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);

    const list = await authed(request(app).get(`/api/v1/paystack/invoices/${invoice.id}/requests`));
    expect(list.body.data.requests.length).toBe(0);
  });

  it('refuses to generate a link for an already-paid invoice', async () => {
    await enablePaystack();
    mockPaystackInitialize();

    const invoice = await createInvoice(150);
    const initRes = await authed(request(app).post(`/api/v1/paystack/invoices/${invoice.id}/initialize`));
    const reference = initRes.body.data.request.reference;

    mockPaystackVerify('success', 15000);
    await authed(request(app).post(`/api/v1/paystack/requests/${reference}/verify`));

    const secondLink = await authed(request(app).post(`/api/v1/paystack/invoices/${invoice.id}/initialize`));
    expect(secondLink.status).toBe(400);
  });

  it("generates a real Paystack payment link using this tenant's own secret key for the outstanding balance", async () => {
    await enablePaystack();
    mockPaystackInitialize();

    const invoice = await createInvoice(1000);
    const res = await authed(request(app).post(`/api/v1/paystack/invoices/${invoice.id}/initialize`));

    expect(res.status).toBe(201);
    expect(res.body.data.request.status).toBe('PENDING');
    expect(Number(res.body.data.request.amount)).toBe(1000);
    expect(res.body.data.request.authorizationUrl).toBe('https://checkout.paystack.com/mock123');
    expect(res.body.data.request.reference).toBeTruthy();

    expect(mockedAxios.post).toHaveBeenCalledWith(
      expect.stringContaining('/transaction/initialize'),
      expect.anything(),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer sk_test_mock' }) })
    );
  });

  it('verifying a successful transaction marks the invoice PAID with a real journal entry', async () => {
    await enablePaystack();
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
    await enablePaystack();
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
    await enablePaystack();
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
