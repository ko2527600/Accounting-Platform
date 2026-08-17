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
 * Mocking MTN's API itself (the external service) is legitimate per
 * CLAUDE.md's "mocking external services is allowed for unit testing" -
 * this proves our own request/response mapping and DB persistence logic,
 * not MTN's API. Mirrors banking.test.ts's mockMonoSuccess pattern.
 */
function mockMomoToken() {
  mockedAxios.post.mockImplementation((url: string) => {
    if (url.includes('/collection/token/')) {
      return Promise.resolve({ data: { access_token: 'fake-access-token', expires_in: 3600 } });
    }
    if (url.includes('/requesttopay')) {
      return Promise.resolve({ data: {} });
    }
    return Promise.reject(new Error(`Unexpected POST ${url}`));
  });
}

function mockMomoStatus(status: 'SUCCESSFUL' | 'FAILED' | 'PENDING', extra: any = {}) {
  mockedAxios.get.mockImplementation((url: string) => {
    if (url.includes('/requesttopay/')) {
      return Promise.resolve({ data: { status, ...extra } });
    }
    if (url.includes('/account/balance')) {
      return Promise.resolve({ data: { availableBalance: '1500.00', currency: 'GHS' } });
    }
    return Promise.reject(new Error(`Unexpected GET ${url}`));
  });
}

