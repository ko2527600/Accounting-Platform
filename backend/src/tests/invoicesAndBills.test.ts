import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';

describe('Invoices & Bills API - concurrent numbering safety', () => {
  const tenantSlug = 'billing-corp-1';
  const tenantSchema = 'tenant_billing_corp_1';
  const adminEmail = 'admin_billing@corp1.com';

  let adminToken: string;
  let customerId: string;
  let vendorId: string;

  async function cleanupTestData() {
    await deleteTenantBySlug(prisma, tenantSlug).catch(() => {});
    await deleteUserByEmail(prisma, adminEmail).catch(() => {});
    await dropTenantSchema(prisma, tenantSchema).catch(() => {});
  }

  beforeAll(async () => {
    await prisma.$connect();
    await ensureTenantTableExists(prisma);
    await ensureUserTableExists(prisma);
    await cleanupTestData();

    const onboard = await onboardTenant(prisma, {
      companyName: 'Billing Corp 1',
      slug: tenantSlug,
      adminEmail,
      adminPassword: 'Password123!',
      adminName: 'Billing Corp 1 Admin',
    });
    adminToken = onboard.token;

    const customer = await request(app)
      .post('/api/v1/invoices/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ name: 'Acme Customer', email: 'customer@acme.test' });
    customerId = customer.body.data.customer.id;

    const vendor = await request(app)
      .post('/api/v1/bills/vendors')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ name: 'Acme Vendor', email: 'vendor@acme.test' });
    vendorId = vendor.body.data.vendor.id;
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it('generates unique invoice numbers under concurrent creation', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }).map(() =>
        request(app)
          .post('/api/v1/invoices')
          .set('Authorization', `Bearer ${adminToken}`)
          .set('X-Tenant-ID', tenantSlug)
          .send({ customerId, items: [{ description: 'Widget', quantity: 1, unitPrice: 10 }] })
      )
    );

    for (const r of results) {
      expect(r.status).toBe(201);
    }

    const invoiceNumbers = results.map((r) => r.body.data.invoice.invoiceNumber);
    // count()+offset numbering would produce duplicates under concurrency, which
    // the DB's unique constraint on invoice_number would then reject with a 500.
    expect(new Set(invoiceNumbers).size).toBe(invoiceNumbers.length);
  });

  it('generates unique bill numbers under concurrent creation', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }).map(() =>
        request(app)
          .post('/api/v1/bills')
          .set('Authorization', `Bearer ${adminToken}`)
          .set('X-Tenant-ID', tenantSlug)
          .send({ vendorId, dueDate: new Date(Date.now() + 86400000).toISOString(), amount: 50 })
      )
    );

    for (const r of results) {
      expect(r.status).toBe(201);
    }

    const billNumbers = results.map((r) => r.body.data.bill.billNumber);
    expect(new Set(billNumbers).size).toBe(billNumbers.length);
  });
});
