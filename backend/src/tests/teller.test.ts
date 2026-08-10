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
 * Mocking TheTeller's API itself (the external service) is legitimate per
 * CLAUDE.md's "mocking external services is allowed for unit testing" -
 * this proves our own request/response mapping and DB persistence logic,
 * not TheTeller's API. Mirrors momo.test.ts's mockMomoToken/mockMomoStatus
 * pattern, adapted for TheTeller's Basic-Auth (no token step) and
 * approved/declined response shape.
 */
function mockTellerProcess(status: 'approved' | 'declined' | 'other', extra: any = {}) {
  mockedAxios.post.mockImplementation((url: string, body: any) => {
    if (url.includes('/transaction/process')) {
      // Echo back the caller-generated transaction_id, exactly like a real
      // gateway would - a fixed mock ID here would collide with the DB's
      // real unique constraint across the multiple requests this suite sends.
      return Promise.resolve({ data: { transaction_id: body?.transaction_id, status, ...extra } });
    }
    return Promise.reject(new Error(`Unexpected POST ${url}`));
  });
}

function mockTellerStatus(status: 'approved' | 'declined' | 'other', extra: any = {}) {
  mockedAxios.get.mockImplementation((url: string) => {
    if (url.includes('/status')) {
      const transactionId = url.split('/transactions/')[1]?.split('/status')[0];
      return Promise.resolve({ data: { transaction_id: transactionId, status, ...extra } });
    }
    return Promise.reject(new Error(`Unexpected GET ${url}`));
  });
}

