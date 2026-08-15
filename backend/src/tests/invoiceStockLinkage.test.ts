import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';

describe('Invoices - itemized invoices deduct real stock on issue', () => {
  const runId = Date.now();
  const tenantSlug = `inv-stock-corp-${runId}`;
  const tenantSchema = `tenant_inv_stock_corp_${runId}`;
  const adminEmail = `admin_invstock_${runId}@corp.com`;

  let adminToken: string;
  let warehouseId: string;
  let otherWarehouseId: string;
  let customerId: string;
  let itemAId: string;
  let itemBId: string;

  async function cleanupTestData() {
    await deleteTenantBySlug(prisma, tenantSlug).catch(() => {});
    await deleteUserByEmail(prisma, adminEmail).catch(() => {});
    await dropTenantSchema(prisma, tenantSchema).catch(() => {});
  }

  async function stockOf(itemId: string, whId: string = warehouseId) {
    const res = await request(app)
      .get('/api/v1/inventory/items')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);
    const item = res.body.data.items.find((i: any) => i.id === itemId);
    const stock = item.warehouseStocks.find((s: any) => s.warehouseId === whId);
    return stock ? stock.quantityOnHand : 0;
  }

  async function createItem(name: string, sku: string, initialQty: number) {
    const res = await request(app)
      .post('/api/v1/inventory/items')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ name, sku, costPrice: 5, sellingPrice: 20, initialWarehouseId: warehouseId, initialQty });
    return res.body.data.item.id;
  }

  beforeAll(async () => {
    await prisma.$connect();
    await ensureTenantTableExists(prisma);
    await ensureUserTableExists(prisma);
    await cleanupTestData();

    const onboard = await onboardTenant(prisma, {
      companyName: 'Invoice Stock Corp',
      slug: tenantSlug,
      adminEmail,
      adminPassword: 'Password123!',
      adminName: 'Invoice Stock Admin',
    });
    adminToken = onboard.token;

    const wh = await request(app)
      .post('/api/v1/inventory/warehouses')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ name: 'Main Warehouse' });
    warehouseId = wh.body.data.warehouse.id;

    const otherWh = await request(app)
      .post('/api/v1/inventory/warehouses')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ name: 'Second Warehouse' });
    otherWarehouseId = otherWh.body.data.warehouse.id;

    const customer = await request(app)
      .post('/api/v1/invoices/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ name: 'Stock Invoice Client', email: `stockinv_${runId}@client.com` });
    customerId = customer.body.data.customer.id;
  }, 120000);

  beforeEach(async () => {
    itemAId = await createItem(`Widget A ${Date.now()}`, `ISC-A-${Date.now()}`, 50);
    itemBId = await createItem(`Widget B ${Date.now()}`, `ISC-B-${Date.now()}`, 20);
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it('creates a Simple Invoice (no warehouseId) without touching stock at all', async () => {
    const before = await stockOf(itemAId);

    const res = await request(app)
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ customerId, items: [{ description: 'Consulting hours', quantity: 5, unitPrice: 100 }] });

    expect(res.status).toBe(201);
    expect(res.body.data.invoice.stockDeducted).toBe(false);
    expect(res.body.data.invoice.warehouseId).toBeNull();
    expect(await stockOf(itemAId)).toBe(before);
  });

  it('deducts stock atomically when issuing an Itemized Invoice', async () => {
    const beforeA = await stockOf(itemAId);
    const beforeB = await stockOf(itemBId);

    const res = await request(app)
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({
        customerId,
        warehouseId,
        items: [
          { description: 'Widget A', quantity: 10, unitPrice: 20, inventoryItemId: itemAId },
          { description: 'Widget B', quantity: 4, unitPrice: 20, inventoryItemId: itemBId },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.invoice.stockDeducted).toBe(true);
    expect(res.body.data.invoice.warehouseId).toBe(warehouseId);

    expect(await stockOf(itemAId)).toBe(beforeA - 10);
    expect(await stockOf(itemBId)).toBe(beforeB - 4);
  });

  it('rejects an itemized invoice when the requested quantity exceeds available stock', async () => {
    const before = await stockOf(itemAId);

    const res = await request(app)
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({
        customerId,
        warehouseId,
        items: [{ description: 'Widget A', quantity: 500, unitPrice: 20, inventoryItemId: itemAId }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Insufficient stock');
    expect(await stockOf(itemAId)).toBe(before);
  });

  it('rejects an itemized invoice against a warehouse that does not exist', async () => {
    const res = await request(app)
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({
        customerId,
        warehouseId: '00000000-0000-0000-0000-000000000000',
        items: [{ description: 'Widget A', quantity: 1, unitPrice: 20, inventoryItemId: itemAId }],
      });

    expect(res.status).toBe(404);
  });

  it('does not deduct stock in the wrong warehouse - an item with no stock row in the target warehouse is rejected', async () => {
    const res = await request(app)
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({
        customerId,
        warehouseId: otherWarehouseId,
        items: [{ description: 'Widget A', quantity: 1, unitPrice: 20, inventoryItemId: itemAId }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Insufficient stock');
  });

  describe('Credit note stock restoration', () => {
    it('restores stock when a credit note fully cancels an itemized invoice with returnToStock', async () => {
      const beforeA = await stockOf(itemAId);

      const invoiceRes = await request(app)
        .post('/api/v1/invoices')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({
          customerId,
          warehouseId,
          items: [{ description: 'Widget A', quantity: 6, unitPrice: 20, inventoryItemId: itemAId }],
        });
      expect(invoiceRes.status).toBe(201);
      const invoice = invoiceRes.body.data.invoice;
      expect(await stockOf(itemAId)).toBe(beforeA - 6);

      const creditRes = await request(app)
        .post(`/api/v1/invoices/${invoice.id}/credit-notes`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({ amount: Number(invoice.total), reason: 'Full return', returnToStock: true });

      expect(creditRes.status).toBe(201);
      expect(await stockOf(itemAId)).toBe(beforeA);
    });

    it('rejects returnToStock when the credit note does not cover the full remaining balance', async () => {
      const invoiceRes = await request(app)
        .post('/api/v1/invoices')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({
          customerId,
          warehouseId,
          items: [{ description: 'Widget A', quantity: 6, unitPrice: 20, inventoryItemId: itemAId }],
        });
      const invoice = invoiceRes.body.data.invoice;
      const beforeA = await stockOf(itemAId);

      const creditRes = await request(app)
        .post(`/api/v1/invoices/${invoice.id}/credit-notes`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({ amount: Number(invoice.total) / 2, reason: 'Partial return', returnToStock: true });

      expect(creditRes.status).toBe(400);
      expect(creditRes.body.error).toContain('full remaining balance');
      expect(await stockOf(itemAId)).toBe(beforeA);
    });

    it('rejects returnToStock against a Simple Invoice that never deducted stock', async () => {
      const invoiceRes = await request(app)
        .post('/api/v1/invoices')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({ customerId, items: [{ description: 'Consulting', quantity: 1, unitPrice: 300 }] });
      const invoice = invoiceRes.body.data.invoice;

      const creditRes = await request(app)
        .post(`/api/v1/invoices/${invoice.id}/credit-notes`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({ amount: 300, reason: 'No stock to return', returnToStock: true });

      expect(creditRes.status).toBe(400);
      expect(creditRes.body.error).toContain('no linked stock');
    });
  });
});
