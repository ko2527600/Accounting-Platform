import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';

describe('AP/AR Aging Analysis', () => {
  const runId = Date.now();
  const tenantSlug = `aging-corp-${runId}`;
  const tenantSchema = `tenant_aging_corp_${runId}`;
  const adminEmail = `admin_aging_${runId}@corp.com`;

  let adminToken: string;
  let customerId: string;
  let vendorId: string;

  async function cleanupTestData() {
    await deleteTenantBySlug(prisma, tenantSlug).catch(() => {});
    await deleteUserByEmail(prisma, adminEmail).catch(() => {});
    await dropTenantSchema(prisma, tenantSchema).catch(() => {});
  }

  function authed(req: request.Test): request.Test {
    return req.set('Authorization', `Bearer ${adminToken}`).set('X-Tenant-ID', tenantSlug);
  }

  function daysAgo(n: number): string {
    return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
  }

  beforeAll(async () => {
    await prisma.$connect();
    await ensureTenantTableExists(prisma);
    await ensureUserTableExists(prisma);
    await cleanupTestData();

    const onboard = await onboardTenant(prisma, {
      companyName: 'Aging Corp',
      slug: tenantSlug,
      adminEmail,
      adminPassword: 'Password123!',
      adminName: 'Aging Admin',
    });
    adminToken = onboard.token;

    const customer = await authed(request(app).post('/api/v1/invoices/customers')).send({
      name: 'Aging Client',
      email: `aging_${runId}@client.com`,
    });
    customerId = customer.body.data.customer.id;

    const vendor = await authed(request(app).post('/api/v1/bills/vendors')).send({
      name: 'Aging Vendor',
      email: `aging_${runId}@vendor.com`,
    });
    vendorId = vendor.body.data.vendor.id;
  }, 60000);

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it('buckets an overdue unpaid invoice into the right AR bucket, using balance due not the original total', async () => {
    const invoice = await authed(request(app).post('/api/v1/invoices')).send({
      customerId,
      dueDate: daysAgo(45),
      items: [{ description: 'Overdue Consulting', quantity: 1, unitPrice: 1000 }],
    });
    expect(invoice.status).toBe(201);

    await authed(request(app).post(`/api/v1/invoices/${invoice.body.data.invoice.id}/pay`)).send({ amount: 300 });

    const res = await authed(request(app).get('/api/v1/reports/aging/ar'));
    expect(res.status).toBe(200);

    const row = res.body.data.rows.find((r: any) => r.invoiceId === invoice.body.data.invoice.id);
    expect(row).toBeDefined();
    expect(row.bucket).toBe('days31to60');
    expect(row.balanceDue).toBe(700);
    expect(res.body.data.totals.days31to60).toBeGreaterThanOrEqual(700);
  });

  it('excludes a fully-paid invoice from AR aging', async () => {
    const invoice = await authed(request(app).post('/api/v1/invoices')).send({
      customerId,
      dueDate: daysAgo(10),
      items: [{ description: 'Paid in full', quantity: 1, unitPrice: 500 }],
    });
    await authed(request(app).post(`/api/v1/invoices/${invoice.body.data.invoice.id}/pay`)).send({});

    const res = await authed(request(app).get('/api/v1/reports/aging/ar'));
    const row = res.body.data.rows.find((r: any) => r.invoiceId === invoice.body.data.invoice.id);
    expect(row).toBeUndefined();
  });

  it('places a not-yet-due invoice in the "current" bucket', async () => {
    const invoice = await authed(request(app).post('/api/v1/invoices')).send({
      customerId,
      dueDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
      items: [{ description: 'Not due yet', quantity: 1, unitPrice: 200 }],
    });

    const res = await authed(request(app).get('/api/v1/reports/aging/ar'));
    const row = res.body.data.rows.find((r: any) => r.invoiceId === invoice.body.data.invoice.id);
    expect(row.bucket).toBe('current');
    expect(row.daysOverdue).toBeLessThanOrEqual(0);
  });

  it('buckets an overdue unpaid vendor bill into AP aging at its full amount', async () => {
    const bill = await authed(request(app).post('/api/v1/bills')).send({
      vendorId,
      dueDate: daysAgo(75),
      amount: 850,
    });
    expect(bill.status).toBe(201);

    const res = await authed(request(app).get('/api/v1/reports/aging/ap'));
    expect(res.status).toBe(200);
    const row = res.body.data.rows.find((r: any) => r.billId === bill.body.data.bill.id);
    expect(row).toBeDefined();
    expect(row.bucket).toBe('days61to90');
    expect(row.balanceDue).toBe(850);
  });

  it('excludes a paid vendor bill from AP aging', async () => {
    const bill = await authed(request(app).post('/api/v1/bills')).send({
      vendorId,
      dueDate: daysAgo(5),
      amount: 300,
    });
    await authed(request(app).post(`/api/v1/bills/${bill.body.data.bill.id}/pay`));

    const res = await authed(request(app).get('/api/v1/reports/aging/ap'));
    const row = res.body.data.rows.find((r: any) => r.billId === bill.body.data.bill.id);
    expect(row).toBeUndefined();
  });
});
