import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { generateJwtToken } from '../utils/jwt';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists, createUser } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';

describe('Ledger Accounts & Transaction History API Integration Tests (BE-108)', () => {
  const tenant1Slug = 'ledger-corp-1';
  const tenant1Schema = 'tenant_ledger_corp_1';
  const adminEmail1 = 'admin_lg1@corp1.com';
  const accountantEmail1 = 'accountant_lg1@corp1.com';
  const viewerEmail1 = 'viewer_lg1@corp1.com';

  const tenant2Slug = 'ledger-corp-2';
  const tenant2Schema = 'tenant_ledger_corp_2';
  const adminEmail2 = 'admin_lg2@corp2.com';

  let tenant1Id: string;
  let tenant2Id: string;

  let adminToken1: string;
  let accountantToken1: string;
  let viewerToken1: string;
  let adminToken2: string;

  let cashAccountId1: string;
  let revenueAccountId1: string;
  let expenseAccountId1: string;

  let entry1Id: string;
  let entry2Id: string;

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
      companyName: 'Ledger Corp 1',
      slug: tenant1Slug,
      adminEmail: adminEmail1,
      adminPassword: 'Password123!',
      adminName: 'Ledger Corp 1 Admin',
    });
    tenant1Id = onboard1.tenant.id;
    adminToken1 = onboard1.token;

    // Create Accountant User for Tenant 1
    const accountantUser1 = await createUser(prisma, {
      email: accountantEmail1,
      password: 'Password123!',
      name: 'Ledger Corp 1 Accountant',
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
      name: 'Ledger Corp 1 Viewer',
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
      companyName: 'Ledger Corp 2',
      slug: tenant2Slug,
      adminEmail: adminEmail2,
      adminPassword: 'Password123!',
      adminName: 'Ledger Corp 2 Admin',
    });
    tenant2Id = onboard2.tenant.id;
    adminToken2 = onboard2.token;

    // 3. Set up Accounts for Tenant 1
    const cashAcc = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${accountantToken1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ code: '1010', name: 'Cash Account', type: 'ASSET' });
    cashAccountId1 = cashAcc.body.data.account.id;

    const revAcc = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${accountantToken1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ code: '4010', name: 'Sales Revenue', type: 'REVENUE' });
    revenueAccountId1 = revAcc.body.data.account.id;

    const expAcc = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${accountantToken1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ code: '5010', name: 'Office Supplies Expense', type: 'EXPENSE' });
    expenseAccountId1 = expAcc.body.data.account.id;

    // 4. Create and Post Journal Entry 1 (Date: 2026-07-01)
    const res1 = await request(app)
      .post('/api/v1/journal-entries')
      .set('Authorization', `Bearer ${accountantToken1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({
        entryNumber: 'JE-LG-001',
        entryDate: '2026-07-01',
        description: 'Customer Payment Received',
        status: 'POSTED',
        lines: [
          { accountId: cashAccountId1, debit: 1000.0, credit: 0.0, description: 'Cash deposit' },
          { accountId: revenueAccountId1, debit: 0.0, credit: 1000.0, description: 'Sales income' },
        ],
      });
    entry1Id = res1.body.data.journalEntry.id;

    // 5. Create and Post Journal Entry 2 (Date: 2026-07-15)
    const res2 = await request(app)
      .post('/api/v1/journal-entries')
      .set('Authorization', `Bearer ${accountantToken1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({
        entryNumber: 'JE-LG-002',
        entryDate: '2026-07-15',
        description: 'Office Supplies Purchase',
        status: 'POSTED',
        lines: [
          { accountId: expenseAccountId1, debit: 250.0, credit: 0.0, description: 'Stationery expense' },
          { accountId: cashAccountId1, debit: 0.0, credit: 250.0, description: 'Cash withdrawal' },
        ],
      });
    entry2Id = res2.body.data.journalEntry.id;
  }, 30000);

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  describe('1. Authentication & Middleware Safeguards', () => {
    it('should return 401 Unauthorized when Authorization header is missing', async () => {
      const res = await request(app)
        .get('/api/v1/ledgers')
        .set('X-Tenant-ID', tenant1Slug);

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Unauthorized');
    });

    it('should return 400 Bad Request when tenant context header is missing', async () => {
      const res = await request(app)
        .get('/api/v1/ledgers')
        .set('Authorization', `Bearer ${viewerToken1}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Missing Tenant Identifier');
    });

    it('should allow Viewer role to query ledgers API', async () => {
      const res = await request(app)
        .get('/api/v1/ledgers')
        .set('Authorization', `Bearer ${viewerToken1}`)
        .set('X-Tenant-ID', tenant1Slug);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('2. GET /api/v1/ledgers - List Ledger Transactions', () => {
    it('should return list of all posted ledger transactions', async () => {
      const res = await request(app)
        .get('/api/v1/ledgers')
        .set('Authorization', `Bearer ${viewerToken1}`)
        .set('X-Tenant-ID', tenant1Slug);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.transactions).toBeDefined();
      expect(Array.isArray(res.body.data.transactions)).toBe(true);
      expect(res.body.data.transactions.length).toBe(4); // 2 lines per entry x 2 entries
      expect(res.body.data.pagination).toBeDefined();
      expect(res.body.data.pagination.total).toBe(4);
    });

    it('should filter transactions by accountId', async () => {
      const res = await request(app)
        .get(`/api/v1/ledgers?accountId=${cashAccountId1}`)
        .set('Authorization', `Bearer ${viewerToken1}`)
        .set('X-Tenant-ID', tenant1Slug);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.transactions.length).toBe(2);
      expect(res.body.data.transactions.every((tx: any) => tx.accountId === cashAccountId1)).toBe(true);
    });

    it('should filter transactions by date range (startDate & endDate)', async () => {
      const res = await request(app)
        .get('/api/v1/ledgers?startDate=2026-07-10&endDate=2026-07-20')
        .set('Authorization', `Bearer ${viewerToken1}`)
        .set('X-Tenant-ID', tenant1Slug);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.transactions.length).toBe(2); // Only JE-LG-002 on 2026-07-15
      expect(res.body.data.transactions.every((tx: any) => tx.entryNumber === 'JE-LG-002')).toBe(true);
    });

    it('should search transactions by description or entry number', async () => {
      const res = await request(app)
        .get('/api/v1/ledgers?search=Stationery')
        .set('Authorization', `Bearer ${viewerToken1}`)
        .set('X-Tenant-ID', tenant1Slug);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.transactions.length).toBe(1);
      expect(res.body.data.transactions[0].description).toBe('Stationery expense');
    });

    it('should handle pagination parameters correctly', async () => {
      const res = await request(app)
        .get('/api/v1/ledgers?page=1&limit=2')
        .set('Authorization', `Bearer ${viewerToken1}`)
        .set('X-Tenant-ID', tenant1Slug);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.transactions.length).toBe(2);
      expect(res.body.data.pagination.page).toBe(1);
      expect(res.body.data.pagination.limit).toBe(2);
      expect(res.body.data.pagination.total).toBe(4);
      expect(res.body.data.pagination.totalPages).toBe(2);
    });

    it('should return 400 for invalid date format in filter', async () => {
      const res = await request(app)
        .get('/api/v1/ledgers?startDate=invalid-date')
        .set('Authorization', `Bearer ${viewerToken1}`)
        .set('X-Tenant-ID', tenant1Slug);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('Invalid startDate format');
    });
  });

  describe('3. GET /api/v1/ledgers/accounts/:accountId - Account Ledger Statement', () => {
    it('should return full statement for Cash account with running balance', async () => {
      const res = await request(app)
        .get(`/api/v1/ledgers/accounts/${cashAccountId1}`)
        .set('Authorization', `Bearer ${viewerToken1}`)
        .set('X-Tenant-ID', tenant1Slug);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.account).toBeDefined();
      expect(res.body.data.account.code).toBe('1010');
      expect(res.body.data.account.name).toBe('Cash Account');

      const statement = res.body.data.statement;
      expect(statement.openingBalance).toBe(0.0);
      expect(statement.totalDebit).toBe(1000.0);
      expect(statement.totalCredit).toBe(250.0);
      expect(statement.netChange).toBe(750.0);
      expect(statement.closingBalance).toBe(750.0);
      expect(statement.transactions.length).toBe(2);

      // Verify running balances in chronological order
      expect(statement.transactions[0].debit).toBe(1000.0);
      expect(statement.transactions[0].runningBalance).toBe(1000.0);
      expect(statement.transactions[1].credit).toBe(250.0);
      expect(statement.transactions[1].runningBalance).toBe(750.0);
    });

    it('should calculate opening balance correctly when startDate is provided', async () => {
      const res = await request(app)
        .get(`/api/v1/ledgers/accounts/${cashAccountId1}?startDate=2026-07-10`)
        .set('Authorization', `Bearer ${viewerToken1}`)
        .set('X-Tenant-ID', tenant1Slug);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const statement = res.body.data.statement;
      expect(statement.startDate).toBe('2026-07-10');
      expect(statement.openingBalance).toBe(1000.0); // Transaction 1 on 2026-07-01 contributes 1000
      expect(statement.totalDebit).toBe(0.0);
      expect(statement.totalCredit).toBe(250.0);
      expect(statement.netChange).toBe(-250.0);
      expect(statement.closingBalance).toBe(750.0);
      expect(statement.transactions.length).toBe(1);
      expect(statement.transactions[0].runningBalance).toBe(750.0);
    });

    it('should return 404 Not Found for non-existent account ID', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000099';
      const res = await request(app)
        .get(`/api/v1/ledgers/accounts/${fakeId}`)
        .set('Authorization', `Bearer ${viewerToken1}`)
        .set('X-Tenant-ID', tenant1Slug);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('not found');
    });
  });

  describe('4. GET /api/v1/ledgers/summary - General Ledger Summary', () => {
    it('should return GL summary across Chart of Accounts', async () => {
      const res = await request(app)
        .get('/api/v1/ledgers/summary')
        .set('Authorization', `Bearer ${viewerToken1}`)
        .set('X-Tenant-ID', tenant1Slug);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.accounts).toBeDefined();
      expect(res.body.data.totals).toBeDefined();

      const accounts = res.body.data.accounts;
      expect(accounts.length).toBeGreaterThanOrEqual(3);

      const cashAcc = accounts.find((a: any) => a.code === '1010');
      expect(cashAcc).toBeDefined();
      expect(cashAcc.totalDebit).toBe(1000.0);
      expect(cashAcc.totalCredit).toBe(250.0);
      expect(cashAcc.closingBalance).toBe(750.0);

      const revAcc = accounts.find((a: any) => a.code === '4010');
      expect(revAcc).toBeDefined();
      expect(revAcc.totalDebit).toBe(0.0);
      expect(revAcc.totalCredit).toBe(1000.0);
      expect(revAcc.closingBalance).toBe(-1000.0);

      const expAcc = accounts.find((a: any) => a.code === '5010');
      expect(expAcc).toBeDefined();
      expect(expAcc.totalDebit).toBe(250.0);
      expect(expAcc.totalCredit).toBe(0.0);
      expect(expAcc.closingBalance).toBe(250.0);

      // Verify grand totals equal double-entry debits and credits
      expect(res.body.data.totals.totalDebit).toBe(1250.0);
      expect(res.body.data.totals.totalCredit).toBe(1250.0);
    });

    it('should filter GL summary by startDate and calculate opening balances', async () => {
      const res = await request(app)
        .get('/api/v1/ledgers/summary?startDate=2026-07-10')
        .set('Authorization', `Bearer ${viewerToken1}`)
        .set('X-Tenant-ID', tenant1Slug);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const cashAcc = res.body.data.accounts.find((a: any) => a.code === '1010');
      expect(cashAcc.openingBalance).toBe(1000.0);
      expect(cashAcc.totalDebit).toBe(0.0);
      expect(cashAcc.totalCredit).toBe(250.0);
      expect(cashAcc.closingBalance).toBe(750.0);

      expect(res.body.data.totals.totalDebit).toBe(250.0);
      expect(res.body.data.totals.totalCredit).toBe(250.0);
    });
  });

  describe('5. Multi-Tenant Schema Data Isolation', () => {
    it('should isolate ledger data between tenant schemas', async () => {
      // Create Account & Entry in Tenant 2
      const t2Acc1 = await request(app)
        .post('/api/v1/accounts')
        .set('Authorization', `Bearer ${adminToken2}`)
        .set('X-Tenant-ID', tenant2Slug)
        .send({ code: '1010', name: 'T2 Cash', type: 'ASSET' });

      const t2Acc2 = await request(app)
        .post('/api/v1/accounts')
        .set('Authorization', `Bearer ${adminToken2}`)
        .set('X-Tenant-ID', tenant2Slug)
        .send({ code: '4010', name: 'T2 Revenue', type: 'REVENUE' });

      await request(app)
        .post('/api/v1/journal-entries')
        .set('Authorization', `Bearer ${adminToken2}`)
        .set('X-Tenant-ID', tenant2Slug)
        .send({
          entryNumber: 'JE-T2-LEDGER',
          status: 'POSTED',
          lines: [
            { accountId: t2Acc1.body.data.account.id, debit: 9999.0, credit: 0.0 },
            { accountId: t2Acc2.body.data.account.id, debit: 0.0, credit: 9999.0 },
          ],
        });

      // Tenant 1 ledger query should not return Tenant 2 data
      const t1Ledgers = await request(app)
        .get('/api/v1/ledgers')
        .set('Authorization', `Bearer ${adminToken1}`)
        .set('X-Tenant-ID', tenant1Slug);

      expect(t1Ledgers.status).toBe(200);
      expect(t1Ledgers.body.data.transactions.every((tx: any) => tx.entryNumber !== 'JE-T2-LEDGER')).toBe(true);

      // Tenant 1 summary totals should not include 9999
      const t1Summary = await request(app)
        .get('/api/v1/ledgers/summary')
        .set('Authorization', `Bearer ${adminToken1}`)
        .set('X-Tenant-ID', tenant1Slug);

      expect(t1Summary.body.data.totals.totalDebit).toBe(1250.0);
    });
  });
});
