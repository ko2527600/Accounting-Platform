import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { generateJwtToken } from '../utils/jwt';
import { onboardTenant } from '../services/tenantService';
import { createUser } from '../repository/userRepository';
import { hashPassword } from '../utils/password';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';

describe('Cash Sale Void - manager-authorized void with stock/till reversal', () => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tenantSlug = `void-corp-${runId}`;
  const tenantSchema = `tenant_void_corp_${runId}`;
  const adminEmail = `admin_void_${runId}@corp.com`;
  const cashierEmail = `cashier_void_${runId}@corp.com`;
  const managerEmail = `manager_void_${runId}@corp.com`;

  let adminToken: string;
  let cashierToken: string;
  let managerToken: string;
  let cashierId: string;
  let managerId: string;
  let warehouseId: string;
  let itemId: string;
  let tillId: string;

  async function cleanupTestData() {
    await deleteTenantBySlug(prisma, tenantSlug).catch(() => {});
    await deleteUserByEmail(prisma, adminEmail).catch(() => {});
    await deleteUserByEmail(prisma, cashierEmail).catch(() => {});
    await deleteUserByEmail(prisma, managerEmail).catch(() => {});
    await dropTenantSchema(prisma, tenantSchema).catch(() => {});
  }

  async function ringUpSale(token: string, quantity = 1) {
    return request(app)
      .post('/api/v1/tills/sales')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ tillId, items: [{ itemId, quantity }], cashGiven: 100 });
  }

  beforeAll(async () => {
    await prisma.$connect();
    await ensureTenantTableExists(prisma);
    await ensureUserTableExists(prisma);
    await cleanupTestData();

    const onboard = await onboardTenant(prisma, {
      companyName: 'Void Corp',
      slug: tenantSlug,
      adminEmail,
      adminPassword: 'Password123!',
      adminName: 'Void Admin',
    });
    adminToken = onboard.token;
    const tenantId = onboard.tenant.id;

    const cashier = await createUser(prisma, {
      email: cashierEmail,
      password: 'Password123!',
      name: 'Void Cashier',
      role: 'Cashier',
      tenantId,
      isActive: true,
    } as any);
    cashierId = cashier.id;
    cashierToken = generateJwtToken({ id: cashier.id, email: cashier.email, role: cashier.role, tenantId, name: cashier.name });

    const manager = await createUser(prisma, {
      email: managerEmail,
      password: hashPassword('ManagerPass123!'),
      name: 'Void Manager',
      role: 'Shop Manager',
      tenantId,
      isActive: true,
    } as any);
    managerId = manager.id;
    managerToken = generateJwtToken({ id: manager.id, email: manager.email, role: manager.role, tenantId, name: manager.name });

    const wh = await request(app)
      .post('/api/v1/inventory/warehouses')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ name: 'Void Test Shop' });
    warehouseId = wh.body.data.warehouse.id;

    // Grant both location-scoped roles access to this warehouse.
    await request(app)
      .put(`/api/v1/tenants/members/${cashierId}/warehouse-access`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ warehouseIds: [warehouseId] });
    await request(app)
      .put(`/api/v1/tenants/members/${managerId}/warehouse-access`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ warehouseIds: [warehouseId] });

    const item = await request(app)
      .post('/api/v1/inventory/items')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ name: 'Sugar', sku: 'SUG-1', costPrice: 2, sellingPrice: 5, initialWarehouseId: warehouseId, initialQty: 100 });
    itemId = item.body.data.item.id;

    const till = await request(app)
      .post('/api/v1/tills/open')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ warehouseId, openingCash: 200 });
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
  }, 60000);

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  async function getItemStock() {
    const res = await request(app)
      .get('/api/v1/inventory/items')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);
    const item = res.body.data.items.find((i: any) => i.id === itemId);
    return Number(item.warehouseStocks.find((s: any) => s.warehouseId === warehouseId).quantityOnHand);
  }

  it('lets an Admin self-authorize a void, restoring stock and reversing the till total and the revenue posting', async () => {
    const qtyBeforeSale = await getItemStock();

    const revenueBeforeSale = Number(
      (await request(app).get('/api/v1/reports/profit-loss').set('Authorization', `Bearer ${adminToken}`).set('X-Tenant-ID', tenantSlug))
        .body.data.totalRevenue
    );

    const saleRes = await ringUpSale(adminToken, 2);
    expect(saleRes.status).toBe(201);
    const saleId = saleRes.body.data.sale.id;
    expect(saleRes.body.data.sale.journalId).toBeTruthy();

    const qtyAfterSale = await getItemStock();
    expect(qtyAfterSale).toBe(qtyBeforeSale - 2);

    const revenueAfterSale = Number(
      (await request(app).get('/api/v1/reports/profit-loss').set('Authorization', `Bearer ${adminToken}`).set('X-Tenant-ID', tenantSlug))
        .body.data.totalRevenue
    );
    expect(revenueAfterSale).toBe(revenueBeforeSale + Number(saleRes.body.data.totalAmount));

    const tillBeforeVoid = await request(app)
      .get('/api/v1/tills/current')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .query({ warehouseId });
    const cashTotalBeforeVoid = Number(tillBeforeVoid.body.data.till.cashSalesTotal);

    const voidRes = await request(app)
      .post(`/api/v1/tills/sales/${saleId}/void`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ reason: 'Customer changed their mind' });

    expect(voidRes.status).toBe(200);
    expect(voidRes.body.data.sale.status).toBe('VOIDED');
    expect(voidRes.body.data.sale.voidedByName).toBeTruthy();
    expect(voidRes.body.data.sale.voidJournalId).toBeTruthy();

    const qtyAfterVoid = await getItemStock();
    expect(qtyAfterVoid).toBe(qtyBeforeSale);

    const tillAfterVoid = await request(app)
      .get('/api/v1/tills/current')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .query({ warehouseId });
    expect(Number(tillAfterVoid.body.data.till.cashSalesTotal)).toBe(cashTotalBeforeVoid - Number(saleRes.body.data.totalAmount));

    const revenueAfterVoid = Number(
      (await request(app).get('/api/v1/reports/profit-loss').set('Authorization', `Bearer ${adminToken}`).set('X-Tenant-ID', tenantSlug))
        .body.data.totalRevenue
    );
    expect(revenueAfterVoid).toBe(revenueBeforeSale);

    const auditRows = await prisma.auditLog.findMany({
      where: { action: 'CASH_SALE.VOIDED', entityId: saleId },
    });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].details).toContain('Void Admin');
  });

  it('rejects a void with no reason', async () => {
    const saleRes = await ringUpSale(adminToken, 1);
    const saleId = saleRes.body.data.sale.id;

    const res = await request(app)
      .post(`/api/v1/tills/sales/${saleId}/void`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('reason');
  });

  it('rejects voiding an already-voided sale', async () => {
    const saleRes = await ringUpSale(adminToken, 1);
    const saleId = saleRes.body.data.sale.id;

    await request(app)
      .post(`/api/v1/tills/sales/${saleId}/void`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ reason: 'first void' });

    const secondVoid = await request(app)
      .post(`/api/v1/tills/sales/${saleId}/void`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ reason: 'second attempt' });

    expect(secondVoid.status).toBe(400);
    expect(secondVoid.body.error).toContain('already been voided');
  });

  it("blocks a Cashier from voiding their own sale without a manager's step-up confirmation", async () => {
    const saleRes = await ringUpSale(cashierToken, 1);
    expect(saleRes.status).toBe(201);
    const saleId = saleRes.body.data.sale.id;

    const res = await request(app)
      .post(`/api/v1/tills/sales/${saleId}/void`)
      .set('Authorization', `Bearer ${cashierToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ reason: 'Wrong item scanned' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('manager must confirm');
  });

  it("rejects a Cashier-initiated void when the supplied manager password is wrong", async () => {
    const saleRes = await ringUpSale(cashierToken, 1);
    const saleId = saleRes.body.data.sale.id;

    const res = await request(app)
      .post(`/api/v1/tills/sales/${saleId}/void`)
      .set('Authorization', `Bearer ${cashierToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ reason: 'Wrong item scanned', managerEmail, managerPassword: 'wrong-password' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('incorrect');
  });

  it("approves a Cashier-initiated void once a Shop Manager's real credentials are supplied, recording the manager as authorizer", async () => {
    const saleRes = await ringUpSale(cashierToken, 1);
    const saleId = saleRes.body.data.sale.id;

    const res = await request(app)
      .post(`/api/v1/tills/sales/${saleId}/void`)
      .set('Authorization', `Bearer ${cashierToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ reason: 'Wrong item scanned', managerEmail, managerPassword: 'ManagerPass123!' });

    expect(res.status).toBe(200);
    expect(res.body.data.sale.status).toBe('VOIDED');
    expect(res.body.data.sale.voidedByName).toBe('Void Manager');

    const auditRows = await prisma.auditLog.findMany({
      where: { action: 'CASH_SALE.VOIDED', entityId: saleId },
    });
    expect(auditRows[0].details).toContain('Void Cashier');
    expect(auditRows[0].details).toContain('authorized by Void Manager');
  });

  it('blocks voiding a sale once its till has been closed', async () => {
    const closableTill = await request(app)
      .post('/api/v1/tills/open')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ warehouseId, openingCash: 50 });
    const closableTillId = closableTill.body.data.till.id;

    const saleRes = await request(app)
      .post('/api/v1/tills/sales')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ tillId: closableTillId, items: [{ itemId, quantity: 1 }], cashGiven: 100 });
    const saleId = saleRes.body.data.sale.id;

    await request(app)
      .post('/api/v1/tills/close')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ tillId: closableTillId, actualEndingCash: 55 });

    const voidRes = await request(app)
      .post(`/api/v1/tills/sales/${saleId}/void`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ reason: 'too late' });

    expect(voidRes.status).toBe(400);
    expect(voidRes.body.error).toContain('closed');
  });

  it('rejects a Cashier from viewing void statistics, and returns anomaly flags for a manager', async () => {
    const deniedRes = await request(app)
      .get('/api/v1/tills/void-stats')
      .set('Authorization', `Bearer ${cashierToken}`)
      .set('X-Tenant-ID', tenantSlug);
    expect(deniedRes.status).toBe(403);

    const statsRes = await request(app)
      .get('/api/v1/tills/void-stats')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);

    expect(statsRes.status).toBe(200);
    expect(Array.isArray(statsRes.body.data)).toBe(true);
    const cashierStats = statsRes.body.data.find((row: any) => row.name === 'Void Cashier');
    expect(cashierStats).toBeTruthy();
    expect(cashierStats.voidedSales).toBeGreaterThanOrEqual(1);
  });
});
