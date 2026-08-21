import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';

/**
 * Confirms the fundId report filter added to reportRepository.ts (Balance
 * Sheet, P&L) is genuinely additive: an unfiltered call still sums
 * everything (regression check - no behavior change for tenants without
 * funds), while a fund-scoped call only sums that fund's ledger rows.
 */
describe('Fund-scoped reports (Balance Sheet, P&L)', () => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tenantSlug = `fund-report-corp-${runId}`;
  const tenantSchema = `tenant_fund_report_corp_${runId}`;
  const adminEmail = `admin_fundreport_${runId}@corp.com`;

  let adminToken: string;
  let tenantId: string;
  let cashAccountId: string;
  let revenueAccountId: string;
  let fundAId: string;
  let fundBId: string;

  async function cleanupTestData() {
    if (tenantId) {
      await prisma.fund.deleteMany({ where: { tenantId } }).catch(() => {});
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
      companyName: 'Fund Report Corp',
      slug: tenantSlug,
      adminEmail,
      adminPassword: 'Password123!',
      adminName: 'Fund Report Corp Admin',
    });
    adminToken = onboard.token;
    tenantId = onboard.tenant.id;

    const cashAcc = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ code: '1010', name: 'Cash on Hand', type: 'ASSET' });
    cashAccountId = cashAcc.body.data.account.id;

    const revenueAcc = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ code: '4010', name: 'Donations', type: 'REVENUE' });
    revenueAccountId = revenueAcc.body.data.account.id;

    const fundA = await request(app)
      .post('/api/v1/funds')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ name: 'Building Fund', code: 'BUILDING' });
    fundAId = fundA.body.data.fund.id;

    const fundB = await request(app)
      .post('/api/v1/funds')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ name: 'General Fund', code: 'GENERAL', isRestricted: false });
    fundBId = fundB.body.data.fund.id;

    // Fund A: 1000 posted (Cash debit / Revenue credit).
    await request(app)
      .post('/api/v1/journal-entries')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({
        entryNumber: `JE-FUND-A-${runId}`,
        status: 'POSTED',
        lines: [
          { accountId: cashAccountId, debit: 1000, credit: 0, fundId: fundAId },
          { accountId: revenueAccountId, debit: 0, credit: 1000, fundId: fundAId },
        ],
      });

    // Fund B: 400 posted (Cash debit / Revenue credit).
    await request(app)
      .post('/api/v1/journal-entries')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({
        entryNumber: `JE-FUND-B-${runId}`,
        status: 'POSTED',
        lines: [
          { accountId: cashAccountId, debit: 400, credit: 0, fundId: fundBId },
          { accountId: revenueAccountId, debit: 0, credit: 400, fundId: fundBId },
        ],
      });
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it('scopes the Balance Sheet Cash total to just one fund when filtered, and sums everything when unfiltered', async () => {
    const fundAReport = await request(app)
      .get(`/api/v1/reports/balance-sheet?fundId=${fundAId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);
    expect(fundAReport.status).toBe(200);
    const cashAssetA = fundAReport.body.data.assets.find((a: any) => a.id === cashAccountId);
    expect(cashAssetA.balance).toBe(1000);

    const fundBReport = await request(app)
      .get(`/api/v1/reports/balance-sheet?fundId=${fundBId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);
    const cashAssetB = fundBReport.body.data.assets.find((a: any) => a.id === cashAccountId);
    expect(cashAssetB.balance).toBe(400);

    const unfiltered = await request(app)
      .get('/api/v1/reports/balance-sheet')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);
    const cashAssetAll = unfiltered.body.data.assets.find((a: any) => a.id === cashAccountId);
    expect(cashAssetAll.balance).toBe(1400);
  });

  it('scopes the P&L Revenue total to just one fund when filtered, and sums everything when unfiltered', async () => {
    const fundAReport = await request(app)
      .get(`/api/v1/reports/profit-loss?fundId=${fundAId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);
    expect(fundAReport.status).toBe(200);
    expect(fundAReport.body.data.totalRevenue).toBe(1000);

    const fundBReport = await request(app)
      .get(`/api/v1/reports/profit-loss?fundId=${fundBId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);
    expect(fundBReport.body.data.totalRevenue).toBe(400);

    const unfiltered = await request(app)
      .get('/api/v1/reports/profit-loss')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);
    expect(unfiltered.body.data.totalRevenue).toBe(1400);
  });
});
