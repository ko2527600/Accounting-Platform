import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';

/**
 * Regression test for a critical bug found and fixed on 2026-07-25: Invoices,
 * Customers, Vendors, Vendor Bills, Bank Accounts/Transactions, Warehouses,
 * Inventory Items, Cash Tills/Sales, Notifications, and Custom Fields were
 * created once in the shared public schema with no tenant_id column, so
 * every tenant read and wrote the exact same rows. Verified live at the time:
 * onboarding two tenants and confirming Tenant B's GET /invoices returned
 * Tenant A's data. Fixed by adding a tenantId column to each model and
 * filtering every query by it.
 */
describe('Tenant isolation for business tables (Invoices, Warehouses, Notifications)', () => {
  const runId = Date.now();
  const tenant1Slug = `iso-corp-1-${runId}`;
  const tenant1Schema = `tenant_iso_corp_1_${runId}`;
  const admin1Email = `admin_iso1_${runId}@corp1.com`;

  const tenant2Slug = `iso-corp-2-${runId}`;
  const tenant2Schema = `tenant_iso_corp_2_${runId}`;
  const admin2Email = `admin_iso2_${runId}@corp2.com`;

  let token1: string;
  let token2: string;

  async function cleanupTestData() {
    await deleteTenantBySlug(prisma, tenant1Slug).catch(() => {});
    await deleteTenantBySlug(prisma, tenant2Slug).catch(() => {});
    await deleteUserByEmail(prisma, admin1Email).catch(() => {});
    await deleteUserByEmail(prisma, admin2Email).catch(() => {});
    await dropTenantSchema(prisma, tenant1Schema).catch(() => {});
    await dropTenantSchema(prisma, tenant2Schema).catch(() => {});
  }

  beforeAll(async () => {
    await prisma.$connect();
    await ensureTenantTableExists(prisma);
    await ensureUserTableExists(prisma);
    await cleanupTestData();

    const onboard1 = await onboardTenant(prisma, {
      companyName: 'Isolation Corp 1',
      slug: tenant1Slug,
      adminEmail: admin1Email,
      adminPassword: 'Password123!',
      adminName: 'Isolation Corp 1 Admin',
    });
    token1 = onboard1.token;

    const onboard2 = await onboardTenant(prisma, {
      companyName: 'Isolation Corp 2',
      slug: tenant2Slug,
      adminEmail: admin2Email,
      adminPassword: 'Password123!',
      adminName: 'Isolation Corp 2 Admin',
    });
    token2 = onboard2.token;
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it('Tenant 2 cannot see Tenant 1 customers/invoices/warehouses/notifications', async () => {
    const customer1 = await request(app)
      .post('/api/v1/invoices/customers')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ name: 'Tenant 1 Secret Customer', email: 'secret@tenant1.test' });
    expect(customer1.status).toBe(201);

    const invoice1 = await request(app)
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({
        customerId: customer1.body.data.customer.id,
        items: [{ description: 'Tenant 1 Secret Line Item', quantity: 1, unitPrice: 999 }],
      });
    expect(invoice1.status).toBe(201);

    const warehouse1 = await request(app)
      .post('/api/v1/inventory/warehouses')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ name: 'Tenant 1 Secret Warehouse' });
    expect(warehouse1.status).toBe(201);

    const notification1 = await request(app)
      .post('/api/v1/notifications')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ title: 'Tenant 1 Secret Notification', message: 'secret' });
    expect(notification1.status).toBe(201);

    // Tenant 2's views must all be empty of Tenant 1's data.
    const customersAsT2 = await request(app)
      .get('/api/v1/invoices/customers')
      .set('Authorization', `Bearer ${token2}`)
      .set('X-Tenant-ID', tenant2Slug);
    expect(customersAsT2.body.data.customers).toEqual([]);

    const invoicesAsT2 = await request(app)
      .get('/api/v1/invoices')
      .set('Authorization', `Bearer ${token2}`)
      .set('X-Tenant-ID', tenant2Slug);
    expect(invoicesAsT2.body.data.invoices).toEqual([]);

    const warehousesAsT2 = await request(app)
      .get('/api/v1/inventory/warehouses')
      .set('Authorization', `Bearer ${token2}`)
      .set('X-Tenant-ID', tenant2Slug);
    expect(warehousesAsT2.body.data.warehouses).toEqual([]);

    const notificationsAsT2 = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${token2}`)
      .set('X-Tenant-ID', tenant2Slug);
    expect(notificationsAsT2.body.data.notifications).toEqual([]);

    // Tenant 1 must still see its own data.
    const invoicesAsT1 = await request(app)
      .get('/api/v1/invoices')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug);
    expect(invoicesAsT1.body.data.invoices.length).toBe(1);
    expect(invoicesAsT1.body.data.invoices[0].items[0].description).toBe('Tenant 1 Secret Line Item');
  });

  it('Tenant 2 cannot pay/reconcile/act on Tenant 1 records by guessing their IDs', async () => {
    const customer1 = await request(app)
      .post('/api/v1/invoices/customers')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ name: 'Tenant 1 IDOR Customer', email: 'idor@tenant1.test' });

    const invoice1 = await request(app)
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({
        customerId: customer1.body.data.customer.id,
        items: [{ description: 'IDOR test item', quantity: 1, unitPrice: 10 }],
      });
    const invoice1Id = invoice1.body.data.invoice.id;

    // Tenant 2 tries to pay Tenant 1's invoice directly by ID.
    const payAsT2 = await request(app)
      .post(`/api/v1/invoices/${invoice1Id}/pay`)
      .set('Authorization', `Bearer ${token2}`)
      .set('X-Tenant-ID', tenant2Slug);
    expect(payAsT2.status).toBe(404);

    // Tenant 1 can still pay its own invoice.
    const payAsT1 = await request(app)
      .post(`/api/v1/invoices/${invoice1Id}/pay`)
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug);
    expect(payAsT1.status).toBe(200);
    expect(payAsT1.body.data.invoice.status).toBe('PAID');
  });
});
