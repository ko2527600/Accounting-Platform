import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';

describe('Location-scoped permissions (Shop Manager / Cashier)', () => {
  const runId = Date.now();
  const tenantSlug = `wh-perm-corp-${runId}`;
  const tenantSchema = `tenant_wh_perm_corp_${runId}`;
  const adminEmail = `admin_whperm_${runId}@corp.com`;
  const managerEmail = `manager_whperm_${runId}@corp.com`;

  let adminToken: string;
  let tenantId: string;
  let managerToken: string;
  let warehouseAId: string;
  let warehouseBId: string;
  let itemId: string;

  async function cleanupTestData() {
    if (tenantId) {
      await prisma.auditLog.deleteMany({ where: { tenantId } }).catch(() => {});
    }
    await deleteTenantBySlug(prisma, tenantSlug).catch(() => {});
    await deleteUserByEmail(prisma, adminEmail).catch(() => {});
    await deleteUserByEmail(prisma, managerEmail).catch(() => {});
    await dropTenantSchema(prisma, tenantSchema).catch(() => {});
  }

  beforeAll(async () => {
    await prisma.$connect();
    await ensureTenantTableExists(prisma);
    await ensureUserTableExists(prisma);
    await cleanupTestData();

    const onboard = await onboardTenant(prisma, {
      companyName: 'Warehouse Permissions Corp',
      slug: tenantSlug,
      adminEmail,
      adminPassword: 'Password123!',
      adminName: 'Permissions Admin',
    });
    adminToken = onboard.token;
    tenantId = onboard.tenant.id;

    const whA = await request(app)
      .post('/api/v1/inventory/warehouses')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ name: 'Shop A' });
    warehouseAId = whA.body.data.warehouse.id;

    const whB = await request(app)
      .post('/api/v1/inventory/warehouses')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ name: 'Shop B' });
    warehouseBId = whB.body.data.warehouse.id;

    const item = await request(app)
      .post('/api/v1/inventory/items')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ name: 'Scoped Widget', costPrice: 1, sellingPrice: 2, initialWarehouseId: warehouseAId, initialQty: 20 });
    itemId = item.body.data.item.id;

    // Also seed some stock in Shop B so cross-warehouse checks have something real to block.
    await request(app)
      .post('/api/v1/inventory/adjustments')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ warehouseId: warehouseBId, itemId, mode: 'add', quantity: 10, reason: 'Seed Shop B stock for test' });

    // Invite a Shop Manager scoped to Shop A only, then accept the invitation directly.
    const invite = await request(app)
      .post('/api/v1/tenants/invite')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ email: managerEmail, role: 'Shop Manager', warehouseIds: [warehouseAId] });
    expect(invite.status).toBe(201);

    const accept = await request(app)
      .post('/api/v1/auth/accept-invitation')
      .send({ token: invite.body.data.invitation.token, name: 'Shop A Manager', password: 'Password123!' });
    expect(accept.status).toBe(200);
    managerToken = accept.body.data.token;
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it('grants WarehouseAccess for the invited shop on acceptance', async () => {
    const warehouses = await request(app)
      .get('/api/v1/inventory/warehouses')
      .set('Authorization', `Bearer ${managerToken}`)
      .set('X-Tenant-ID', tenantSlug);

    expect(warehouses.status).toBe(200);
    const ids = warehouses.body.data.warehouses.map((w: any) => w.id);
    expect(ids).toEqual([warehouseAId]);
    expect(ids).not.toContain(warehouseBId);
  });

  it("shows the same product catalog but only the manager's shop's stock levels", async () => {
    const items = await request(app)
      .get('/api/v1/inventory/items')
      .set('Authorization', `Bearer ${managerToken}`)
      .set('X-Tenant-ID', tenantSlug);

    expect(items.status).toBe(200);
    const scopedWidget = items.body.data.items.find((it: any) => it.id === itemId);
    expect(scopedWidget).toBeDefined();
    const stockWarehouseIds = scopedWidget.warehouseStocks.map((s: any) => s.warehouseId);
    expect(stockWarehouseIds).toEqual([warehouseAId]);
  });

  it('allows the Shop Manager to adjust stock in their assigned shop', async () => {
    const res = await request(app)
      .post('/api/v1/inventory/adjustments')
      .set('Authorization', `Bearer ${managerToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ warehouseId: warehouseAId, itemId, mode: 'add', quantity: 5, reason: 'Manager restocking their own shop' });

    expect(res.status).toBe(201);
  });

  it('blocks the Shop Manager from adjusting stock in a shop they are not assigned to', async () => {
    const res = await request(app)
      .post('/api/v1/inventory/adjustments')
      .set('Authorization', `Bearer ${managerToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ warehouseId: warehouseBId, itemId, mode: 'add', quantity: 5, reason: 'Attempting to touch another shop' });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('do not have access');
  });

  it('blocks a transfer where either side is outside the assigned shop(s)', async () => {
    const res = await request(app)
      .post('/api/v1/inventory/transfers')
      .set('Authorization', `Bearer ${managerToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ fromWarehouseId: warehouseAId, toWarehouseId: warehouseBId, itemId, quantity: 1 });

    expect(res.status).toBe(403);
  });

  it('blocks opening a till in a shop the Shop Manager is not assigned to', async () => {
    const res = await request(app)
      .post('/api/v1/tills/open')
      .set('Authorization', `Bearer ${managerToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ warehouseId: warehouseBId, openingCash: 100 });

    expect(res.status).toBe(403);
  });

  it('allows opening a till in the assigned shop', async () => {
    const res = await request(app)
      .post('/api/v1/tills/open')
      .set('Authorization', `Bearer ${managerToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ warehouseId: warehouseAId, openingCash: 100 });

    expect(res.status).toBe(201);
  });

  it('does not restrict Admin/Accountant roles at all (regression check)', async () => {
    const warehouses = await request(app)
      .get('/api/v1/inventory/warehouses')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);

    const ids = warehouses.body.data.warehouses.map((w: any) => w.id);
    expect(ids).toEqual(expect.arrayContaining([warehouseAId, warehouseBId]));

    const adjust = await request(app)
      .post('/api/v1/inventory/adjustments')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ warehouseId: warehouseBId, itemId, mode: 'add', quantity: 1, reason: 'Admin unrestricted access check' });
    expect(adjust.status).toBe(201);
  });

  it("lets an Admin change the Shop Manager's assigned shop via the manage-access endpoint", async () => {
    const membersRes = await request(app)
      .get('/api/v1/tenants/members')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);
    const managerMember = membersRes.body.data.members.find((m: any) => m.email === managerEmail);
    expect(managerMember).toBeDefined();
    expect(managerMember.warehouseAccess.map((a: any) => a.warehouseId)).toEqual([warehouseAId]);

    const updateRes = await request(app)
      .put(`/api/v1/tenants/members/${managerMember.id}/warehouse-access`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ warehouseIds: [warehouseBId] });
    expect(updateRes.status).toBe(200);

    const auditRows = await prisma.auditLog.findMany({
      where: { tenantId, entity: 'WarehouseAccess', entityId: managerMember.id, action: 'WAREHOUSE_ACCESS.UPDATED' },
    });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].changes).toEqual({ warehouseIds: { from: [warehouseAId], to: [warehouseBId] } });

    // The manager can now reach Shop B and no longer reaches Shop A.
    const afterUpdate = await request(app)
      .post('/api/v1/inventory/adjustments')
      .set('Authorization', `Bearer ${managerToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ warehouseId: warehouseBId, itemId, mode: 'add', quantity: 1, reason: 'Should now be allowed after re-assignment' });
    expect(afterUpdate.status).toBe(201);

    const shopANowBlocked = await request(app)
      .post('/api/v1/inventory/adjustments')
      .set('Authorization', `Bearer ${managerToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ warehouseId: warehouseAId, itemId, mode: 'add', quantity: 1, reason: 'Should now be blocked after re-assignment' });
    expect(shopANowBlocked.status).toBe(403);
  });
});
