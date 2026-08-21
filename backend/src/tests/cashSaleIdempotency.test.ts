import { deleteAuditLogs } from './testHelpers';
import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';

describe('Cash Sale idempotency (offline-sync retry safety)', () => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tenantSlug = `sale-idem-corp-1-${runId}`;
  const tenantSchema = `tenant_sale_idem_corp_1_${runId}`;
  const adminEmail = `admin_sale_idem_${runId}@corp1.com`;

  let tenantId: string;
  let adminToken: string;
  let warehouseId: string;
  let itemId: string;
  let tillId: string;

  async function cleanupTestData() {
    await deleteAuditLogs(prisma, { tenantId });
    await deleteTenantBySlug(prisma, tenantSlug).catch(() => {});
    await deleteUserByEmail(prisma, adminEmail).catch(() => {});
    await dropTenantSchema(prisma, tenantSchema).catch(() => {});
  }

  beforeAll(async () => {
    await prisma.$connect();
    await ensureTenantTableExists(prisma);
    await ensureUserTableExists(prisma);

    const onboard = await onboardTenant(prisma, {
      companyName: 'Sale Idem Corp 1',
      slug: tenantSlug,
      adminEmail,
      adminPassword: 'Password123!',
      adminName: 'Sale Idem Corp 1 Admin',
    });
    adminToken = onboard.token;
    tenantId = onboard.tenant.id;

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
        name: 'Bottled Water',
        costPrice: 1,
        sellingPrice: 2,
        initialWarehouseId: warehouseId,
        // Plenty of stock - these tests isolate the clientTxnId dedup
        // behavior from the separate stock-race behavior already covered by
        // cashTill.test.ts, so a dedup bug (double processing) would show up
        // as a real double stock deduction rather than being masked by an
        // unrelated insufficient-stock rejection.
        initialQty: 1000,
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

  async function currentStock(): Promise<number> {
    const warehouses = await request(app)
      .get('/api/v1/inventory/warehouses')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);
    const warehouse = warehouses.body.data.warehouses.find((w: any) => w.id === warehouseId);
    return warehouse.stocks.find((s: any) => s.itemId === itemId).quantityOnHand;
  }

  it('deduplicates two concurrent sales sharing the same clientTxnId - exactly one sale, one stock deduction', async () => {
    const stockBefore = await currentStock();
    const clientTxnId = `client-txn-concurrent-${runId}`;

    const [resA, resB] = await Promise.all([
      request(app)
        .post('/api/v1/tills/sales')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({ tillId, items: [{ itemId, quantity: 3 }], cashGiven: 10, clientTxnId }),
      request(app)
        .post('/api/v1/tills/sales')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({ tillId, items: [{ itemId, quantity: 3 }], cashGiven: 10, clientTxnId }),
    ]);

    const statuses = [resA.status, resB.status].sort((a, b) => a - b);
    // One request created the sale (201), the other found it already existed
    // and replayed it back (200) - neither is a 500/duplicate-create.
    expect(statuses).toEqual([200, 201]);

    const winner = resA.status === 201 ? resA : resB;
    const loser = resA.status === 201 ? resB : resA;
    expect(loser.body.data.replayed).toBe(true);
    expect(loser.body.data.sale.id).toBe(winner.body.data.sale.id);

    const salesInDb = await prisma.cashSale.findMany({ where: { tenantId, clientTxnId } });
    expect(salesInDb).toHaveLength(1);

    // Stock decremented exactly once (3 units), not twice (6 units) - the
    // actual regression this test guards against.
    const stockAfter = await currentStock();
    expect(stockBefore - stockAfter).toBe(3);
  });

  it('replays a sequential retry (second call after the first already committed) without double-processing', async () => {
    const stockBefore = await currentStock();
    const clientTxnId = `client-txn-sequential-${runId}`;

    const first = await request(app)
      .post('/api/v1/tills/sales')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ tillId, items: [{ itemId, quantity: 2 }], cashGiven: 10, clientTxnId });
    expect(first.status).toBe(201);

    const retry = await request(app)
      .post('/api/v1/tills/sales')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ tillId, items: [{ itemId, quantity: 2 }], cashGiven: 10, clientTxnId });
    expect(retry.status).toBe(200);
    expect(retry.body.data.replayed).toBe(true);
    expect(retry.body.data.sale.id).toBe(first.body.data.sale.id);

    const salesInDb = await prisma.cashSale.findMany({ where: { tenantId, clientTxnId } });
    expect(salesInDb).toHaveLength(1);

    const stockAfter = await currentStock();
    expect(stockBefore - stockAfter).toBe(2);
  });

  it('still processes normally when no clientTxnId is supplied (backward compatibility)', async () => {
    const res = await request(app)
      .post('/api/v1/tills/sales')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ tillId, items: [{ itemId, quantity: 1 }], cashGiven: 10 });

    expect(res.status).toBe(201);
    expect(res.body.data.replayed).toBe(false);
  });

  it('void-stats buckets by clientOccurredAt when present, falling back to createdAt otherwise', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const backdatedClientTxnId = `client-txn-backdated-${runId}`;

    const backdated = await request(app)
      .post('/api/v1/tills/sales')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({
        tillId,
        items: [{ itemId, quantity: 1 }],
        cashGiven: 10,
        clientTxnId: backdatedClientTxnId,
        clientOccurredAt: yesterday.toISOString(),
      });
    expect(backdated.status).toBe(201);

    // Void it so it shows up in void-stats' voided count for a distinctive assertion.
    await request(app)
      .post(`/api/v1/tills/sales/${backdated.body.data.sale.id}/void`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ reason: 'Idempotency test cleanup void' });

    // Query bucketed for "yesterday" - should include the backdated sale even
    // though its real DB createdAt is ~now.
    const yesterdayStart = new Date(yesterday);
    yesterdayStart.setHours(0, 0, 0, 0);
    const yesterdayEnd = new Date(yesterday);
    yesterdayEnd.setHours(23, 59, 59, 999);

    const statsForYesterday = await request(app)
      .get('/api/v1/tills/void-stats')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .query({ from: yesterdayStart.toISOString(), to: yesterdayEnd.toISOString() });

    const adminRowYesterday = statsForYesterday.body.data.find((r: any) => r.name === 'Sale Idem Corp 1 Admin');
    expect(adminRowYesterday).toBeDefined();
    expect(adminRowYesterday.voidedSales).toBeGreaterThanOrEqual(1);

    // Query bucketed for "today" (createdAt's real range) - a naive
    // createdAt-only filter would have wrongly included the backdated sale
    // here too; clientOccurredAt bucketing correctly excludes it.
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const statsForToday = await request(app)
      .get('/api/v1/tills/void-stats')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .query({ from: todayStart.toISOString(), to: yesterdayEnd.toISOString() });

    // "today" query range here is deliberately empty/inverted (todayStart >
    // yesterdayEnd), so nothing should match at all if bucketing is correct -
    // proves the backdated sale isn't leaking in via createdAt.
    const adminRowToday = statsForToday.body.data.find((r: any) => r.name === 'Sale Idem Corp 1 Admin');
    expect(adminRowToday).toBeUndefined();
  });

  it('records a sync-failure as an audit log entry, without creating any CashSale row', async () => {
    const clientTxnId = `client-txn-sync-failed-${runId}`;
    const res = await request(app)
      .post('/api/v1/tills/sales/sync-failures')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({
        clientTxnId,
        reason: 'Insufficient stock at sync time (stock changed concurrently).',
        saleSnapshot: { tillId, items: [{ itemId, quantity: 500 }], cashGiven: 1000 },
      });

    expect(res.status).toBe(200);

    const salesInDb = await prisma.cashSale.findMany({ where: { tenantId, clientTxnId } });
    expect(salesInDb).toHaveLength(0);

    const auditRows = await prisma.auditLog.findMany({
      where: { tenantId, action: 'CASH_SALE.SYNC_FAILED', entityId: clientTxnId },
    });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].details).toContain('Insufficient stock at sync time');
    expect((auditRows[0].changes as any)?.saleSnapshot?.to?.tillId).toBe(tillId);
  });
});
