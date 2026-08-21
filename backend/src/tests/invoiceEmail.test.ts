import { deleteAuditLogs } from './testHelpers';
import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';

describe('Invoice emailing (POST /invoices/:id/send)', () => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tenantSlug = `invoice-email-corp-${runId}`;
  const tenantSchema = `tenant_invoice_email_corp_${runId}`;
  const adminEmail = `admin_invemail_${runId}@corp.com`;
  const customerEmail = `customer_invemail_${runId}@acme.test`;

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

  async function createInvoice() {
    const res = await request(app)
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ customerId, items: [{ description: 'Consulting', quantity: 2, unitPrice: 100 }] });
    expect(res.status).toBe(201);
    return res.body.data.invoice;
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
      companyName: 'Invoice Email Corp',
      slug: tenantSlug,
      adminEmail,
      adminPassword: 'Password123!',
      adminName: 'Invoice Email Admin',
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

  it('emails the invoice and stamps emailedAt', async () => {
    const invoice = await createInvoice();
    expect(invoice.emailedAt ?? null).toBeNull();

    const res = await request(app)
      .post(`/api/v1/invoices/${invoice.id}/send`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);

    expect(res.status).toBe(200);
    expect(res.body.data.invoice.emailedAt).toBeTruthy();
    expect(res.body.message).toContain(customerEmail);
  });

  it('allows re-sending, updating emailedAt each time', async () => {
    const invoice = await createInvoice();

    const first = await request(app)
      .post(`/api/v1/invoices/${invoice.id}/send`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);
    expect(first.status).toBe(200);
    const firstEmailedAt = first.body.data.invoice.emailedAt;

    await new Promise((resolve) => setTimeout(resolve, 10));

    const second = await request(app)
      .post(`/api/v1/invoices/${invoice.id}/send`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);
    expect(second.status).toBe(200);
    expect(new Date(second.body.data.invoice.emailedAt).getTime()).toBeGreaterThan(new Date(firstEmailedAt).getTime());
  });

  it('records an INVOICE.EMAILED audit log entry', async () => {
    const invoice = await createInvoice();
    await request(app)
      .post(`/api/v1/invoices/${invoice.id}/send`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);

    const logs = await prisma.auditLog.findMany({
      where: { tenantId, action: 'INVOICE.EMAILED', entityId: invoice.id },
    });
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0].details).toContain(customerEmail);
  });

  it('returns 404 for an unknown invoice id', async () => {
    const res = await request(app)
      .post('/api/v1/invoices/00000000-0000-0000-0000-000000000000/send')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);
    expect(res.status).toBe(404);
  });

  it('returns 503 when email sending is not configured', async () => {
    const invoice = await createInvoice();
    const savedPass = process.env.EMAIL_PASS;
    delete process.env.EMAIL_PASS;
    try {
      const res = await request(app)
        .post(`/api/v1/invoices/${invoice.id}/send`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug);
      expect(res.status).toBe(503);
    } finally {
      process.env.EMAIL_PASS = savedPass;
    }
  });
});