describe('Mobile Money (MTN MoMo Collections) invoice payment collection - per-tenant credentials', () => {
  const runId = Date.now();
  const tenantSlug = `momo-corp-${runId}`;
  const tenantSchema = `tenant_momo_corp_${runId}`;
  const adminEmail = `admin_momo_${runId}@corp.com`;

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

  async function createInvoice(amount: number) {
    const res = await request(app)
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ customerId, items: [{ description: 'Consulting', quantity: 1, unitPrice: amount }] });
    expect(res.status).toBe(201);
    return res.body.data.invoice;
  }

  // This tenant's own MTN Collections credentials, set directly on the
  // Tenant row (same as a real tenant saving them in Settings) - proves the
  // per-tenant credential model, not a shared platform-wide env var.
  async function enableMomo() {
    await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        momoApiUser: 'test-api-user',
        momoSubscriptionKeyEncrypted: encryptCredential('test-subscription-key'),
        momoApiKeyEncrypted: encryptCredential('test-api-key'),
      },
    });
  }

  async function disableMomo() {
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { momoApiUser: null, momoSubscriptionKeyEncrypted: null, momoApiKeyEncrypted: null },
    });
  }

  beforeAll(async () => {
    await prisma.$connect();
    await ensureTenantTableExists(prisma);
    await ensureUserTableExists(prisma);
    await cleanupTestData();

    const onboard = await onboardTenant(prisma, {
      companyName: 'Momo Corp',
      slug: tenantSlug,
      adminEmail,
      adminPassword: 'Password123!',
      adminName: 'Momo Admin',
    });
    adminToken = onboard.token;
    tenantId = onboard.tenant.id;

    const cashAcc = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ code: '1010', name: 'Cash & Bank', type: 'ASSET' });
    cashAccountId = cashAcc.body.data.account.id;

    const revAcc = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ code: '4010', name: 'Sales Revenue', type: 'REVENUE' });
    revenueAccountId = revAcc.body.data.account.id;

    const customer = await request(app)
      .post('/api/v1/invoices/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ name: 'Momo Client', email: `momoclient_${runId}@client.com` });
    customerId = customer.body.data.customer.id;
  }, 120000);

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it('refuses to send a request (and creates no fake data) when this tenant has not configured Mobile Money', async () => {
    await disableMomo();

    const invoice = await createInvoice(500);
    const res = await request(app)
      .post(`/api/v1/momo/invoices/${invoice.id}/request`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ phoneNumber: '0244000000' });

    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);

    const list = await request(app)
      .get(`/api/v1/momo/invoices/${invoice.id}/requests`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);
    expect(list.body.data.requests.length).toBe(0);
  });

  it('rejects a request with no phone number', async () => {
    await enableMomo();
    const invoice = await createInvoice(500);
    const res = await request(app)
      .post(`/api/v1/momo/invoices/${invoice.id}/request`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({});
    expect(res.status).toBe(400);
  });

  it('sends a real requesttopay using this tenant\'s own credentials, then confirms SUCCESSFUL status and marks the invoice PAID with a real journal entry', async () => {
    await enableMomo();
    mockMomoToken();

    const invoice = await createInvoice(1000);

    const beforeLedger = await request(app)
      .get('/api/v1/ledgers/summary')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);
    const cashBefore = beforeLedger.body.data.accounts.find((a: any) => a.id === cashAccountId).closingBalance;
    const revenueBefore = beforeLedger.body.data.accounts.find((a: any) => a.id === revenueAccountId).closingBalance;

    const requestRes = await request(app)
      .post(`/api/v1/momo/invoices/${invoice.id}/request`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ phoneNumber: '0244000111' });

    expect(requestRes.status).toBe(201);
    expect(requestRes.body.data.request.status).toBe('PENDING');
    const referenceId = requestRes.body.data.request.referenceId;
    expect(referenceId).toBeTruthy();

    // Assert the mocked axios call actually used this tenant's decrypted
    // credentials, not some other tenant's or a leftover env var.
    expect(mockedAxios.post).toHaveBeenCalledWith(
      expect.stringContaining('/collection/token/'),
      {},
      expect.objectContaining({
        auth: { username: 'test-api-user', password: 'test-api-key' },
        headers: expect.objectContaining({ 'Ocp-Apim-Subscription-Key': 'test-subscription-key' }),
      })
    );

    mockMomoStatus('SUCCESSFUL', { financialTransactionId: 'mtn-fin-txn-123' });

    const statusRes = await request(app)
      .post(`/api/v1/momo/requests/${referenceId}/check-status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);

    expect(statusRes.status).toBe(200);
    expect(statusRes.body.data.request.status).toBe('SUCCESSFUL');
    expect(statusRes.body.data.request.financialTransactionId).toBe('mtn-fin-txn-123');

    const invoicesRes = await request(app)
      .get('/api/v1/invoices')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);
    const paidInvoice = invoicesRes.body.data.invoices.find((i: any) => i.id === invoice.id);
    expect(paidInvoice.status).toBe('PAID');

    const afterLedger = await request(app)
      .get('/api/v1/ledgers/summary')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);
    const cashAfter = afterLedger.body.data.accounts.find((a: any) => a.id === cashAccountId).closingBalance;
    const revenueAfter = afterLedger.body.data.accounts.find((a: any) => a.id === revenueAccountId).closingBalance;
    expect(cashAfter).toBe(cashBefore + 1000);
    expect(revenueAfter).toBe(revenueBefore - 1000);
  });

  it('records a FAILED status without touching the invoice when the customer declines', async () => {
    await enableMomo();
    mockMomoToken();

    const invoice = await createInvoice(400);
    const requestRes = await request(app)
      .post(`/api/v1/momo/invoices/${invoice.id}/request`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ phoneNumber: '0244000222' });
    const referenceId = requestRes.body.data.request.referenceId;

    mockMomoStatus('FAILED', { reason: 'PAYER_NOT_FOUND' });

    const statusRes = await request(app)
      .post(`/api/v1/momo/requests/${referenceId}/check-status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);

    expect(statusRes.status).toBe(200);
    expect(statusRes.body.data.request.status).toBe('FAILED');
    expect(statusRes.body.data.request.failureReason).toBe('PAYER_NOT_FOUND');

    const invoicesRes = await request(app)
      .get('/api/v1/invoices')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);
    const stillUnpaid = invoicesRes.body.data.invoices.find((i: any) => i.id === invoice.id);
    expect(stillUnpaid.status).not.toBe('PAID');
  });

  it('refuses to request payment against an already-paid invoice', async () => {
    await enableMomo();
    mockMomoToken();

    const invoice = await createInvoice(300);
    const requestRes = await request(app)
      .post(`/api/v1/momo/invoices/${invoice.id}/request`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ phoneNumber: '0244000333' });
    const referenceId = requestRes.body.data.request.referenceId;
    mockMomoStatus('SUCCESSFUL', { financialTransactionId: 'mtn-fin-txn-456' });
    await request(app)
      .post(`/api/v1/momo/requests/${referenceId}/check-status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);

    const secondReq = await request(app)
      .post(`/api/v1/momo/invoices/${invoice.id}/request`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ phoneNumber: '0244000333' });
    expect(secondReq.status).toBe(400);
  });

  it("returns this tenant's own real merchant wallet balance", async () => {
    await enableMomo();
    mockMomoToken();
    mockMomoStatus('PENDING');

    const res = await request(app)
      .get('/api/v1/momo/balance')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);

    expect(res.status).toBe(200);
    expect(res.body.data.balance.availableBalance).toBe(1500);
    expect(res.body.data.balance.currency).toBe('GHS');
  });

  it('returns 503 for the balance endpoint when this tenant has not configured Mobile Money', async () => {
    await disableMomo();

    const res = await request(app)
      .get('/api/v1/momo/balance')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);
    expect(res.status).toBe(503);
  });
});
