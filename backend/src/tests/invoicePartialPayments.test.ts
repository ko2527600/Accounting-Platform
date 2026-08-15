import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';

describe('Invoices - partial payments (Accounts Receivable)', () => {
  const runId = Date.now();
  const tenantSlug = `ar-partial-corp-${runId}`;
  const tenantSchema = `tenant_ar_partial_corp_${runId}`;
  const adminEmail = `admin_arpartial_${runId}@corp.com`;

  let adminToken: string;
  let cashAccountId: string;
  let revenueAccountId: string;
  let customerId: string;

  async function cleanupTestData() {
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

  async function payInvoice(id: string, amount?: number) {
    return request(app)
      .post(`/api/v1/invoices/${id}/pay`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send(amount !== undefined ? { amount } : {});
  }

  async function ledgerBalances() {
    const res = await request(app)
      .get('/api/v1/ledgers/summary')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);
    return {
      cash: res.body.data.accounts.find((a: any) => a.id === cashAccountId).closingBalance,
      revenue: res.body.data.accounts.find((a: any) => a.id === revenueAccountId).closingBalance,
    };
  }

  beforeAll(async () => {
    await prisma.$connect();
    await ensureTenantTableExists(prisma);
    await ensureUserTableExists(prisma);
    await cleanupTestData();

    const onboard = await onboardTenant(prisma, {
      companyName: 'AR Partial Corp',
      slug: tenantSlug,
      adminEmail,
      adminPassword: 'Password123!',
      adminName: 'AR Partial Admin',
    });
    adminToken = onboard.token;

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
      .send({ name: 'Partial Pay Client', email: `partialpay_${runId}@client.com` });
    customerId = customer.body.data.customer.id;
  }, 120000);

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it('records a partial payment: sets status to PARTIALLY_PAID and reduces the balance due', async () => {
    const invoice = await createInvoice(1000);

    const res = await payInvoice(invoice.id, 400);
    expect(res.status).toBe(200);
    expect(res.body.data.invoice.status).toBe('PARTIALLY_PAID');
    expect(Number(res.body.data.invoice.amountPaid)).toBe(400);
    expect(Number(res.body.data.invoice.total)).toBe(1000);
  });

  it('posts a journal entry scaled to just the partial amount, not the full invoice total', async () => {
    const invoice = await createInvoice(1000);
    const before = await ledgerBalances();

    const res = await payInvoice(invoice.id, 250);
    expect(res.status).toBe(200);

    const after = await ledgerBalances();
    expect(after.cash).toBe(before.cash + 250);
    // Revenue is credit-normal, so closingBalance (debit - credit) moves
    // further negative as more revenue is recognized.
    expect(after.revenue).toBe(before.revenue - 250);
  });

  it('a second payment completing the remaining balance transitions the invoice to PAID', async () => {
    const invoice = await createInvoice(1000);
    await payInvoice(invoice.id, 600);

    const res = await payInvoice(invoice.id, 400);
    expect(res.status).toBe(200);
    expect(res.body.data.invoice.status).toBe('PAID');
    expect(Number(res.body.data.invoice.amountPaid)).toBe(1000);
  });

  it('rejects a payment amount exceeding the remaining balance', async () => {
    const invoice = await createInvoice(500);
    await payInvoice(invoice.id, 300);

    const res = await payInvoice(invoice.id, 300);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('exceeds the remaining balance');
  });

  it('rejects a non-positive payment amount', async () => {
    const invoice = await createInvoice(500);
    const res = await payInvoice(invoice.id, 0);
    expect(res.status).toBe(400);
  });

  it('omitting the amount pays off whatever remains, exactly as before partial payments existed', async () => {
    const invoice = await createInvoice(500);
    await payInvoice(invoice.id, 200);

    const res = await payInvoice(invoice.id);
    expect(res.status).toBe(200);
    expect(res.body.data.invoice.status).toBe('PAID');
    expect(Number(res.body.data.invoice.amountPaid)).toBe(500);
  });

  it('GET /:id/payments lists every payment recorded against an invoice, newest first', async () => {
    const invoice = await createInvoice(1000);
    await payInvoice(invoice.id, 300);
    await payInvoice(invoice.id, 700);

    const res = await request(app)
      .get(`/api/v1/invoices/${invoice.id}/payments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);

    expect(res.status).toBe(200);
    expect(res.body.data.payments).toHaveLength(2);
    expect(Number(res.body.data.payments[0].amount)).toBe(700);
    expect(Number(res.body.data.payments[1].amount)).toBe(300);
  });
});
