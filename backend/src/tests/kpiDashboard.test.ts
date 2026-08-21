import { deleteAuditLogs } from './testHelpers';
import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';

describe('KPI & Financial Ratio Dashboard', () => {
  const runId = Date.now();
  const tenantSlug = `kpi-corp-${runId}`;
  const tenantSchema = `tenant_kpi_corp_${runId}`;
  const adminEmail = `admin_kpi_${runId}@corp.com`;

  let adminToken: string;
  let tenantId: string;
  let cashAccountId: string;
  let revenueAccountId: string;
  let expenseAccountId: string;
  let liabilityAccountId: string;
  let equityAccountId: string;

  async function cleanupTestData() {
    if (tenantId) {
      await deleteAuditLogs(prisma, { tenantId });
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
      companyName: 'KPI Corp',
      slug: tenantSlug,
      adminEmail,
      adminPassword: 'Password123!',
      adminName: 'KPI Admin',
    });
    adminToken = onboard.token;
    tenantId = onboard.tenant.id;

    const cashAcc = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ code: '1010', name: 'Cash & Bank', type: 'ASSET' });
    cashAccountId = cashAcc.body.data.account.id;

    const revAcc = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ code: '4010', name: 'Consulting Revenue', type: 'REVENUE' });
    revenueAccountId = revAcc.body.data.account.id;

    const expAcc = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ code: '5010', name: 'Software Expense', type: 'EXPENSE' });
    expenseAccountId = expAcc.body.data.account.id;

    const liabAcc = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ code: '2010', name: 'Accounts Payable', type: 'LIABILITY' });
    liabilityAccountId = liabAcc.body.data.account.id;

    const eqAcc = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ code: '3010', name: 'Owner Capital', type: 'EQUITY' });
    equityAccountId = eqAcc.body.data.account.id;

    // Owner injects 5000 capital
    await request(app)
      .post('/api/v1/journal-entries')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({
        entryNumber: `JE-KPI-${runId}-001`,
        entryDate: '2026-07-01',
        description: 'Initial Capital Injection',
        status: 'POSTED',
        lines: [
          { accountId: cashAccountId, debit: 5000, credit: 0 },
          { accountId: equityAccountId, debit: 0, credit: 5000 },
        ],
      });

    // 3000 revenue paid in cash
    await request(app)
      .post('/api/v1/journal-entries')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({
        entryNumber: `JE-KPI-${runId}-002`,
        entryDate: '2026-07-05',
        description: 'Consulting Project Completed',
        status: 'POSTED',
        lines: [
          { accountId: cashAccountId, debit: 3000, credit: 0 },
          { accountId: revenueAccountId, debit: 0, credit: 3000 },
        ],
      });

    // 1200 expense on credit (accounts payable)
    await request(app)
      .post('/api/v1/journal-entries')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({
        entryNumber: `JE-KPI-${runId}-003`,
        entryDate: '2026-07-10',
        description: 'SaaS Tool Subscriptions',
        status: 'POSTED',
        lines: [
          { accountId: expenseAccountId, debit: 1200, credit: 0 },
          { accountId: liabilityAccountId, debit: 0, credit: 1200 },
        ],
      });

    // Partial payment of the payable, 500 out of cash
    await request(app)
      .post('/api/v1/journal-entries')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({
        entryNumber: `JE-KPI-${runId}-004`,
        entryDate: '2026-07-15',
        description: 'Partial Bill Payment',
        status: 'POSTED',
        lines: [
          { accountId: liabilityAccountId, debit: 500, credit: 0 },
          { accountId: cashAccountId, debit: 0, credit: 500 },
        ],
      });
  }, 120000);

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  describe('GET /api/v1/reports/kpis', () => {
    it('requires authentication', async () => {
      const res = await request(app).get('/api/v1/reports/kpis').set('X-Tenant-ID', tenantSlug);
      expect(res.status).toBe(401);
    });

    it('computes all ratios correctly against hand-verified totals', async () => {
      const res = await request(app)
        .get('/api/v1/reports/kpis')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug);

      expect(res.status).toBe(200);
      const data = res.body.data;

      // Totals: Cash 7500, Liabilities 700 (1200 - 500), Equity 6800 (5000 capital + 1800 retained earnings)
      expect(data.totalAssets).toBe(7500);
      expect(data.totalCashEquivalents).toBe(7500);
      expect(data.totalLiabilities).toBe(700);
      expect(data.totalEquity).toBe(6800);
      expect(data.totalRevenue).toBe(3000);
      expect(data.netIncome).toBe(1800);

      // Net Profit Margin = 1800 / 3000 * 100 = 60
      expect(data.netProfitMarginPct).toBe(60);
      // Return on Assets = 1800 / 7500 * 100 = 24
      expect(data.returnOnAssetsPct).toBe(24);
      // Debt-to-Equity = 700 / 6800
      expect(data.debtToEquityRatio).toBeCloseTo(700 / 6800, 2);
      // Cash Ratio = 7500 / 700
      expect(data.cashRatio).toBeCloseTo(7500 / 700, 2);
      // Equity Ratio = 6800 / 7500 * 100
      expect(data.equityRatioPct).toBeCloseTo((6800 / 7500) * 100, 2);
    });

    it('scopes net income and margin to a date range while keeping balance-sheet totals point-in-time', async () => {
      const res = await request(app)
        .get('/api/v1/reports/kpis?startDate=2026-07-01&endDate=2026-07-05')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug);

      expect(res.status).toBe(200);
      const data = res.body.data;
      // Only the July 1 and July 5 entries fall in range: revenue 3000, no expense yet.
      expect(data.totalRevenue).toBe(3000);
      expect(data.netIncome).toBe(3000);
      expect(data.netProfitMarginPct).toBe(100);
      // Balance sheet totals are as of endDate (2026-07-05): cash 8000, equity 5000 + 3000 retained = 8000, no liabilities yet.
      expect(data.totalAssets).toBe(8000);
      expect(data.totalLiabilities).toBe(0);
      expect(data.totalEquity).toBe(8000);
      // Cash ratio is undefined (null) when there are no liabilities to divide by.
      expect(data.cashRatio).toBeNull();
    });

    it('rejects a malformed date', async () => {
      const res = await request(app)
        .get('/api/v1/reports/kpis?endDate=not-a-date')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug);
      expect(res.status).toBe(400);
    });
  });
});
