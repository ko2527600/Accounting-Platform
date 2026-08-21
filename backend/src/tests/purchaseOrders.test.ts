import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';

describe('Purchase Orders + PO-vs-bill matching', () => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tenantSlug = `po-corp-${runId}`;
  const tenantSchema = `tenant_po_corp_${runId}`;
  const adminEmail = `admin_po_${runId}@corp.com`;

  let adminToken: string;
  let vendorId: string;
  let warehouseId: string;
  let itemId: string;

  async function cleanupTestData() {
    await deleteTenantBySlug(prisma, tenantSlug).catch(() => {});
    await deleteUserByEmail(prisma, adminEmail).catch(() => {});
    await dropTenantSchema(prisma, tenantSchema).catch(() => {});
  }

  function authed(req: request.Test): request.Test {
    return req.set('Authorization', `Bearer ${adminToken}`).set('X-Tenant-ID', tenantSlug);
  }

  beforeAll(async () => {
    await prisma.$connect();
    await ensureTenantTableExists(prisma);
    await ensureUserTableExists(prisma);
    await cleanupTestData();

    const onboard = await onboardTenant(prisma, {
      companyName: 'PO Corp',
      slug: tenantSlug,
      adminEmail,
      adminPassword: 'Password123!',
      adminName: 'PO Admin',
    });
    adminToken = onboard.token;

    const vendor = await authed(request(app).post('/api/v1/bills/vendors')).send({ name: 'PO Vendor', email: `po_${runId}@vendor.com` });
    vendorId = vendor.body.data.vendor.id;

    const warehouse = await authed(request(app).post('/api/v1/inventory/warehouses')).send({ name: 'PO Warehouse' });
    warehouseId = warehouse.body.data.warehouse.id;

    const item = await authed(request(app).post('/api/v1/inventory/items')).send({
      name: 'Widget', sku: `PO-WIDGET-${runId}`, costPrice: 10, sellingPrice: 20,
    });
    itemId = item.body.data.item.id;
  }, 60000);

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it('creates a DRAFT purchase order with lines', async () => {
    const res = await authed(request(app).post('/api/v1/purchase-orders')).send({
      vendorId,
      warehouseId,
      lines: [{ itemId, quantity: 10, unitCost: 8 }],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.purchaseOrder.status).toBe('DRAFT');
    expect(res.body.data.purchaseOrder.lines).toHaveLength(1);
    expect(res.body.data.purchaseOrder.poNumber).toMatch(/^PO-/);
  });

  it('transitions DRAFT -> SENT, rejects manually setting BILLED', async () => {
    const po = await authed(request(app).post('/api/v1/purchase-orders')).send({
      vendorId,
      lines: [{ itemId, quantity: 5, unitCost: 8 }],
    });
    const poId = po.body.data.purchaseOrder.id;

    const sent = await authed(request(app).put(`/api/v1/purchase-orders/${poId}/status`)).send({ status: 'SENT' });
    expect(sent.status).toBe(200);
    expect(sent.body.data.purchaseOrder.status).toBe('SENT');

    const blocked = await authed(request(app).put(`/api/v1/purchase-orders/${poId}/status`)).send({ status: 'BILLED' });
    expect(blocked.status).toBe(400);
  });

  it('creating a matching bill from a PO marks it BILLED and reports no variance', async () => {
    const po = await authed(request(app).post('/api/v1/purchase-orders')).send({
      vendorId,
      warehouseId,
      lines: [{ itemId, quantity: 20, unitCost: 9 }],
    });
    const poId = po.body.data.purchaseOrder.id;

    const bill = await authed(request(app).post('/api/v1/bills')).send({
      vendorId,
      warehouseId,
      purchaseOrderId: poId,
      items: [{ itemId, quantity: 20, unitCost: 9 }],
    });
    expect(bill.status).toBe(201);
    expect(bill.body.data.bill.purchaseOrderId).toBe(poId);
    expect(bill.body.data.poVariance.every((v: any) => !v.hasVariance)).toBe(true);

    const poAfter = await authed(request(app).get(`/api/v1/purchase-orders/${poId}`));
    expect(poAfter.body.data.purchaseOrder.status).toBe('BILLED');
  });

  it('flags a real quantity variance when the bill differs from what was ordered', async () => {
    const po = await authed(request(app).post('/api/v1/purchase-orders')).send({
      vendorId,
      warehouseId,
      lines: [{ itemId, quantity: 15, unitCost: 9 }],
    });
    const poId = po.body.data.purchaseOrder.id;

    const bill = await authed(request(app).post('/api/v1/bills')).send({
      vendorId,
      warehouseId,
      purchaseOrderId: poId,
      items: [{ itemId, quantity: 12, unitCost: 9 }],
    });
    expect(bill.status).toBe(201);
    expect(bill.body.data.poVariance[0].hasVariance).toBe(true);
    expect(bill.body.data.poVariance[0].quantityVariance).toBe(-3);
  });

  it('refuses to bill against a cancelled PO', async () => {
    const po = await authed(request(app).post('/api/v1/purchase-orders')).send({
      vendorId,
      warehouseId,
      lines: [{ itemId, quantity: 5, unitCost: 9 }],
    });
    const poId = po.body.data.purchaseOrder.id;
    await authed(request(app).put(`/api/v1/purchase-orders/${poId}/status`)).send({ status: 'CANCELLED' });

    const bill = await authed(request(app).post('/api/v1/bills')).send({
      vendorId,
      warehouseId,
      purchaseOrderId: poId,
      items: [{ itemId, quantity: 5, unitCost: 9 }],
    });
    expect(bill.status).toBe(400);
  });
});
