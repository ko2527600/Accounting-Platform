import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';

describe('Cash Till API - concurrent sale safety', () => {
  const runId = Date.now();
  const tenantSlug = `till-corp-1-${runId}`;
  const tenantSchema = `tenant_till_corp_1_${runId}`;
  const adminEmail = `admin_till_${runId}@corp1.com`;

  let adminToken: string;
  let warehouseId: string;
  let itemId: string;
  let tillId: string;

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
      companyName: 'Till Corp 1',
      slug: tenantSlug,
      adminEmail,
      adminPassword: 'Password123!',
      adminName: 'Till Corp 1 Admin',
    });
    adminToken = onboard.token;

    const wh = await request(app)
      .post('/api/v1/inventory/warehouses')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ name: 'Shop Front' });
    warehouseId = wh.body.data.warehouse.id;

    const item = await request(app)
      .post('/api/v1/inventory/items')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({
        name: 'Soda Can',
        costPrice: 1,
        sellingPrice: 2,
        initialWarehouseId: warehouseId,
        initialQty: 10,
      });
    itemId = item.body.data.item.id;

    const till = await request(app)
      .post('/api/v1/tills/open')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ warehouseId, openingCash: 100 });
    tillId = till.body.data.till.id;

    // POS sales post a real Cash/Revenue journal entry - a Chart of
    // Accounts is required for that, same as any other posting service.
    await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ code: '1010', name: 'Cash on Hand', type: 'ASSET' });
    await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ code: '4010', name: 'Sales Revenue', type: 'REVENUE' });
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it('does not lose stock or cash-sales-total updates under two concurrent sales', async () => {
    // Only 10 units in stock. Fire two concurrent sales of 8 units each - only one
    // can succeed. Under the old read-then-write code, both could read
    // quantityOnHand=10 and both succeed, both crediting cashSalesTotal, and
    // leaving stock inconsistent with the sales actually recorded.
    const [saleA, saleB] = await Promise.all([
      request(app)
        .post('/api/v1/tills/sales')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({ tillId, items: [{ itemId, quantity: 8 }], cashGiven: 20 }),
      request(app)
        .post('/api/v1/tills/sales')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({ tillId, items: [{ itemId, quantity: 8 }], cashGiven: 20 }),
    ]);

    const statuses = [saleA.status, saleB.status].sort((a, b) => a - b);
    // Exactly one of the two must succeed; the old buggy code let both succeed.
    expect(statuses).toEqual([201, 500]);

    const successfulSale = saleA.status === 201 ? saleA : saleB;
    const expectedTotal = Number(successfulSale.body.data.totalAmount);

    const currentTill = await request(app)
      .get('/api/v1/tills/current')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .query({ warehouseId });

    // cashSalesTotal must reflect exactly the one successful sale, not double-counted.
    expect(Number(currentTill.body.data.till.cashSalesTotal)).toBe(expectedTotal);

    const warehouses = await request(app)
      .get('/api/v1/inventory/warehouses')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);
    const warehouse = warehouses.body.data.warehouses.find((w: any) => w.id === warehouseId);
    const stock = warehouse.stocks.find((s: any) => s.itemId === itemId);

    // Stock must never go negative and must reflect exactly one 8-unit sale.
    expect(stock.quantityOnHand).toBe(2);
    expect(stock.quantityOnHand).toBeGreaterThanOrEqual(0);
  });

  it('posts a real Cash/Revenue journal entry for a POS sale, reflected in Total Revenue', async () => {
    const plBefore = await request(app)
      .get('/api/v1/reports/profit-loss')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);
    const revenueBefore = Number(plBefore.body.data.totalRevenue);

    const sale = await request(app)
      .post('/api/v1/tills/sales')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ tillId, items: [{ itemId, quantity: 1 }], cashGiven: 2 });

    expect(sale.status).toBe(201);
    expect(sale.body.data.sale.journalId).toBeTruthy();

    const journal = await request(app)
      .get(`/api/v1/journal-entries/${sale.body.data.sale.journalId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);
    expect(journal.status).toBe(200);
    expect(journal.body.data.journalEntry.status).toBe('POSTED');
    const lines = journal.body.data.journalEntry.lines;
    expect(lines.find((l: any) => Number(l.debit) === 2)).toBeTruthy();
    expect(lines.find((l: any) => Number(l.credit) === 2)).toBeTruthy();

    const plAfter = await request(app)
      .get('/api/v1/reports/profit-loss')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);
    expect(Number(plAfter.body.data.totalRevenue)).toBe(revenueBefore + 2);
  });
});