describe('Mobile Money (TheTeller/PaySwitch) invoice payment collection', () => {
  const runId = Date.now();
  const tenantSlug = `teller-corp-${runId}`;
  const tenantSchema = `tenant_teller_corp_${runId}`;
  const adminEmail = `admin_teller_${runId}@corp.com`;

  let adminToken: string;
  let tenantId: string;
  let cashAccountId: string;
  let revenueAccountId: string;
  let customerId: string;
  let originalApiUsername: string | undefined;
  let originalApiKey: string | undefined;
  let originalMerchantId: string | undefined;

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

  function enableTeller() {
    process.env.TELLER_API_USERNAME = 'test-api-username';
    process.env.TELLER_API_KEY = 'test-api-key';
    process.env.TELLER_MERCHANT_ID = 'test-merchant-id';
  }

  beforeAll(async () => {
    await prisma.$connect();
    await ensureTenantTableExists(prisma);
    await ensureUserTableExists(prisma);
    await cleanupTestData();

    originalApiUsername = process.env.TELLER_API_USERNAME;
    originalApiKey = process.env.TELLER_API_KEY;
    originalMerchantId = process.env.TELLER_MERCHANT_ID;

    const onboard = await onboardTenant(prisma, {
      companyName: 'Teller Corp',
      slug: tenantSlug,
      adminEmail,
      adminPassword: 'Password123!',
      adminName: 'Teller Admin',
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
      .send({ name: 'Teller Client', email: `tellerclient_${runId}@client.com` });
    customerId = customer.body.data.customer.id;
  }, 120000);

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    process.env.TELLER_API_USERNAME = originalApiUsername;
    process.env.TELLER_API_KEY = originalApiKey;
    process.env.TELLER_MERCHANT_ID = originalMerchantId;
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it('refuses to send a request (and creates no fake data) when TheTeller is not configured', async () => {
    delete process.env.TELLER_API_USERNAME;
    delete process.env.TELLER_API_KEY;
    delete process.env.TELLER_MERCHANT_ID;

    const invoice = await createInvoice(500);
    const res = await request(app)
      .post(`/api/v1/teller/invoices/${invoice.id}/request`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ phoneNumber: '0244000000', network: 'VDF' });

    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);

    const list = await request(app)
      .get(`/api/v1/teller/invoices/${invoice.id}/requests`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);
    expect(list.body.data.requests.length).toBe(0);
  });

  it('rejects a request with no phone number', async () => {
    enableTeller();
    const invoice = await createInvoice(500);
    const res = await request(app)
      .post(`/api/v1/teller/invoices/${invoice.id}/request`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ network: 'VDF' });
    expect(res.status).toBe(400);
  });

  it('rejects an invalid network, and specifically rejects MTN (use the MoMo endpoints for MTN)', async () => {
    enableTeller();
    const invoice = await createInvoice(500);

    const badNetwork = await request(app)
      .post(`/api/v1/teller/invoices/${invoice.id}/request`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ phoneNumber: '0244000000', network: 'XYZ' });
    expect(badNetwork.status).toBe(400);

    const mtnNetwork = await request(app)
      .post(`/api/v1/teller/invoices/${invoice.id}/request`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ phoneNumber: '0244000000', network: 'MTN' });
    expect(mtnNetwork.status).toBe(400);
  });

  it('sends a real process request, then confirms SUCCESSFUL status via check-status and marks the invoice PAID with a real journal entry (asynchronous path)', async () => {
    enableTeller();
    mockTellerProcess('other'); // simulates a real pending USSD prompt, not resolved synchronously

    const invoice = await createInvoice(1000);

    const beforeLedger = await request(app)
      .get('/api/v1/ledgers/summary')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);
    const cashBefore = beforeLedger.body.data.accounts.find((a: any) => a.id === cashAccountId).closingBalance;
    const revenueBefore = beforeLedger.body.data.accounts.find((a: any) => a.id === revenueAccountId).closingBalance;

    const requestRes = await request(app)
      .post(`/api/v1/teller/invoices/${invoice.id}/request`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ phoneNumber: '0244000111', network: 'VDF' });

    expect(requestRes.status).toBe(201);
    expect(requestRes.body.data.request.status).toBe('PENDING');
    expect(requestRes.body.data.request.network).toBe('VDF');
    const transactionId = requestRes.body.data.request.transactionId;
    expect(transactionId).toBeTruthy();

    mockTellerStatus('approved', { code: '000' });

    const statusRes = await request(app)
      .post(`/api/v1/teller/requests/${transactionId}/check-status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);

    expect(statusRes.status).toBe(200);
    expect(statusRes.body.data.request.status).toBe('SUCCESSFUL');

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

  it('marks the invoice PAID immediately when TheTeller resolves synchronously in the request response (no check-status call needed)', async () => {
    enableTeller();
    mockTellerProcess('approved', { code: '000' });

    const invoice = await createInvoice(750);

    const requestRes = await request(app)
      .post(`/api/v1/teller/invoices/${invoice.id}/request`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ phoneNumber: '0244000999', network: 'ATL' });

    expect(requestRes.status).toBe(201);
    expect(requestRes.body.data.request.status).toBe('SUCCESSFUL');

    const invoicesRes = await request(app)
      .get('/api/v1/invoices')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);
    const paidInvoice = invoicesRes.body.data.invoices.find((i: any) => i.id === invoice.id);
    expect(paidInvoice.status).toBe('PAID');
  });

  it('records a FAILED status without touching the invoice when the customer declines', async () => {
    enableTeller();
    mockTellerProcess('other');

    const invoice = await createInvoice(400);
    const requestRes = await request(app)
      .post(`/api/v1/teller/invoices/${invoice.id}/request`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ phoneNumber: '0244000222', network: 'ZPY' });
    const transactionId = requestRes.body.data.request.transactionId;

    mockTellerStatus('declined', { code: '905', reason: 'INSUFFICIENT_FUNDS' });

    const statusRes = await request(app)
      .post(`/api/v1/teller/requests/${transactionId}/check-status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);

    expect(statusRes.status).toBe(200);
    expect(statusRes.body.data.request.status).toBe('FAILED');
    expect(statusRes.body.data.request.failureReason).toBe('INSUFFICIENT_FUNDS');

    const invoicesRes = await request(app)
      .get('/api/v1/invoices')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);
    const stillUnpaid = invoicesRes.body.data.invoices.find((i: any) => i.id === invoice.id);
    expect(stillUnpaid.status).not.toBe('PAID');
  });

  it('refuses to request payment against an already-paid invoice', async () => {
    enableTeller();
    mockTellerProcess('approved', { code: '000' });

    const invoice = await createInvoice(300);
    const requestRes = await request(app)
      .post(`/api/v1/teller/invoices/${invoice.id}/request`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ phoneNumber: '0244000333', network: 'GMY' });
    expect(requestRes.body.data.request.status).toBe('SUCCESSFUL');

    const secondReq = await request(app)
      .post(`/api/v1/teller/invoices/${invoice.id}/request`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ phoneNumber: '0244000333', network: 'GMY' });
    expect(secondReq.status).toBe(400);
  });
});
