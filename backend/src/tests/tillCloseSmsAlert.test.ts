import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';
import { SmsService } from '../services/smsService';

describe('Till-close SMS alert to the tenant\'s configured boss number', () => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tenantSlug = `boss-sms-corp-${runId}`;
  const tenantSchema = `tenant_boss_sms_corp_${runId}`;
  const adminEmail = `admin_boss_sms_${runId}@corp.com`;

  let adminToken: string;
  let warehouseId: string;
  let itemId: string;

  async function cleanupTestData() {
    await deleteTenantBySlug(prisma, tenantSlug).catch(() => {});
    await deleteUserByEmail(prisma, adminEmail).catch(() => {});
    await dropTenantSchema(prisma, tenantSchema).catch(() => {});
  }

  async function openTill(openingCash: number) {
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
      companyName: 'Boss SMS Corp',
      slug: tenantSlug,
      adminEmail,
      adminPassword: 'Password123!',
      adminName: 'Boss SMS Corp Admin',
    });
    adminToken = onboard.token;

    const wh = await request(app)
      .post('/api/v1/inventory/warehouses')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ name: 'Boss SMS Shop' });
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
        initialQty: 50,
      });
    itemId = item.body.data.item.id;
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('rejects an unparsable boss phone number on PUT /tenants/current', async () => {
    const res = await request(app)
      .put('/api/v1/tenants/current')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ bossPhone: 'not-a-phone!' });

    expect(res.status).toBe(400);
  });

  it('does not dispatch an SMS on till close when no boss phone is configured', async () => {
    const sendSpy = jest.spyOn(SmsService, 'sendTillCloseAlert').mockResolvedValue(true);

    const tillId = await openTill(100);
    const closeRes = await request(app)
      .post('/api/v1/tills/close')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ tillId, actualEndingCash: 100 });

    expect(closeRes.status).toBe(200);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('dispatches a till-close summary SMS to the configured boss number on a balanced close', async () => {
    const putRes = await request(app)
      .put('/api/v1/tenants/current')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ bossPhone: '+233201234567' });
    expect(putRes.status).toBe(200);
    expect(putRes.body.data.tenant.bossPhone).toBe('+233201234567');

    const getRes = await request(app)
      .get('/api/v1/tenants/current')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);
    expect(getRes.body.data.tenant.bossPhone).toBe('+233201234567');

    const sendSpy = jest.spyOn(SmsService, 'sendTillCloseAlert').mockResolvedValue(true);

    const tillId = await openTill(100);
    const closeRes = await request(app)
      .post('/api/v1/tills/close')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ tillId, actualEndingCash: 100 });

    expect(closeRes.status).toBe(200);
    expect(Number(closeRes.body.data.report.discrepancy)).toBe(0);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const dto = sendSpy.mock.calls[0][0];
    expect(dto.recipientPhone).toBe('+233201234567');
    expect(dto.shopName).toBe('Boss SMS Shop');
    expect(dto.discrepancyText).toBe('BALANCED');
    expect(dto.expectedCash).toContain('100.00');
    expect(dto.actualCash).toContain('100.00');
  });

  it('reports a SHORT discrepancy in the till-close SMS when actual cash is under expected', async () => {
    const sendSpy = jest.spyOn(SmsService, 'sendTillCloseAlert').mockResolvedValue(true);

    const tillId = await openTill(100);
    const closeRes = await request(app)
      .post('/api/v1/tills/close')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ tillId, actualEndingCash: 80 }); // Expected 100, actual 80 -> short 20

    expect(closeRes.status).toBe(200);
    expect(Number(closeRes.body.data.report.discrepancy)).toBe(-20);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const dto = sendSpy.mock.calls[0][0];
    expect(dto.discrepancyText).toContain('SHORT');
    expect(dto.discrepancyText).toContain('20');
  });

  it('reports an OVER discrepancy in the till-close SMS when actual cash exceeds expected', async () => {
    const sendSpy = jest.spyOn(SmsService, 'sendTillCloseAlert').mockResolvedValue(true);

    const tillId = await openTill(100);
    const closeRes = await request(app)
      .post('/api/v1/tills/close')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ tillId, actualEndingCash: 115 }); // Expected 100, actual 115 -> over 15

    expect(closeRes.status).toBe(200);
    expect(Number(closeRes.body.data.report.discrepancy)).toBe(15);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const dto = sendSpy.mock.calls[0][0];
    expect(dto.discrepancyText).toContain('OVER');
    expect(dto.discrepancyText).toContain('15');
  });

  it('clears the boss phone when PUT /tenants/current is sent an empty string, disabling future alerts', async () => {
    const clearRes = await request(app)
      .put('/api/v1/tenants/current')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ bossPhone: '' });
    expect(clearRes.status).toBe(200);
    expect(clearRes.body.data.tenant.bossPhone).toBeNull();

    const sendSpy = jest.spyOn(SmsService, 'sendTillCloseAlert').mockResolvedValue(true);
    const tillId = await openTill(100);
    await request(app)
      .post('/api/v1/tills/close')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ tillId, actualEndingCash: 100 });

    expect(sendSpy).not.toHaveBeenCalled();
  });
});
