import { deleteAuditLogs } from './testHelpers';
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
  let tenantId: string;
  let warehouseAId: string;
  let warehouseBId: string;
  let warehouseCId: string;
  let itemId: string;

  async function cleanupTestData() {
    if (tenantId) {
      await deleteAuditLogs(prisma, { tenantId });
    }
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
    tenantId = onboard.tenant.id;

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

  describe('POST /inventory/items/bulk', () => {
    it('creates every valid row and seeds initial stock where a warehouse was given', async () => {
      const res = await request(app)
        .post('/api/v1/inventory/items/bulk')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({
          items: [
            { name: 'Bulk Item A', costPrice: 1, sellingPrice: 2, initialWarehouseId: warehouseAId, initialQty: 5 },
            { name: 'Bulk Item B', costPrice: 3, sellingPrice: 6 },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.created).toHaveLength(2);
      expect(res.body.data.failed).toHaveLength(0);

      const warehouses = await request(app)
        .get('/api/v1/inventory/warehouses')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug);
      const warehouseA = warehouses.body.data.warehouses.find((w: any) => w.id === warehouseAId);
      const bulkItemAId = res.body.data.created.find((it: any) => it.name === 'Bulk Item A').id;
      const seededStock = warehouseA.stocks.find((s: any) => s.itemId === bulkItemAId);
      expect(seededStock.quantityOnHand).toBe(5);
    });

    it('reports a per-row failure (duplicate SKU) without discarding the other valid rows', async () => {
      const dupSku = `DUP-${Date.now()}`;

      // Seed one item with this SKU first via the single-item endpoint.
      await request(app)
        .post('/api/v1/inventory/items')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({ name: 'Pre-existing Item', sku: dupSku, costPrice: 1, sellingPrice: 2 });

      const res = await request(app)
        .post('/api/v1/inventory/items/bulk')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({
          items: [
            { name: 'Good Row', costPrice: 1, sellingPrice: 2 },
            { name: 'Bad Row', sku: dupSku, costPrice: 1, sellingPrice: 2 },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.data.created).toHaveLength(1);
      expect(res.body.data.created[0].name).toBe('Good Row');
      expect(res.body.data.failed).toHaveLength(1);
      expect(res.body.data.failed[0].name).toBe('Bad Row');
      expect(res.body.data.failed[0].error).toContain('already exists');
    });

    it('rejects an empty items array', async () => {
      const res = await request(app)
        .post('/api/v1/inventory/items/bulk')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({ items: [] });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /inventory/adjustments - restock and mistake correction', () => {
    let adjustItemId: string;

    beforeAll(async () => {
      const item = await request(app)
        .post('/api/v1/inventory/items')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({ name: 'Adjustable Widget', costPrice: 1, sellingPrice: 2, initialWarehouseId: warehouseBId, initialQty: 20 });
      adjustItemId = item.body.data.item.id;
    });

    it("mode='add' restocks an existing item and records the adjustment", async () => {
      const res = await request(app)
        .post('/api/v1/inventory/adjustments')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({ warehouseId: warehouseBId, itemId: adjustItemId, mode: 'add', quantity: 30, reason: 'Received delivery from supplier' });

      expect(res.status).toBe(201);
      expect(res.body.data.adjustment.previousQty).toBe(20);
      expect(res.body.data.adjustment.newQty).toBe(50);
      expect(res.body.data.adjustment.delta).toBe(30);

      const auditRows = await prisma.auditLog.findMany({
        where: { tenantId, entity: 'StockAdjustment', entityId: res.body.data.adjustment.id, action: 'STOCK_ADJUSTMENT.RECORDED' },
      });
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0].changes).toEqual({ quantityOnHand: { from: 20, to: 50 } });
    });

    it("mode='set' corrects a mistaken over-entry to the true physical count", async () => {
      // Simulates the exact scenario a real user flagged: someone accidentally typed
      // a much larger quantity than intended and needs to correct it to the real count.
      const res = await request(app)
        .post('/api/v1/inventory/adjustments')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({ warehouseId: warehouseBId, itemId: adjustItemId, mode: 'set', quantity: 12, reason: 'Physical count found 12, not 50 - fixing mistaken entry' });

      expect(res.status).toBe(201);
      expect(res.body.data.adjustment.previousQty).toBe(50);
      expect(res.body.data.adjustment.newQty).toBe(12);
      expect(res.body.data.adjustment.delta).toBe(-38);

      const items = await request(app)
        .get('/api/v1/inventory/items')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug);
      const refetched = items.body.data.items.find((it: any) => it.id === adjustItemId);
      const stock = refetched.warehouseStocks.find((s: any) => s.warehouseId === warehouseBId);
      expect(stock.quantityOnHand).toBe(12);
    });

    it("mode='remove' rejects removing more than is currently on hand", async () => {
      const res = await request(app)
        .post('/api/v1/inventory/adjustments')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({ warehouseId: warehouseBId, itemId: adjustItemId, mode: 'remove', quantity: 999, reason: 'Testing over-removal guard' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('only 12 currently on hand');
    });

    it('requires a non-empty reason for every adjustment', async () => {
      const res = await request(app)
        .post('/api/v1/inventory/adjustments')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({ warehouseId: warehouseBId, itemId: adjustItemId, mode: 'add', quantity: 5, reason: '   ' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('reason is required');
    });

    it('GET /inventory/adjustments returns the recorded history filtered by item', async () => {
      const res = await request(app)
        .get('/api/v1/inventory/adjustments')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug)
        .query({ itemId: adjustItemId });

      expect(res.status).toBe(200);
      expect(res.body.data.adjustments.length).toBeGreaterThanOrEqual(2);
      // Most recent first
      expect(res.body.data.adjustments[0].mode).toBe('set');
      expect(res.body.data.adjustments[0].item.name).toBe('Adjustable Widget');
    });
  });
});
