import { deleteAuditLogs } from './testHelpers';
import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';
import { DunningReminderCronService } from '../services/dunningReminderService';

describe('Dunning reminders (DunningReminderCronService.runOverdueInvoicesJob)', () => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tenantSlug = `dunning-corp-${runId}`;
  const tenantSchema = `tenant_dunning_corp_${runId}`;
  const adminEmail = `admin_dunning_${runId}@corp.com`;
  const customerEmail = `customer_dunning_${runId}@acme.test`;

  let adminToken: string;
  let tenantId: string;
  let customerId: string;

  let originalEmailUser: string | undefined;
  let originalEmailPass: string | undefined;

  async function cleanupTestData() {
    if (tenantId) {
      await deleteAuditLogs(prisma, { tenantId });
    }
    await deleteTenantBySlug(prisma, tenantSlug).catch(() => {});
    await deleteUserByEmail(prisma, adminEmail).catch(() => {});
    await dropTenantSchema(prisma, tenantSchema).catch(() => {});
  }

  async function createInvoice(dueDate: string) {
    const res = await request(app)
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ customerId, dueDate, items: [{ description: 'Consulting', quantity: 1, unitPrice: 500 }] });
    expect(res.status).toBe(201);
    return res.body.data.invoice;
  }

  async function fetchInvoice(id: string) {
    const res = await request(app)
      .get('/api/v1/invoices')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);
    return res.body.data.invoices.find((inv: any) => inv.id === id);
  }

  beforeAll(async () => {
    await prisma.$connect();
    await ensureTenantTableExists(prisma);
    await ensureUserTableExists(prisma);
    await cleanupTestData();

    originalEmailUser = process.env.EMAIL_USER;
    originalEmailPass = process.env.EMAIL_PASS;
    process.env.EMAIL_USER = 'billing@ledgio.test';
    process.env.EMAIL_PASS = 'test-app-password';

    const onboard = await onboardTenant(prisma, {
      companyName: 'Dunning Corp',
      slug: tenantSlug,
      adminEmail,
      adminPassword: 'Password123!',
      adminName: 'Dunning Admin',
    });
    adminToken = onboard.token;
    tenantId = onboard.tenant.id;

    const customer = await request(app)
      .post('/api/v1/invoices/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ name: 'Acme Customer', email: customerEmail });
    customerId = customer.body.data.customer.id;
  });

  afterAll(async () => {
    process.env.EMAIL_USER = originalEmailUser;
    process.env.EMAIL_PASS = originalEmailPass;
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it('emails a reminder and stamps lastReminderSentAt for an overdue invoice', async () => {
    const overdueDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const invoice = await createInvoice(overdueDate);
    expect(invoice.lastReminderSentAt ?? null).toBeNull();

    await DunningReminderCronService.runOverdueInvoicesJob();

    const updated = await fetchInvoice(invoice.id);
    expect(updated.lastReminderSentAt).toBeTruthy();
  });

  it('does not remind an invoice that is not yet due', async () => {
    const futureDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
    const invoice = await createInvoice(futureDate);

    await DunningReminderCronService.runOverdueInvoicesJob();

    const updated = await fetchInvoice(invoice.id);
    expect(updated.lastReminderSentAt ?? null).toBeNull();
  });

  it('does not remind an invoice that has already been paid', async () => {
    const overdueDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const invoice = await createInvoice(overdueDate);

    const pay = await request(app)
      .post(`/api/v1/invoices/${invoice.id}/pay`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);
    expect(pay.status).toBe(200);

    await DunningReminderCronService.runOverdueInvoicesJob();

    const updated = await fetchInvoice(invoice.id);
    expect(updated.lastReminderSentAt ?? null).toBeNull();
  });

  it('does not re-remind within 24 hours (dedup guard)', async () => {
    const overdueDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const invoice = await createInvoice(overdueDate);

    await DunningReminderCronService.runOverdueInvoicesJob();
    const afterFirst = await fetchInvoice(invoice.id);
    expect(afterFirst.lastReminderSentAt).toBeTruthy();

    await DunningReminderCronService.runOverdueInvoicesJob();
    const afterSecond = await fetchInvoice(invoice.id);
    expect(afterSecond.lastReminderSentAt).toBe(afterFirst.lastReminderSentAt);
  });

  it('records an INVOICE.PAYMENT_REMINDER_SENT audit log entry', async () => {
    const overdueDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const invoice = await createInvoice(overdueDate);

    await DunningReminderCronService.runOverdueInvoicesJob();

    const logs = await prisma.auditLog.findMany({
      where: { tenantId, action: 'INVOICE.PAYMENT_REMINDER_SENT', entityId: invoice.id },
    });
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0].details).toContain(customerEmail);
  });

  it('skips the sweep entirely when email sending is not configured', async () => {
    const overdueDate = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
    const invoice = await createInvoice(overdueDate);

    const savedPass = process.env.EMAIL_PASS;
    delete process.env.EMAIL_PASS;
    try {
      await DunningReminderCronService.runOverdueInvoicesJob();
    } finally {
      process.env.EMAIL_PASS = savedPass;
    }

    const updated = await fetchInvoice(invoice.id);
    expect(updated.lastReminderSentAt ?? null).toBeNull();
  });
});
