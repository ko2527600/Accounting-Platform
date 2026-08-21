import request from 'supertest';
import axios from 'axios';
import app from '../app';
import { prisma } from '../config/db';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';
import { encryptCredential, decryptCredential } from '../utils/credentialEncryption';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

/**
 * Mocking GRA's VSDC API itself (the external service) is legitimate per
 * CLAUDE.md's "mocking external services is allowed for unit testing" - this
 * proves our own request/response mapping and DB persistence logic against
 * the real documented schema ("GRA E-VAT API - VER 8.2"), not GRA's actual
 * server. Mirrors paystack.test.ts's mock pattern.
 */
function mockGraSuccess() {
  mockedAxios.post.mockResolvedValue({
    data: {
      response: {
        distributor_tin: 'C0034186913',
        mesaage: {
          num: 'NS230724-9000001',
          ysdcid: 'EV-260623-001',
          ysdcrecnum: '83NS',
          ysdcintdata: 'NUGABIDWABF5MRRN2EXDUSJ7M4',
          ysdcregsig: 'E4OFBGZX2MT6YBTQ',
          ysdcmrc: '2b60f37f175c7c',
          ysdcmrctim: '2023/07/24 09:09:36',
          ysdctime: '2023/07/24 09:09:36',
          flag: 'INVOICE',
          ysdcitems: '1',
        },
        qr_code: 'https://verification.vat-gh.com?data=abc123&v=1.0',
        status: 'SUCCESS',
      },
    },
  });
}

function mockGraRejection() {
  mockedAxios.post.mockResolvedValue({
    data: { response: { status: 'FAILED', mesaage: null } },
  });
}

function mockGraNetworkError() {
  const error: any = new Error('Request failed');
  error.response = { status: 401, data: { message: 'Invalid security_key' } };
  mockedAxios.post.mockRejectedValue(error);
}

