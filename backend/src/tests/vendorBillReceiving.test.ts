import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';

describe('Vendor Bills - itemized purchases (goods receipt) and landed cost allocation', () => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tenantSlug = `vb-receiving-corp-${runId}`;
  const tenantSchema = `tenant_vb_receiving_corp_${runId}`;
  const adminEmail = `admin_vbreceiving_${runId}@corp.com`;

  let adminToken: string;
  let warehouseId: string;
  let vendorId: string;
  let itemAId: string;
  let itemBId: string;

  async function cleanupTestData() {
    await deleteTenantBySlug(prisma, tenantSlug).catch(() => {});
    await deleteUserByEmail(prisma, adminEmail).catch(() => {});
    await dropTenantSchema(prisma, tenantSchema).catch(() => {});
  }

  async function getItemCostAndStock(itemId: string) {
    const res = await request(app)
      .get('/api/v1/inventory/items')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);
    const item = res.body.data.items.find((i: any) => i.id === itemId);
    const stock = item.warehouseStocks.find((s: any) => s.warehouseId === warehouseId);
    return { costPrice: Number(item.costPrice), qty: stock ? stock.quantityOnHand : 0 };
  }

  beforeAll(async () => {
    await prisma.$connect();
    await ensureTenantTableExists(prisma);
    await ensureUserTableExists(prisma);
    await cleanupTestData();

    const onboard = await onboardTenant(prisma, {
      companyName: 'VB Receiving Corp',
      slug: tenantSlug,
      adminEmail,
      adminPassword: 'Password123!',
      adminName: 'VB Receiving Admin',
    });
    adminToken = onboard.token;

    const wh = await request(app)
      .post('/api/v1/inventory/warehouses')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ name: 'Receiving Test Warehouse' });
    warehouseId = wh.body.data.warehouse.id;

    const vendor = await request(app)
      .post('/api/v1/bills/vendors')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ name: 'Freight & Goods Supplier', email: 'supplier@vbreceiving.test' });
    vendorId = vendor.body.data.vendor.id;

    const itemA = await request(app)
      .post('/api/v1/inventory/items')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ name: 'Widget A', sku: 'VBR-A', costPrice: 1, sellingPrice: 20, initialWarehouseId: warehouseId, initialQty: 0 });
    itemAId = itemA.body.data.item.id;

    const itemB = await request(app)
      .post('/api/v1/inventory/items')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ name: 'Widget B', sku: 'VBR-B', costPrice: 1, sellingPrice: 30, initialWarehouseId: warehouseId, initialQty: 0 });
    itemBId = itemB.body.data.item.id;
  }, 60000);

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it('still supports the original lump-sum bill shape with no line items (backward compatible)', async () => {
    const res = await request(app)
      .post('/api/v1/bills')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ vendorId, amount: 250, currency: 'USD' });

    expect(res.status).toBe(201);
    expect(Number(res.body.data.bill.amount)).toBe(250);
    expect(res.body.data.bill.billType).toBe('STANDARD');
    expect(res.body.data.bill.lines).toHaveLength(0);
  });

  it('rejects an itemized bill with no warehouse', async () => {
    const res = await request(app)
      .post('/api/v1/bills')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ vendorId, items: [{ itemId: itemAId, quantity: 10, unitCost: 5 }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('warehouse');
  });

  let primaryBillId: string;

  it('receives an itemized purchase: increments stock and computes weighted-average cost per line', async () => {
    const before = await getItemCostAndStock(itemAId);
    expect(before.qty).toBe(0);

    const res = await request(app)
      .post('/api/v1/bills')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({
        vendorId,
        warehouseId,
        items: [
          { itemId: itemAId, quantity: 10, unitCost: 5 },
          { itemId: itemBId, quantity: 5, unitCost: 10 },
        ],
      });

    expect(res.status).toBe(201);
    expect(Number(res.body.data.bill.amount)).toBe(100); // (10*5) + (5*10)
    expect(res.body.data.bill.lines).toHaveLength(2);
    primaryBillId = res.body.data.bill.id;

    const afterA = await getItemCostAndStock(itemAId);
    expect(afterA.qty).toBe(10);
    expect(afterA.costPrice).toBe(5);

    const afterB = await getItemCostAndStock(itemBId);
    expect(afterB.qty).toBe(5);
    expect(afterB.costPrice).toBe(10);
  });

  it('blends a new receipt into the existing moving-average cost for an item that already has stock', async () => {
    // Item A already has 10 units at cost 5 from the previous test.
    // Receive 10 more at cost 9 -> new average = (10*5 + 10*9) / 20 = 7.
    const res = await request(app)
      .post('/api/v1/bills')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({
        vendorId,
        warehouseId,
        items: [{ itemId: itemAId, quantity: 10, unitCost: 9 }],
      });

    expect(res.status).toBe(201);

    const after = await getItemCostAndStock(itemAId);
    expect(after.qty).toBe(20);
    expect(after.costPrice).toBe(7);
  });

  it('rejects a landed cost against a bill with no line items', async () => {
    const lumpSum = await request(app)
      .post('/api/v1/bills')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ vendorId, amount: 50 });

    const res = await request(app)
      .post(`/api/v1/bills/${lumpSum.body.data.bill.id}/landed-cost`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ vendorId, amount: 20 });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('no line items');
  });

  it('allocates a landed cost proportionally across the primary bill lines and blends into current item cost', async () => {
    // primaryBillId's lines: A qty=10 @5 (lineTotal 50), B qty=5 @10 (lineTotal 50) -> 50/50 share.
    // But item A now has 20 units on hand (cost 7) after the blend test above.
    // Landed cost of 20: A share 10 -> additionalUnitCost = 10/10 = 1; blended into 20 units on hand: 7 + (1*10)/20 = 7.5
    // B share 10 -> additionalUnitCost = 10/5 = 2; blended into 5 units on hand: 10 + (2*5)/5 = 12
    const res = await request(app)
      .post(`/api/v1/bills/${primaryBillId}/landed-cost`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ vendorId, amount: 20, description: 'Freight' });

    expect(res.status).toBe(201);
    expect(res.body.data.bill.billType).toBe('LANDED_COST');
    expect(res.body.data.allocations).toHaveLength(2);

    const afterA = await getItemCostAndStock(itemAId);
    expect(afterA.costPrice).toBeCloseTo(7.5, 5);

    const afterB = await getItemCostAndStock(itemBId);
    expect(afterB.costPrice).toBeCloseTo(12, 5);

    const auditRows = await prisma.auditLog.findMany({
      where: { action: 'VENDOR_BILL.LANDED_COST_ALLOCATED', entityId: primaryBillId },
    });
    expect(auditRows).toHaveLength(1);
  });

  it('skips a line whose shipment stock has since sold out entirely, leaving its cost unchanged', async () => {
    // Set up a fresh primary bill + landed cost pair specifically for the sold-out case.
    const itemC = await request(app)
      .post('/api/v1/inventory/items')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ name: 'Widget C', sku: 'VBR-C', costPrice: 1, sellingPrice: 15, initialWarehouseId: warehouseId, initialQty: 0 });
    const itemCId = itemC.body.data.item.id;

    const primary = await request(app)
      .post('/api/v1/bills')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ vendorId, warehouseId, items: [{ itemId: itemCId, quantity: 4, unitCost: 3 }] });
    const primaryId = primary.body.data.bill.id;

    // Sell out all 4 units via a stock adjustment (mode=remove) before the landed cost bill arrives.
    await request(app)
      .post('/api/v1/inventory/adjustments')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ warehouseId, itemId: itemCId, mode: 'remove', quantity: 4, reason: 'Test: sold out before landed cost arrived' });

    const beforeCost = (await getItemCostAndStock(itemCId)).costPrice;

    const res = await request(app)
      .post(`/api/v1/bills/${primaryId}/landed-cost`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ vendorId, amount: 8 });

    expect(res.status).toBe(201);
    expect(res.body.data.allocations[0].skippedReason).toBeTruthy();

    const afterCost = (await getItemCostAndStock(itemCId)).costPrice;
    expect(afterCost).toBe(beforeCost);
  });

  it('rejects allocating a landed cost against another landed-cost bill (no nesting)', async () => {
    const primary = await request(app)
      .post('/api/v1/bills')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ vendorId, warehouseId, items: [{ itemId: itemAId, quantity: 1, unitCost: 5 }] });

    const landed = await request(app)
      .post(`/api/v1/bills/${primary.body.data.bill.id}/landed-cost`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ vendorId, amount: 5 });

    const res = await request(app)
      .post(`/api/v1/bills/${landed.body.data.bill.id}/landed-cost`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ vendorId, amount: 3 });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('landed-cost bill');
  });
});
