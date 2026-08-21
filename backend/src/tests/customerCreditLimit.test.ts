import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';

describe('Customer credit limits', () => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tenantSlug = `credit-corp-${runId}`;
  const tenantSchema = `tenant_credit_corp_${runId}`;
  const adminEmail = `admin_credit_${runId}@corp.com`;

  let adminToken: string;

  async function cleanupTestData() {
    await deleteTenantBySlug(prisma, tenantSlug).catch(() => {});
    await deleteUserByEmail(prisma, adminEmail).catch(() => {});
    await dropTenantSchema(prisma, tenantSchema).catch(() => {});
  }

  function authed(req: request.Test): request.Test {
    return req.set('Authorization', `Bearer ${adminToken}`).set('X-Tenant-ID', tenantSlug);
  }

  beforeAll(async () => {
    await prisma.$connect();
    await ensureTenantTableExists(prisma);
    await ensureUserTableExists(prisma);
    await cleanupTestData();

    const onboard = await onboardTenant(prisma, {
      companyName: 'Credit Corp',
      slug: tenantSlug,
      adminEmail,
      adminPassword: 'Password123!',
      adminName: 'Credit Admin',
    });
    adminToken = onboard.token;
  }, 60000);

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it('creates a customer with no limit by default (unaffected by this feature)', async () => {
    const res = await authed(request(app).post('/api/v1/invoices/customers')).send({
      name: 'No Limit Client',
      email: `nolimit_${runId}@client.com`,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.customer.creditLimit).toBeNull();
  });

  it('blocks an invoice that would push a customer past their credit limit', async () => {
    const customer = await authed(request(app).post('/api/v1/invoices/customers')).send({
      name: 'Limited Client',
      email: `limited_${runId}@client.com`,
      creditLimit: 1000,
    });
    expect(Number(customer.body.data.customer.creditLimit)).toBe(1000);
    const customerId = customer.body.data.customer.id;

    const first = await authed(request(app).post('/api/v1/invoices')).send({
      customerId,
      items: [{ description: 'First order', quantity: 1, unitPrice: 700 }],
    });
    expect(first.status).toBe(201);

    const second = await authed(request(app).post('/api/v1/invoices')).send({
      customerId,
      items: [{ description: 'Second order', quantity: 1, unitPrice: 400 }],
    });
    expect(second.status).toBe(400);
    expect(second.body.error).toContain('credit limit');
  });

  it('allows a new invoice once the customer pays down enough of the existing balance to make room', async () => {
    const customer = await authed(request(app).post('/api/v1/invoices/customers')).send({
      name: 'Recovering Client',
      email: `recover_${runId}@client.com`,
      creditLimit: 500,
    });
    const customerId = customer.body.data.customer.id;

    const invoice = await authed(request(app).post('/api/v1/invoices')).send({
      customerId,
      items: [{ description: 'Order', quantity: 1, unitPrice: 500 }],
    });
    expect(invoice.status).toBe(201);

    const blocked = await authed(request(app).post('/api/v1/invoices')).send({
      customerId,
      items: [{ description: 'Blocked order', quantity: 1, unitPrice: 100 }],
    });
    expect(blocked.status).toBe(400);

    await authed(request(app).post(`/api/v1/invoices/${invoice.body.data.invoice.id}/pay`)).send({ amount: 200 });

    const allowed = await authed(request(app).post('/api/v1/invoices')).send({
      customerId,
      items: [{ description: 'Now fits', quantity: 1, unitPrice: 100 }],
    });
    expect(allowed.status).toBe(201);
  });

  it('updates a customer\'s credit limit via PUT', async () => {
    const customer = await authed(request(app).post('/api/v1/invoices/customers')).send({
      name: 'Updatable Client',
      email: `update_${runId}@client.com`,
    });
    const customerId = customer.body.data.customer.id;

    const updated = await authed(request(app).put(`/api/v1/invoices/customers/${customerId}`)).send({
      creditLimit: 2500,
    });
    expect(updated.status).toBe(200);
    expect(Number(updated.body.data.customer.creditLimit)).toBe(2500);
  });
});
