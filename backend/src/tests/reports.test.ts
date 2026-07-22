import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { generateJwtToken } from '../utils/jwt';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists, createUser } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';

describe('Financial Reporting API Integration Tests (BE-109)', () => {
  const tenant1Slug = 'report-corp-1';
  const tenant1Schema = 'tenant_report_corp_1';
  const adminEmail1 = 'admin_rpt1@corp1.com';
  const accountantEmail1 = 'accountant_rpt1@corp1.com';
  const viewerEmail1 = 'viewer_rpt1@corp1.com';

  const tenant2Slug = 'report-corp-2';
  const tenant2Schema = 'tenant_report_corp_2';
  const adminEmail2 = 'admin_rpt2@corp2.com';

  let tenant1Id: string;
  let tenant2Id: string;

  let adminToken1: string;
  let accountantToken1: string;
  let viewerToken1: string;
  let adminToken2: string;

  let cashAccountId1: string;
  let revenueAccountId1: string;
  let expenseAccountId1: string;
  let liabilityAccountId1: string;
  let equityAccountId1: string;

  async function cleanupTestData() {
    await deleteTenantBySlug(prisma, tenant1Slug).catch(() => {});
    await deleteTenantBySlug(prisma, tenant2Slug).catch(() => {});

    await deleteUserByEmail(prisma, adminEmail1).catch(() => {});
    await deleteUserByEmail(prisma, accountantEmail1).catch(() => {});
    await deleteUserByEmail(prisma, viewerEmail1).catch(() => {});
    await deleteUserByEmail(prisma, adminEmail2).catch(() => {});

    await dropTenantSchema(prisma, tenant1Schema).catch(() => {});
    await dropTenantSchema(prisma, tenant2Schema).catch(() => {});
  }

  beforeAll(async () => {
    await prisma.$connect();
    await ensureTenantTableExists(prisma);
    await ensureUserTableExists(prisma);
    await cleanupTestData();

    // 1. Onboard Tenant 1
    const onboard1 = await onboardTenant(prisma, {
      companyName: 'Report Corp 1',
      slug: tenant1Slug,
      adminEmail: adminEmail1,
      adminPassword: 'Password123!',
      adminName: 'Report Corp 1 Admin',
    });
    tenant1Id = onboard1.tenant.id;
    adminToken1 = onboard1.token;

    // Create Accountant User for Tenant 1
    const accountantUser1 = await createUser(prisma, {
      email: accountantEmail1,
      password: 'Password123!',
      name: 'Report Corp 1 Accountant',
      role: 'Accountant',
      tenantId: tenant1Id,
    });
    accountantToken1 = generateJwtToken({
      id: accountantUser1.id,
      email: accountantUser1.email,
      role: accountantUser1.role,
      tenantId: tenant1Id,
    });

    // Create Viewer User for Tenant 1
    const viewerUser1 = await createUser(prisma, {
      email: viewerEmail1,
      password: 'Password123!',
      name: 'Report Corp 1 Viewer',
      role: 'Viewer',
      tenantId: tenant1Id,
    });
    viewerToken1 = generateJwtToken({
      id: viewerUser1.id,
      email: viewerUser1.email,
      role: viewerUser1.role,
      tenantId: tenant1Id,
    });

    // 2. Onboard Tenant 2
    const onboard2 = await onboardTenant(prisma, {
      companyName: 'Report Corp 2',
      slug: tenant2Slug,
      adminEmail: adminEmail2,
      adminPassword: 'Password123!',
      adminName: 'Report Corp 2 Admin',
    });
    tenant2Id = onboard2.tenant.id;
    adminToken2 = onboard2.token;

    // 3. Set up Accounts for Tenant 1
    const cashAcc = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${accountantToken1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ code: '1010', name: 'Cash & Bank', type: 'ASSET' });
    cashAccountId1 = cashAcc.body.data.account.id;

    const revAcc = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${accountantToken1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ code: '4010', name: 'Consulting Services Revenue', type: 'REVENUE' });
    revenueAccountId1 = revAcc.body.data.account.id;

    const expAcc = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${accountantToken1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ code: '5010', name: 'Software Licenses Expense', type: 'EXPENSE' });
    expenseAccountId1 = expAcc.body.data.account.id;

    const liabAcc = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${accountantToken1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ code: '2010', name: 'Accounts Payable', type: 'LIABILITY' });
    liabilityAccountId1 = liabAcc.body.data.account.id;

    const eqAcc = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${accountantToken1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ code: '3010', name: 'Owner Capital', type: 'EQUITY' });
    equityAccountId1 = eqAcc.body.data.account.id;

    // 4. Record Initial Owner Capital Injection (Date: 2026-07-01)
    // Debit Cash 5000, Credit Owner Capital 5000
    await request(app)
      .post('/api/v1/journal-entries')
      .set('Authorization', `Bearer ${accountantToken1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({
        entryNumber: 'JE-RPT-001',
        entryDate: '2026-07-01',
        description: 'Initial Capital Injection',
        status: 'POSTED',
        lines: [
          { accountId: cashAccountId1, debit: 5000.0, credit: 0.0, description: 'Capital deposit' },
          { accountId: equityAccountId1, debit: 0.0, credit: 5000.0, description: 'Owner capital' },
        ],
      });

    // 5. Record Revenue Transaction (Date: 2026-07-05)
    // Debit Cash 3000, Credit Consulting Revenue 3000
    await request(app)
      .post('/api/v1/journal-entries')
      .set('Authorization', `Bearer ${accountantToken1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({
        entryNumber: 'JE-RPT-002',
        entryDate: '2026-07-05',
        description: 'Consulting Project Completed',
        status: 'POSTED',
        lines: [
          { accountId: cashAccountId1, debit: 3000.0, credit: 0.0, description: 'Client payment' },
          { accountId: revenueAccountId1, debit: 0.0, credit: 3000.0, description: 'Consulting income' },
        ],
      });

    // 6. Record Expense Transaction (Date: 2026-07-10)
    // Debit Software Expense 1200, Credit Accounts Payable 1200
    await request(app)
      .post('/api/v1/journal-entries')
      .set('Authorization', `Bearer ${accountantToken1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({
        entryNumber: 'JE-RPT-003',
        entryDate: '2026-07-10',
        description: 'SaaS Tool Subscriptions',
        status: 'POSTED',
        lines: [
          { accountId: expenseAccountId1, debit: 1200.0, credit: 0.0, description: 'Subscription expense' },
          { accountId: liabilityAccountId1, debit: 0.0, credit: 1200.0, description: 'Vendor payable' },
        ],
      });

    // 7. Partial Liability Payment (Date: 2026-07-15)
    // Debit Accounts Payable 500, Credit Cash 500
    await request(app)
      .post('/api/v1/journal-entries')
      .set('Authorization', `Bearer ${accountantToken1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({
        entryNumber: 'JE-RPT-004',
        entryDate: '2026-07-15',
        description: 'Partial Bill Payment',
        status: 'POSTED',
        lines: [
          { accountId: liabilityAccountId1, debit: 500.0, credit: 0.0, description: 'Payable payment' },
          { accountId: cashAccountId1, debit: 0.0, credit: 500.0, description: 'Cash disbursement' },
        ],
      });
  }, 60000);

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  describe('1. Security & Middleware Safeguards', () => {
    it('should return 401 Unauthorized when Authorization header is missing', async () => {
      const res = await request(app)
        .get('/api/v1/reports/trial-balance')
        .set('X-Tenant-ID', tenant1Slug);

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Unauthorized');
    });

    it('should return 400 Bad Request when tenant header is missing', async () => {
      const res = await request(app)
        .get('/api/v1/reports/trial-balance')
        .set('Authorization', `Bearer ${viewerToken1}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Missing Tenant Identifier');
    });

    it('should allow Viewer role to query all financial reporting endpoints', async () => {
      const tbRes = await request(app)
        .get('/api/v1/reports/trial-balance')
        .set('Authorization', `Bearer ${viewerToken1}`)
        .set('X-Tenant-ID', tenant1Slug);
      expect(tbRes.status).toBe(200);

      const plRes = await request(app)
        .get('/api/v1/reports/profit-loss')
        .set('Authorization', `Bearer ${viewerToken1}`)
        .set('X-Tenant-ID', tenant1Slug);
      expect(plRes.status).toBe(200);

      const bsRes = await request(app)
        .get('/api/v1/reports/balance-sheet')
        .set('Authorization', `Bearer ${viewerToken1}`)
        .set('X-Tenant-ID', tenant1Slug);
      expect(bsRes.status).toBe(200);
    });
  });

  describe('2. GET /api/v1/reports/trial-balance', () => {
    it('should return Trial Balance report verifying total debits == total credits', async () => {
      const res = await request(app)
        .get('/api/v1/reports/trial-balance')
        .set('Authorization', `Bearer ${viewerToken1}`)
        .set('X-Tenant-ID', tenant1Slug);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.accounts).toBeDefined();
      expect(res.body.data.totals).toBeDefined();

      const { accounts, totals } = res.body.data;
      expect(accounts.length).toBeGreaterThanOrEqual(5);

      // Verify double entry equality
      expect(totals.totalDebit).toBe(TotalsSum(accounts, 'debit'));
      expect(totals.totalCredit).toBe(TotalsSum(accounts, 'credit'));
      expect(totals.totalDebit).toBe(totals.totalCredit);
      expect(totals.isBalanced).toBe(true);

      // Cash Account: +5000 +3000 -500 = 7500 Debit
      const cashAcc = accounts.find((a: any) => a.code === '1010');
      expect(cashAcc.debit).toBe(7500.0);
      expect(cashAcc.credit).toBe(0.0);

      // Consulting Revenue: 3000 Credit
      const revAcc = accounts.find((a: any) => a.code === '4010');
      expect(revAcc.debit).toBe(0.0);
      expect(revAcc.credit).toBe(3000.0);

      // Software Expense: 1200 Debit
      const expAcc = accounts.find((a: any) => a.code === '5010');
      expect(expAcc.debit).toBe(1200.0);
      expect(expAcc.credit).toBe(0.0);

      // Accounts Payable: +1200 Credit - 500 Debit = 700 Credit
      const liabAcc = accounts.find((a: any) => a.code === '2010');
      expect(liabAcc.debit).toBe(0.0);
      expect(liabAcc.credit).toBe(700.0);

      // Owner Capital: 5000 Credit
      const eqAcc = accounts.find((a: any) => a.code === '3010');
      expect(eqAcc.debit).toBe(0.0);
      expect(eqAcc.credit).toBe(5000.0);

      // Total Debits = 7500 + 1200 = 8700
      // Total Credits = 3000 + 700 + 5000 = 8700
      expect(totals.totalDebit).toBe(8700.0);
      expect(totals.totalCredit).toBe(8700.0);
    });

    it('should filter Trial Balance by date range (startDate & endDate)', async () => {
      const res = await request(app)
        .get('/api/v1/reports/trial-balance?startDate=2026-07-04&endDate=2026-07-12')
        .set('Authorization', `Bearer ${viewerToken1}`)
        .set('X-Tenant-ID', tenant1Slug);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const { totals } = res.body.data;
      expect(totals.isBalanced).toBe(true);
      // Entries JE-RPT-002 (3000) and JE-RPT-003 (1200) -> Total Debits 4200 == Total Credits 4200
      expect(totals.totalDebit).toBe(4200.0);
      expect(totals.totalCredit).toBe(4200.0);
    });

    it('should return 400 Bad Request for invalid date query string', async () => {
      const res = await request(app)
        .get('/api/v1/reports/trial-balance?startDate=invalid-date')
        .set('Authorization', `Bearer ${viewerToken1}`)
        .set('X-Tenant-ID', tenant1Slug);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('Invalid startDate format');
    });
  });

  describe('3. GET /api/v1/reports/profit-loss', () => {
    it('should calculate Revenue, Expenses, and Net Profit correctly', async () => {
      const res = await request(app)
        .get('/api/v1/reports/profit-loss')
        .set('Authorization', `Bearer ${viewerToken1}`)
        .set('X-Tenant-ID', tenant1Slug);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.revenues).toBeDefined();
      expect(res.body.data.expenses).toBeDefined();

      const { totalRevenue, totalExpenses, netProfit, isProfit } = res.body.data;
      expect(totalRevenue).toBe(3000.0);
      expect(totalExpenses).toBe(1200.0);
      expect(netProfit).toBe(1800.0); // 3000 - 1200
      expect(isProfit).toBe(true);
    });

    it('should filter Profit & Loss over a date range', async () => {
      const res = await request(app)
        .get('/api/v1/reports/profit-loss?startDate=2026-07-08')
        .set('Authorization', `Bearer ${viewerToken1}`)
        .set('X-Tenant-ID', tenant1Slug);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const { totalRevenue, totalExpenses, netProfit } = res.body.data;
      expect(totalRevenue).toBe(0.0);
      expect(totalExpenses).toBe(1200.0);
      expect(netProfit).toBe(-1200.0);
      expect(res.body.data.isProfit).toBe(false);
    });

    it('should return 400 Bad Request for invalid endDate query string', async () => {
      const res = await request(app)
        .get('/api/v1/reports/profit-loss?endDate=2026-13-45')
        .set('Authorization', `Bearer ${viewerToken1}`)
        .set('X-Tenant-ID', tenant1Slug);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('Invalid endDate format');
    });
  });

  describe('4. GET /api/v1/reports/balance-sheet', () => {
    it('should calculate Assets, Liabilities, Equity, Retained Earnings verifying Assets == Liabilities + Equity', async () => {
      const res = await request(app)
        .get('/api/v1/reports/balance-sheet')
        .set('Authorization', `Bearer ${viewerToken1}`)
        .set('X-Tenant-ID', tenant1Slug);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const {
        totalAssets,
        totalLiabilities,
        totalEquityAccounts,
        retainedEarnings,
        totalEquity,
        totalLiabilitiesAndEquity,
        isBalanced,
      } = res.body.data;

      // Assets: Cash = 7500
      expect(totalAssets).toBe(7500.0);

      // Liabilities: Accounts Payable = 700
      expect(totalLiabilities).toBe(700.0);

      // Equity Accounts: Owner Capital = 5000
      expect(totalEquityAccounts).toBe(5000.0);

      // Retained Earnings: Revenue (3000) - Expense (1200) = 1800
      expect(retainedEarnings).toBe(1800.0);

      // Total Equity: 5000 + 1800 = 6800
      expect(totalEquity).toBe(6800.0);

      // Total Liabilities & Equity: 700 + 6800 = 7500
      expect(totalLiabilitiesAndEquity).toBe(7500.0);

      // Accounting equation check: Assets (7500) == Liabilities & Equity (7500)
      expect(totalAssets).toBe(totalLiabilitiesAndEquity);
      expect(isBalanced).toBe(true);
    });

    it('should support asOfDate filtering on Balance Sheet', async () => {
      // Up to 2026-07-06: Capital 5000, Cash 8000, Revenue 3000, Payable 0, Expense 0
      const res = await request(app)
        .get('/api/v1/reports/balance-sheet?asOfDate=2026-07-06')
        .set('Authorization', `Bearer ${viewerToken1}`)
        .set('X-Tenant-ID', tenant1Slug);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const { totalAssets, totalLiabilities, totalEquity, isBalanced } = res.body.data;
      expect(totalAssets).toBe(8000.0);
      expect(totalLiabilities).toBe(0.0);
      expect(totalEquity).toBe(8000.0); // 5000 capital + 3000 revenue
      expect(isBalanced).toBe(true);
    });
  });

  describe('5. Multi-Tenant Schema Data Isolation', () => {
    it('should maintain strict schema data isolation in financial reports', async () => {
      // Create accounts & transaction in Tenant 2
      const t2Acc1 = await request(app)
        .post('/api/v1/accounts')
        .set('Authorization', `Bearer ${adminToken2}`)
        .set('X-Tenant-ID', tenant2Slug)
        .send({ code: '1010', name: 'T2 Cash', type: 'ASSET' });

      const t2Acc2 = await request(app)
        .post('/api/v1/accounts')
        .set('Authorization', `Bearer ${adminToken2}`)
        .set('X-Tenant-ID', tenant2Slug)
        .send({ code: '4010', name: 'T2 Sales', type: 'REVENUE' });

      await request(app)
        .post('/api/v1/journal-entries')
        .set('Authorization', `Bearer ${adminToken2}`)
        .set('X-Tenant-ID', tenant2Slug)
        .send({
          entryNumber: 'JE-T2-REPORT',
          status: 'POSTED',
          lines: [
            { accountId: t2Acc1.body.data.account.id, debit: 99999.0, credit: 0.0 },
            { accountId: t2Acc2.body.data.account.id, debit: 0.0, credit: 99999.0 },
          ],
        });

      // Tenant 1 trial balance report should not include Tenant 2 totals
      const t1TB = await request(app)
        .get('/api/v1/reports/trial-balance')
        .set('Authorization', `Bearer ${adminToken1}`)
        .set('X-Tenant-ID', tenant1Slug);

      expect(t1TB.status).toBe(200);
      expect(t1TB.body.data.totals.totalDebit).toBe(8700.0);

      // Tenant 1 P&L report should not include Tenant 2 revenue
      const t1PL = await request(app)
        .get('/api/v1/reports/profit-loss')
        .set('Authorization', `Bearer ${adminToken1}`)
        .set('X-Tenant-ID', tenant1Slug);

      expect(t1PL.status).toBe(200);
      expect(t1PL.body.data.totalRevenue).toBe(3000.0);
    });
  });
});

function TotalsSum(accounts: any[], field: 'debit' | 'credit'): number {
  return accounts.reduce((sum, acc) => Math.round((sum + (acc[field] || 0)) * 100) / 100, 0);
}
