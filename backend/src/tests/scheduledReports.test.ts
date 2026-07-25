import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';
import { EmailService } from '../services/EmailService';

describe('Scheduled Reports API', () => {
  const runId = Date.now();
  const tenant1Slug = `sched-corp-1-${runId}`;
  const tenant1Schema = `tenant_sched_corp_1_${runId}`;
  const admin1Email = `admin_sched1_${runId}@corp1.com`;

  const tenant2Slug = `sched-corp-2-${runId}`;
  const tenant2Schema = `tenant_sched_corp_2_${runId}`;
  const admin2Email = `admin_sched2_${runId}@corp2.com`;

  let token1: string;
  let token2: string;

  async function cleanupTestData() {
    await deleteTenantBySlug(prisma, tenant1Slug).catch(() => {});
    await deleteTenantBySlug(prisma, tenant2Slug).catch(() => {});
    await deleteUserByEmail(prisma, admin1Email).catch(() => {});
    await deleteUserByEmail(prisma, admin2Email).catch(() => {});
    await dropTenantSchema(prisma, tenant1Schema).catch(() => {});
    await dropTenantSchema(prisma, tenant2Schema).catch(() => {});
  }

  beforeAll(async () => {
    await prisma.$connect();
    await ensureTenantTableExists(prisma);
    await ensureUserTableExists(prisma);
    await cleanupTestData();

    const onboard1 = await onboardTenant(prisma, {
      companyName: 'Scheduled Reports Corp 1',
      slug: tenant1Slug,
      adminEmail: admin1Email,
      adminPassword: 'Password123!',
      adminName: 'Sched Corp 1 Admin',
    });
    token1 = onboard1.token;

    const onboard2 = await onboardTenant(prisma, {
      companyName: 'Scheduled Reports Corp 2',
      slug: tenant2Slug,
      adminEmail: admin2Email,
      adminPassword: 'Password123!',
      adminName: 'Sched Corp 2 Admin',
    });
    token2 = onboard2.token;
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it('does not leak one tenant\'s schedule into another\'s (was keyed by an always-undefined req.tenantId)', async () => {
    const save1 = await request(app)
      .post('/api/v1/reports/schedule')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ frequency: 'Daily', recipients: ['owner1@corp1.com'], reportType: 'ProfitAndLoss', enabled: true });
    expect(save1.status).toBe(200);

    const save2 = await request(app)
      .post('/api/v1/reports/schedule')
      .set('Authorization', `Bearer ${token2}`)
      .set('X-Tenant-ID', tenant2Slug)
      .send({ frequency: 'Monthly', recipients: ['owner2@corp2.com'], reportType: 'BalanceSheet', enabled: false });
    expect(save2.status).toBe(200);

    const get1 = await request(app)
      .get('/api/v1/reports/schedule')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug);
    expect(get1.body.data.schedule.frequency).toBe('Daily');
    expect(get1.body.data.schedule.recipients).toEqual(['owner1@corp1.com']);

    const get2 = await request(app)
      .get('/api/v1/reports/schedule')
      .set('Authorization', `Bearer ${token2}`)
      .set('X-Tenant-ID', tenant2Slug);
    expect(get2.body.data.schedule.frequency).toBe('Monthly');
    expect(get2.body.data.schedule.recipients).toEqual(['owner2@corp2.com']);
  });

  it('test-email uses the tenant\'s real closeout data instead of hardcoded figures', async () => {
    const sendSpy = jest.spyOn(EmailService, 'sendWeeklyExecutiveReport').mockResolvedValue(true);

    const warehouse = await request(app)
      .post('/api/v1/inventory/warehouses')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ name: 'Sched Test Shop' });
    const warehouseId = warehouse.body.data.warehouse.id;

    const item = await request(app)
      .post('/api/v1/inventory/items')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ name: 'Sched Test Item', costPrice: 5, sellingPrice: 10, initialWarehouseId: warehouseId, initialQty: 20 });
    const itemId = item.body.data.item.id;

    const till = await request(app)
      .post('/api/v1/tills/open')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ warehouseId, openingCash: 100 });
    const tillId = till.body.data.till.id;

    // Record a real cash sale: 3 units @ 10 = 30 in cash sales.
    await request(app)
      .post('/api/v1/tills/sales')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ tillId, itemId, quantity: 3, cashGiven: 30 });

    await request(app)
      .post('/api/v1/tills/close')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ tillId, actualEndingCash: 130 });

    const res = await request(app)
      .post('/api/v1/reports/schedule/test-email')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ recipientEmail: 'owner1@corp1.com' });

    expect(res.status).toBe(200);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const [, , reportData] = sendSpy.mock.calls[0];
    // Real recorded cash sale of 30, not the old hardcoded weeklySales: 3450.00.
    expect(reportData.weeklySales).toBe(30);
    expect(reportData.totalItemsSold).toBe(1); // itemsSold on the closeout counts sale transactions, not units
    expect(reportData.topShopName).toBe('Sched Test Shop');

    sendSpy.mockRestore();
  });
});