describe('GRA E-VAT clearance (real VSDC integration)', () => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tenantSlug = `gra-evat-corp-${runId}`;
  const tenantSchema = `tenant_gra_evat_corp_${runId}`;
  const adminEmail = `admin_gra_evat_${runId}@corp.com`;

  let adminToken: string;
  let customerId: string;

  async function cleanupTestData() {
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

  async function configureGraCredentials() {
    const res = await authed(request(app).put('/api/v1/tenants/current')).send({
      graTin: 'C0012345678',
      vatRegistered: true,
      graDeviceNumber: '001',
      graSecurityKey: 'Z60gftKe9sei3xOZhvvDa0StkVILKR3j5MBM9ygi1zg=',
    });
    expect(res.status).toBe(200);
  }

  beforeAll(async () => {
    await prisma.$connect();
    await ensureTenantTableExists(prisma);
    await ensureUserTableExists(prisma);
    await cleanupTestData();

    const onboard = await onboardTenant(prisma, {
      companyName: 'Gra Evat Corp',
      slug: tenantSlug,
      adminEmail,
      adminPassword: 'Password123!',
      adminName: 'Gra Evat Admin',
    });
    adminToken = onboard.token;

    const customer = await authed(request(app).post('/api/v1/invoices/customers')).send({
      name: 'Evat Client', email: `evatclient_${runId}@client.com`, tin: 'VC00000009055',
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

  it('encrypts and decrypts a credential round-trip correctly', () => {
    const plaintext = 'Z60gftKe9sei3xOZhvvDa0StkVILKR3j5MBM9ygi1zg=';
    const encrypted = encryptCredential(plaintext);
    expect(encrypted).not.toContain(plaintext);
    expect(decryptCredential(encrypted)).toBe(plaintext);
  });

  it('refuses to request clearance (and calls no external API) when this tenant has no GRA credentials on file', async () => {
    const invoice = await createInvoice(500);

    const res = await authed(request(app).post(`/api/v1/invoices/${invoice.id}/gra-clearance`));

    expect(res.status).toBe(503);
    expect(res.body.error).toContain('GRA E-VAT is not configured for this business yet');
    expect(mockedAxios.post).not.toHaveBeenCalled();

    const invoicesRes = await authed(request(app).get('/api/v1/invoices'));
    const updated = invoicesRes.body.data.invoices.find((i: any) => i.id === invoice.id);
    expect(updated.graClearanceStatus).toBe('FAILED');
  });

  it('never returns the security key (plaintext or encrypted) in any tenant API response', async () => {
    await configureGraCredentials();

    const getRes = await authed(request(app).get('/api/v1/tenants/current'));
    expect(getRes.body.data.tenant.graSecurityKeyEncrypted).toBeUndefined();
    expect(getRes.body.data.tenant.graSecurityKeyConfigured).toBe(true);
    expect(getRes.body.data.tenant.graDeviceNumber).toBe('001');
    expect(JSON.stringify(getRes.body)).not.toContain('Z60gftKe9sei3xOZhvvDa0StkVILKR3j5MBM9ygi1zg=');
  });

  it('clears a real invoice by calling the documented GRA VSDC endpoint and maps the response correctly', async () => {
    await configureGraCredentials();
    mockGraSuccess();

    const invoice = await createInvoice(1000);
    const res = await authed(request(app).post(`/api/v1/invoices/${invoice.id}/gra-clearance`));

    expect(res.status).toBe(200);
    expect(res.body.data.invoice.graClearanceStatus).toBe('CLEARED');
    expect(res.body.data.invoice.graVerificationEngineId).toBe('EV-260623-001');
    expect(res.body.data.invoice.graSignature).toBe('E4OFBGZX2MT6YBTQ');
    expect(res.body.data.invoice.graEncryptedData).toBe('NUGABIDWABF5MRRN2EXDUSJ7M4');
    // Rendered as a QR code image, not the raw verification URL.
    expect(res.body.data.invoice.graQrCodeData).toMatch(/^data:image\//);

    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    const [url, payload, config] = mockedAxios.post.mock.calls[0];
    expect(url).toBe('https://vsdcstaging.vat-gh.com/vsdc/api/v1/taxpayer/C0012345678-001/invoice');
    expect((config as any).headers.security_key).toBe('Z60gftKe9sei3xOZhvvDa0StkVILKR3j5MBM9ygi1zg=');
    expect((payload as any).flag).toBe('INVOICE');
    expect((payload as any).calculationType).toBe('EXCLUSIVE');
    expect((payload as any).businessPartnerTin).toBe('VC00000009055');
    expect((payload as any).totalAmount).toBe(1000);
    expect((payload as any).items[0].description).toBe('Consulting');
  });

  it('falls back to GRA\'s own documented cash-customer TIN placeholder when the customer has none on file', async () => {
    await configureGraCredentials();
    mockGraSuccess();

    const cashCustomer = await authed(request(app).post('/api/v1/invoices/customers')).send({
      name: 'Walk-in Customer', email: `walkin_${runId}@client.com`,
    });
    const cashCustomerId = cashCustomer.body.data.customer.id;

    const invoiceRes = await authed(request(app).post('/api/v1/invoices')).send({
      customerId: cashCustomerId,
      items: [{ description: 'Retail sale', quantity: 1, unitPrice: 50 }],
    });
    const invoice = invoiceRes.body.data.invoice;

    await authed(request(app).post(`/api/v1/invoices/${invoice.id}/gra-clearance`));

    const [, payload] = mockedAxios.post.mock.calls[0];
    expect((payload as any).businessPartnerTin).toBe('C0000000000');
  });

  it('marks the invoice FAILED with a real, non-fabricated error when GRA rejects the request', async () => {
    await configureGraCredentials();
    mockGraRejection();

    const invoice = await createInvoice(300);
    const res = await authed(request(app).post(`/api/v1/invoices/${invoice.id}/gra-clearance`));

    expect(res.status).toBe(502);
    expect(res.body.success).toBe(false);

    const invoicesRes = await authed(request(app).get('/api/v1/invoices'));
    const updated = invoicesRes.body.data.invoices.find((i: any) => i.id === invoice.id);
    expect(updated.graClearanceStatus).toBe('FAILED');
    expect(updated.graClearanceError).toBeTruthy();
  });

  it('surfaces a real network/auth error from GRA rather than a generic message', async () => {
    await configureGraCredentials();
    mockGraNetworkError();

    const invoice = await createInvoice(200);
    const res = await authed(request(app).post(`/api/v1/invoices/${invoice.id}/gra-clearance`));

    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Invalid security_key');
  });

  it('rejects a clearance request for an invoice that does not exist', async () => {
    await configureGraCredentials();
    const res = await authed(request(app).post('/api/v1/invoices/00000000-0000-0000-0000-000000000000/gra-clearance'));
    expect(res.status).toBe(404);
  });

  it('refuses to re-request clearance for an already-CLEARED invoice', async () => {
    await configureGraCredentials();
    mockGraSuccess();

    const invoice = await createInvoice(750);
    const firstAttempt = await authed(request(app).post(`/api/v1/invoices/${invoice.id}/gra-clearance`));
    expect(firstAttempt.status).toBe(200);

    const secondAttempt = await authed(request(app).post(`/api/v1/invoices/${invoice.id}/gra-clearance`));
    expect(secondAttempt.status).toBe(400);
    expect(secondAttempt.body.error).toBe('This invoice is already GRA-cleared.');
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });

  it('clears the TIN/device number and removes the security key when PUT /tenants/current is sent empty values', async () => {
    await configureGraCredentials();

    const clearRes = await authed(request(app).put('/api/v1/tenants/current')).send({
      graTin: '', graDeviceNumber: '', graSecurityKey: '',
    });
    expect(clearRes.status).toBe(200);
    expect(clearRes.body.data.tenant.graTin).toBeNull();
    expect(clearRes.body.data.tenant.graDeviceNumber).toBeNull();
    expect(clearRes.body.data.tenant.graSecurityKeyConfigured).toBe(false);

    const invoice = await createInvoice(100);
    const res = await authed(request(app).post(`/api/v1/invoices/${invoice.id}/gra-clearance`));
    expect(res.status).toBe(503);
  });
});
