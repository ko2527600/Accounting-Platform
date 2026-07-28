import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';

describe('Cash Till API - multi-item cart', () => {
  const runId = Date.now();
  const tenantSlug = `pos-cart-corp-${runId}`;
  const tenantSchema = `tenant_pos_cart_corp_${runId}`;
  const adminEmail = `admin_poscart_${runId}@corp.com`;

  let adminToken: string;
  let warehouseId: string;
  let itemAId: string;
  let itemBId: string;
  let itemCId: string;
  let tillId: string;

  async function cleanupTestData() {
    await deleteTenantBySlug(prisma, tenantSlug).catch(() => {});
    await deleteUserByEmail(prisma, adminEmail).catch(() => {});
    await dropTenantSchema(prisma, tenantSchema).catch(() => {});
  }

  async function openFreshTill(openingCash = 500) {
    const res = await request(app)
      .post('/api/v1/tills/open')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ warehouseId, openingCash });
    return res.body.data.till.id as string;
  }

  beforeAll(async () => {
    await prisma.$connect();
    await ensureTenantTableExists(prisma);
    await ensureUserTableExists(prisma);
    await cleanupTestData();

    const onboard = await onboardTenant(prisma, {
      companyName: 'POS Cart Corp',
      slug: tenantSlug,
      adminEmail,
      adminPassword: 'Password123!',
      adminName: 'POS Cart Admin',
    });
    adminToken = onboard.token;

    const wh = await request(app)
      .post('/api/v1/inventory/warehouses')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ name: 'Cart Test Shop' });
    warehouseId = wh.body.data.warehouse.id;

    const itemA = await request(app)
      .post('/api/v1/inventory/items')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ name: 'Bread', sku: 'BRD-1', costPrice: 3, sellingPrice: 5, initialWarehouseId: warehouseId, initialQty: 20 });
    itemAId = itemA.body.data.item.id;

    const itemB = await request(app)
      .post('/api/v1/inventory/items')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ name: 'Milk', sku: 'MLK-1', costPrice: 4, sellingPrice: 8, initialWarehouseId: warehouseId, initialQty: 10 });
    itemBId = itemB.body.data.item.id;

    const itemC = await request(app)
      .post('/api/v1/inventory/items')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ name: 'Rare Import', sku: 'RARE-1', costPrice: 10, sellingPrice: 15, initialWarehouseId: warehouseId, initialQty: 2 });
    itemCId = itemC.body.data.item.id;

    tillId = await openFreshTill();
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it('records a multi-line sale as one receipt with the correct combined total and change', async () => {
    // 2 x Bread (5 each = 10) + 1 x Milk (8) = 18 total, cash given 20 -> change 2.
    const res = await request(app)
      .post('/api/v1/tills/sales')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({
        tillId,
        items: [
          { itemId: itemAId, quantity: 2 },
          { itemId: itemBId, quantity: 1 },
        ],
        cashGiven: 20,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.totalAmount).toBe(18);
    expect(res.body.data.changeGiven).toBe(2);
    expect(res.body.data.lines).toHaveLength(2);
    expect(res.body.data.sale.receiptNo).toBeTruthy();

    // One CashSale row, with real CashSaleLine rows underneath - verified via
    // the current-till endpoint, which now includes each sale's lines.
    const current = await request(app)
      .get('/api/v1/tills/current')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .query({ warehouseId });

    const sale = current.body.data.till.sales.find((s: any) => s.id === res.body.data.sale.id);
    expect(sale).toBeDefined();
    expect(sale.lines).toHaveLength(2);
    const breadLine = sale.lines.find((l: any) => l.itemId === itemAId);
    expect(breadLine.quantity).toBe(2);
    expect(Number(breadLine.lineTotal)).toBe(10);

    // Both items' stock must be deducted correctly (20 -> 18, 10 -> 9).
    const warehouses = await request(app)
      .get('/api/v1/inventory/warehouses')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);
    const warehouse = warehouses.body.data.warehouses.find((w: any) => w.id === warehouseId);
    expect(warehouse.stocks.find((s: any) => s.itemId === itemAId).quantityOnHand).toBe(18);
    expect(warehouse.stocks.find((s: any) => s.itemId === itemBId).quantityOnHand).toBe(9);
  });

  it('rejects the whole cart atomically when one line has insufficient stock - no partial deduction', async () => {
    const freshTill = await openFreshTill();

    // Item C only has 2 in stock; asking for 5 should fail the whole cart,
    // including the otherwise-valid Bread line.
    const res = await request(app)
      .post('/api/v1/tills/sales')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({
        tillId: freshTill,
        items: [
          { itemId: itemAId, quantity: 1 },
          { itemId: itemCId, quantity: 5 },
        ],
        cashGiven: 100,
      });

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Insufficient stock');

    // The Bread line must NOT have been deducted either - the whole
    // transaction must roll back together, not partially apply.
    const warehouses = await request(app)
      .get('/api/v1/inventory/warehouses')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);
    const warehouse = warehouses.body.data.warehouses.find((w: any) => w.id === warehouseId);
    expect(warehouse.stocks.find((s: any) => s.itemId === itemAId).quantityOnHand).toBe(18);
    expect(warehouse.stocks.find((s: any) => s.itemId === itemCId).quantityOnHand).toBe(2);
  });

  it('rejects an unknown item in the cart', async () => {
    const freshTill = await openFreshTill();
    const res = await request(app)
      .post('/api/v1/tills/sales')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ tillId: freshTill, items: [{ itemId: 'not-a-real-item-id', quantity: 1 }], cashGiven: 100 });

    expect(res.status).toBe(500);
    expect(res.body.error).toContain('not found');
  });

  it('rejects a non-integer or zero quantity before touching the database', async () => {
    const freshTill = await openFreshTill();

    const zero = await request(app)
      .post('/api/v1/tills/sales')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ tillId: freshTill, items: [{ itemId: itemAId, quantity: 0 }], cashGiven: 100 });
    expect(zero.status).toBe(400);

    const fractional = await request(app)
      .post('/api/v1/tills/sales')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ tillId: freshTill, items: [{ itemId: itemAId, quantity: 1.5 }], cashGiven: 100 });
    expect(fractional.status).toBe(400);
  });

  it('rejects an empty cart', async () => {
    const freshTill = await openFreshTill();
    const res = await request(app)
      .post('/api/v1/tills/sales')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ tillId: freshTill, items: [], cashGiven: 100 });

    expect(res.status).toBe(400);
  });
});
