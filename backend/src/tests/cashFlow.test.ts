import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';

/** Same hex-token extraction as pdfGenerationService.test.ts/reportExports.test.ts. */
function extractDrawnText(buffer: Buffer): string {
  const raw = buffer.toString('latin1');
  const hexTokens = raw.match(/<[0-9a-fA-F]+>/g) || [];
  return hexTokens.map((token) => Buffer.from(token.slice(1, -1), 'hex').toString('latin1')).join('');
}

function binary(req: request.Test): request.Test {
  return req.buffer(true).parse((res: any, callback: any) => {
    const chunks: Buffer[] = [];
    res.on('data', (chunk: Buffer) => chunks.push(chunk));
    res.on('end', () => callback(null, Buffer.concat(chunks)));
  });
}

describe('Cash Flow Statement (indirect method)', () => {
  const runId = Date.now();
  const tenantSlug = `cashflow-corp-${runId}`;
  const tenantSchema = `tenant_cashflow_corp_${runId}`;
  const adminEmail = `admin_cashflow_${runId}@corp.com`;

  let adminToken: string;
  let tenantId: string;
  let cashAccountId: string;
  let revenueAccountId: string;
  let expenseAccountId: string;
  let liabilityAccountId: string;
  let equityAccountId: string;

  async function cleanupTestData() {
    if (tenantId) {
      await prisma.auditLog.deleteMany({ where: { tenantId } }).catch(() => {});
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
      companyName: 'Cash Flow Corp',
      slug: tenantSlug,
      adminEmail,
      adminPassword: 'Password123!',
      adminName: 'Cash Flow Admin',
    });
    adminToken = onboard.token;
    tenantId = onboard.tenant.id;

    // Name contains "Cash" - should be auto-flagged is_cash_equivalent by the
    // '004_add_cash_equivalent_flag' backfill/default heuristic, no manual flag needed.
    const cashAcc = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ code: '1010', name: 'Cash & Bank', type: 'ASSET' });
    cashAccountId = cashAcc.body.data.account.id;
    expect(cashAcc.body.data.account.isCashEquivalent).toBe(true);

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
        entryNumber: `JE-CF-${runId}-001`,
        entryDate: '2026-07-01',
        description: 'Initial Capital Injection',
        status: 'POSTED',
        lines: [
          { accountId: cashAccountId, debit: 5000, credit: 0 },
          { accountId: equityAccountId, debit: 0, credit: 5000 },
        ],
      });

    // Consulting revenue of 3000 paid in cash
    await request(app)
      .post('/api/v1/journal-entries')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({
        entryNumber: `JE-CF-${runId}-002`,
        entryDate: '2026-07-05',
        description: 'Consulting Project Completed',
        status: 'POSTED',
        lines: [
          { accountId: cashAccountId, debit: 3000, credit: 0 },
          { accountId: revenueAccountId, debit: 0, credit: 3000 },
        ],
      });

    // Software expense of 1200 on credit (accounts payable)
    await request(app)
      .post('/api/v1/journal-entries')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({
        entryNumber: `JE-CF-${runId}-003`,
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
        entryNumber: `JE-CF-${runId}-004`,
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

  describe('GET /api/v1/reports/cash-flow', () => {
    it('requires authentication', async () => {
      const res = await request(app).get('/api/v1/reports/cash-flow').set('X-Tenant-ID', tenantSlug);
      expect(res.status).toBe(401);
    });

    it('computes a correct indirect-method statement that reconciles with actual cash', async () => {
      const res = await request(app)
        .get('/api/v1/reports/cash-flow')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const data = res.body.data;

      // Net Income = 3000 revenue - 1200 expense = 1800
      expect(data.netIncome).toBe(1800);

      // Accounts Payable increased by 1200 - 500 = 700, a source of cash.
      const apLine = data.operatingAdjustments.find((a: any) => a.id === liabilityAccountId);
      expect(apLine).toBeDefined();
      expect(apLine.change).toBe(700);

      // Net Cash from Operating = Net Income (1800) + AP increase (700) = 2500
      expect(data.netCashFromOperating).toBe(2500);

      // Owner Capital contribution of 5000 is the only financing activity.
      const equityLine = data.financingAdjustments.find((a: any) => a.id === equityAccountId);
      expect(equityLine).toBeDefined();
      expect(equityLine.change).toBe(5000);
      expect(data.netCashFromFinancing).toBe(5000);

      // Net Change in Cash = 2500 + 5000 = 7500
      expect(data.netChangeInCash).toBe(7500);

      // No startDate was given, so beginning cash is 0 (since inception).
      expect(data.beginningCash).toBe(0);

      // Actual cash account balance: 5000 + 3000 - 500 = 7500.
      expect(data.endingCash).toBe(7500);

      // Double-entry bookkeeping guarantees these always reconcile.
      expect(data.cashTies).toBe(true);

      // The cash account itself must not appear as an "operating adjustment" -
      // it's the thing being measured, not a change feeding into the measurement.
      expect(data.operatingAdjustments.find((a: any) => a.id === cashAccountId)).toBeUndefined();
      expect(data.cashAccounts.find((a: any) => a.id === cashAccountId)?.balance).toBe(7500);
    });

    it('scopes to a date range when startDate/endDate are provided', async () => {
      const res = await request(app)
        .get('/api/v1/reports/cash-flow?startDate=2026-07-01&endDate=2026-07-05')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug);

      expect(res.status).toBe(200);
      const data = res.body.data;
      // Only the two July 1 and July 5 entries fall in range: +5000 capital, +3000 revenue.
      expect(data.netIncome).toBe(3000);
      expect(data.netCashFromFinancing).toBe(5000);
      expect(data.beginningCash).toBe(0);
      expect(data.endingCash).toBe(8000);
      expect(data.cashTies).toBe(true);
    });

    it('rejects a malformed date', async () => {
      const res = await request(app)
        .get('/api/v1/reports/cash-flow?startDate=not-a-date')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug);
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/v1/reports/cash-flow/export', () => {
    it('returns a real PDF with the real seeded account names', async () => {
      const res = await binary(
        request(app)
          .get('/api/v1/reports/cash-flow/export?format=pdf')
          .set('Authorization', `Bearer ${adminToken}`)
          .set('X-Tenant-ID', tenantSlug)
      );
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/pdf');
      const buffer = res.body as Buffer;
      expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
      expect(buffer.length).toBeGreaterThan(1000);
      const text = extractDrawnText(buffer);
      expect(text).toContain('Cash Flow Statement');
      expect(text).toContain('Accounts Payable');
      expect(text).toContain('Owner Capital');
    });

    it('returns a real Word (.docx) document', async () => {
      const res = await binary(
        request(app)
          .get('/api/v1/reports/cash-flow/export?format=docx')
          .set('Authorization', `Bearer ${adminToken}`)
          .set('X-Tenant-ID', tenantSlug)
      );
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('wordprocessingml.document');
      const buffer = res.body as Buffer;
      expect(buffer.subarray(0, 2).toString('ascii')).toBe('PK');
      expect(buffer.length).toBeGreaterThan(1000);
    });

    it('rejects an unrecognized format', async () => {
      const res = await request(app)
        .get('/api/v1/reports/cash-flow/export?format=xlsx')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug);
      expect(res.status).toBe(400);
    });
  });

  describe('Account creation: isCashEquivalent flag', () => {
    it('does not auto-flag a non-cash-named asset account', async () => {
      const res = await request(app)
        .post('/api/v1/accounts')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({ code: '1500', name: 'Office Equipment', type: 'ASSET' });
      expect(res.status).toBe(201);
      expect(res.body.data.account.isCashEquivalent).toBe(false);
    });

    it('allows an explicit override regardless of name', async () => {
      const res = await request(app)
        .post('/api/v1/accounts')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({ code: '1600', name: 'Mobile Money Wallet', type: 'ASSET', isCashEquivalent: true });
      expect(res.status).toBe(201);
      expect(res.body.data.account.isCashEquivalent).toBe(true);
    });
  });
});
