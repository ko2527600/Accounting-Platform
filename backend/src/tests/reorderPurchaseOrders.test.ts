import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';

describe('Auto-generate Purchase Orders on reorder threshold', () => {
  const runId = Date.now();
  const tenantSlug = `reorder-corp-${runId}`;
  const tenantSchema = `tenant_reorder_corp_${runId}`;
  const adminEmail = `admin_reorder_${runId}@corp.com`;

  let adminToken: string;
  let vendorId: string;
  let warehouseId: string;

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
      companyName: 'Reorder Corp',
      slug: tenantSlug,
      adminEmail,
      adminPassword: 'Password123!',
      adminName: 'Reorder Admin',
    });
    adminToken = onboard.token;

    const vendor = await authed(request(app).post('/api/v1/bills/vendors')).send({ name: 'Reorder Vendor', email: `reorder_${runId}@vendor.com` });
    vendorId = vendor.body.data.vendor.id;

    const warehouse = await authed(request(app).post('/api/v1/inventory/warehouses')).send({ name: 'Reorder Warehouse' });
    warehouseId = warehouse.body.data.warehouse.id;
  }, 60000);

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it('drafts a PO for a low-stock item with a preferred vendor, ordering enough to reach the reorder level', async () => {
    const item = await authed(request(app).post('/api/v1/inventory/items')).send({
      name: 'Low Stock Widget',
      sku: `REORDER-A-${runId}`,
      costPrice: 5,
      sellingPrice: 10,
      reorderLevel: 20,
      preferredVendorId: vendorId,
      initialWarehouseId: warehouseId,
      initialQty: 5,
    });
    expect(item.status).toBe(201);

    const res = await authed(request(app).post('/api/v1/purchase-orders/generate-for-reorder')).send({ warehouseId });
    expect(res.status).toBe(201);
    expect(res.body.data.created).toHaveLength(1);
    expect(res.body.data.created[0].vendorId).toBe(vendorId);
    expect(res.body.data.created[0].status).toBe('DRAFT');
    expect(res.body.data.created[0].lines[0].quantity).toBe(15); // 20 reorderLevel - 5 on hand
  });

  it('skips (and reports) a low-stock item with no preferred vendor', async () => {
    const item = await authed(request(app).post('/api/v1/inventory/items')).send({
      name: 'No Vendor Widget',
      sku: `REORDER-B-${runId}`,
      costPrice: 5,
      sellingPrice: 10,
      reorderLevel: 20,
      initialWarehouseId: warehouseId,
      initialQty: 2,
    });
    expect(item.status).toBe(201);

    const res = await authed(request(app).post('/api/v1/purchase-orders/generate-for-reorder')).send({ warehouseId });
    expect(res.status).toBe(201);
    const skippedNames = res.body.data.skippedNoVendor.map((s: any) => s.itemName);
    expect(skippedNames).toContain('No Vendor Widget');
  });

  it('does not draft a PO for an item that is above its reorder level', async () => {
    await authed(request(app).post('/api/v1/inventory/items')).send({
      name: 'Well Stocked Widget',
      sku: `REORDER-C-${runId}`,
      costPrice: 5,
      sellingPrice: 10,
      reorderLevel: 10,
      preferredVendorId: vendorId,
      initialWarehouseId: warehouseId,
      initialQty: 100,
    });

    const res = await authed(request(app).post('/api/v1/purchase-orders/generate-for-reorder')).send({ warehouseId });
    const allItemNames = res.body.data.created.flatMap((po: any) => po.lines.map((l: any) => l.item.name));
    expect(allItemNames).not.toContain('Well Stocked Widget');
  });

  it('groups multiple low-stock items with the same preferred vendor into one PO', async () => {
    const runId2 = Date.now();
    await authed(request(app).post('/api/v1/inventory/items')).send({
      name: 'Grouped A', sku: `GROUP-A-${runId2}`, costPrice: 5, sellingPrice: 10, reorderLevel: 10,
      preferredVendorId: vendorId, initialWarehouseId: warehouseId, initialQty: 1,
    });
    await authed(request(app).post('/api/v1/inventory/items')).send({
      name: 'Grouped B', sku: `GROUP-B-${runId2}`, costPrice: 5, sellingPrice: 10, reorderLevel: 10,
      preferredVendorId: vendorId, initialWarehouseId: warehouseId, initialQty: 1,
    });

    const res = await authed(request(app).post('/api/v1/purchase-orders/generate-for-reorder')).send({ warehouseId });
    const posForVendor = res.body.data.created.filter((po: any) => po.vendorId === vendorId);
    expect(posForVendor).toHaveLength(1);
    const itemNames = posForVendor[0].lines.map((l: any) => l.item.name);
    expect(itemNames).toEqual(expect.arrayContaining(['Grouped A', 'Grouped B']));
  });

  it('rejects an unknown warehouse', async () => {
    const res = await authed(request(app).post('/api/v1/purchase-orders/generate-for-reorder')).send({ warehouseId: 'nonexistent' });
    expect(res.status).toBe(404);
  });
});
