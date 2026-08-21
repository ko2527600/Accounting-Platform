import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';
import { RecurringInvoiceCronService } from '../services/recurringInvoiceCronService';

describe('Recurring customer invoices', () => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tenantSlug = `ri-corp-${runId}`;
  const tenantSchema = `tenant_ri_corp_${runId}`;
  const adminEmail = `admin_ri_${runId}@corp.com`;

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

  beforeAll(async () => {
    await prisma.$connect();
    await ensureTenantTableExists(prisma);
    await ensureUserTableExists(prisma);
    await cleanupTestData();

    const onboard = await onboardTenant(prisma, {
      companyName: 'RI Corp',
      slug: tenantSlug,
      adminEmail,
      adminPassword: 'Password123!',
      adminName: 'RI Admin',
    });
    adminToken = onboard.token;

    const customer = await authed(request(app).post('/api/v1/invoices/customers')).send({
      name: 'RI Customer', email: `ri_cust_${runId}@customer.com`,
    });
    customerId = customer.body.data.customer.id;
  }, 60000);

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it('creates a recurring invoice template', async () => {
    const res = await authed(request(app).post('/api/v1/recurring-invoices')).send({
      customerId,
      name: 'Monthly Retainer',
      frequency: 'MONTHLY',
      startDate: '2026-01-01',
      dueInDays: 10,
      items: [{ description: 'Retainer Fee', quantity: 1, unitPrice: 500 }],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.recurringInvoice.isActive).toBe(true);
    expect(res.body.data.recurringInvoice.nextRun).toBeTruthy();
  });

  it('rejects an invalid frequency', async () => {
    const res = await authed(request(app).post('/api/v1/recurring-invoices')).send({
      customerId,
      name: 'Bad Frequency',
      frequency: 'FORTNIGHTLY',
      startDate: '2026-01-01',
      items: [{ description: 'Line', quantity: 1, unitPrice: 100 }],
    });
    expect(res.status).toBe(400);
  });

  it('the daily cron generates a real invoice from a due recurring invoice and advances nextRun', async () => {
    const created = await authed(request(app).post('/api/v1/recurring-invoices')).send({
      customerId,
      name: 'Due Weekly Invoice',
      frequency: 'WEEKLY',
      startDate: '2020-01-01',
      dueInDays: 7,
      items: [{ description: 'Weekly Service', quantity: 2, unitPrice: 150 }],
    });
    const recurringId = created.body.data.recurringInvoice.id;

    await RecurringInvoiceCronService.runDueRecurringInvoicesJob();

    const invoicesRes = await authed(request(app).get('/api/v1/invoices'));
    const generated = invoicesRes.body.data.invoices.find((inv: any) => inv.customerId === customerId && Number(inv.total) === 300);
    expect(generated).toBeTruthy();
    expect(generated.status).toBe('SENT');

    const listRes = await authed(request(app).get('/api/v1/recurring-invoices'));
    const after = listRes.body.data.recurringInvoices.find((r: any) => r.id === recurringId);
    expect(after.lastRun).toBeTruthy();
    expect(new Date(after.nextRun).getTime()).toBe(new Date('2020-01-08').getTime());
  });

  it('does not generate an invoice for a paused (inactive) recurring invoice', async () => {
    const created = await authed(request(app).post('/api/v1/recurring-invoices')).send({
      customerId,
      name: 'Paused Invoice',
      frequency: 'DAILY',
      startDate: '2020-01-01',
      items: [{ description: 'Paused Line', quantity: 1, unitPrice: 999 }],
    });
    const recurringId = created.body.data.recurringInvoice.id;

    const toggle = await authed(request(app).put(`/api/v1/recurring-invoices/${recurringId}/active`)).send({ isActive: false });
    expect(toggle.status).toBe(200);
    expect(toggle.body.data.recurringInvoice.isActive).toBe(false);

    await RecurringInvoiceCronService.runDueRecurringInvoicesJob();

    const invoicesRes = await authed(request(app).get('/api/v1/invoices'));
    const generated = invoicesRes.body.data.invoices.find((inv: any) => Number(inv.total) === 999);
    expect(generated).toBeFalsy();
  });

  it('does not generate an invoice past its endDate', async () => {
    await authed(request(app).post('/api/v1/recurring-invoices')).send({
      customerId,
      name: 'Expired Invoice',
      frequency: 'DAILY',
      startDate: '2020-01-01',
      endDate: '2020-01-02',
      items: [{ description: 'Expired Line', quantity: 1, unitPrice: 777 }],
    });

    await RecurringInvoiceCronService.runDueRecurringInvoicesJob();

    const invoicesRes = await authed(request(app).get('/api/v1/invoices'));
    const generated = invoicesRes.body.data.invoices.find((inv: any) => Number(inv.total) === 777);
    expect(generated).toBeFalsy();
  });
});
