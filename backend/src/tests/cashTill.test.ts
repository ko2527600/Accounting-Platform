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
        .send({ tillId, itemId, quantity: 8, cashGiven: 20 }),
      request(app)
        .post('/api/v1/tills/sales')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({ tillId, itemId, quantity: 8, cashGiven: 20 }),
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
});
