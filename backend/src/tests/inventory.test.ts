import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';

describe('Inventory API - concurrent stock transfer safety', () => {
  const runId = Date.now();
  const tenantSlug = `inv-corp-1-${runId}`;
  const tenantSchema = `tenant_inv_corp_1_${runId}`;
  const adminEmail = `admin_inv_${runId}@corp1.com`;

  let adminToken: string;
  let warehouseAId: string;
  let warehouseBId: string;
  let warehouseCId: string;
  let itemId: string;

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
      companyName: 'Inventory Corp 1',
      slug: tenantSlug,
      adminEmail,
      adminPassword: 'Password123!',
      adminName: 'Inventory Corp 1 Admin',
    });
    adminToken = onboard.token;

    const whA = await request(app)
      .post('/api/v1/inventory/warehouses')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ name: 'Warehouse A' });
    warehouseAId = whA.body.data.warehouse.id;

    const whB = await request(app)
      .post('/api/v1/inventory/warehouses')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ name: 'Warehouse B' });
    warehouseBId = whB.body.data.warehouse.id;

    const whC = await request(app)
      .post('/api/v1/inventory/warehouses')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ name: 'Warehouse C' });
    warehouseCId = whC.body.data.warehouse.id;

    const item = await request(app)
      .post('/api/v1/inventory/items')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({
        name: 'Widget',
        costPrice: 5,
        sellingPrice: 10,
        initialWarehouseId: warehouseAId,
        initialQty: 10,
      });
    itemId = item.body.data.item.id;
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it('does not allow two concurrent transfers to jointly overdraw stock below zero', async () => {
    // Warehouse A has 10 units. Fire two concurrent transfers of 8 units each
    // (to different destinations). Only one can succeed - if the old
    // read-then-write code were still in place, both could read quantityOnHand=10
    // and both succeed, driving stock to -6.
    const [transferToB, transferToC] = await Promise.all([
      request(app)
        .post('/api/v1/inventory/transfers')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({ fromWarehouseId: warehouseAId, toWarehouseId: warehouseBId, itemId, quantity: 8 }),
      request(app)
        .post('/api/v1/inventory/transfers')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({ fromWarehouseId: warehouseAId, toWarehouseId: warehouseCId, itemId, quantity: 8 }),
    ]);

    const statuses = [transferToB.status, transferToC.status].sort((a, b) => a - b);
    // Exactly one of the two must succeed; the other must be rejected as insufficient
    // stock (this route returns 500 for that thrown error - pre-existing status code
    // choice, not something this test is asserting on).
    expect(statuses).toEqual([201, 500]);

    const warehouses = await request(app)
      .get('/api/v1/inventory/warehouses')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);

    const warehouseA = warehouses.body.data.warehouses.find((w: any) => w.id === warehouseAId);
    const stockA = warehouseA.stocks.find((s: any) => s.itemId === itemId);

    // Source stock must never go negative and must reflect exactly one 8-unit transfer.
    expect(stockA.quantityOnHand).toBe(2);
    expect(stockA.quantityOnHand).toBeGreaterThanOrEqual(0);
  });
});
