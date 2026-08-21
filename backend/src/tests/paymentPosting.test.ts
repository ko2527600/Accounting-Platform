import { deleteAuditLogs } from './testHelpers';
import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';

/**
 * Regression test for a critical bug found on 2026-07-25: invoices.ts,
 * bills.ts, and aiCategorization.ts all fetched the tenant's Chart of
 * Accounts via `(client as any).account.findMany()` - a Prisma-typed call
 * that always schema-qualifies to `public.accounts` (always empty, since
 * real accounts live only in each tenant's own Postgres schema, written via
 * accountRepository.ts's raw SQL). This meant the account list was always
 * `[]`, so invoice/bill payment never actually posted a journal entry
 * (despite the API claiming success), and AI categorization always
 * returned `suggestion: null`.
 */
describe('Payment posting & AI categorization - real Chart of Accounts lookup', () => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tenantSlug = `pay-post-corp-${runId}`;
  const tenantSchema = `tenant_pay_post_corp_${runId}`;
  const adminEmail = `admin_paypost_${runId}@corp.com`;

  let adminToken: string;
  let tenantId: string;
  let cashAccountId: string;
  let revenueAccountId: string;
  let expenseAccountId: string;
  let customerId: string;
  let vendorId: string;

  async function cleanupTestData() {
    if (tenantId) {
      await deleteAuditLogs(prisma, { tenantId });
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
      companyName: 'Payment Posting Corp',
      slug: tenantSlug,
      adminEmail,
      adminPassword: 'Password123!',
      adminName: 'Payment Posting Corp Admin',
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
      .send({ code: '4010', name: 'Consulting Revenue', type: 'REVENUE' });
    revenueAccountId = revenueAcc.body.data.account.id;

    const expenseAcc = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ code: '5010', name: 'Office Rent Expense', type: 'EXPENSE' });
    expenseAccountId = expenseAcc.body.data.account.id;

    const customer = await request(app)
      .post('/api/v1/invoices/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ name: 'Acme Customer', email: 'customer@acme.test' });
    customerId = customer.body.data.customer.id;

    const vendor = await request(app)
      .post('/api/v1/bills/vendors')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ name: 'Acme Vendor', email: 'vendor@acme.test' });
    vendorId = vendor.body.data.vendor.id;
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it('posts a real journal entry (Cash debit / Revenue credit) when an invoice is paid', async () => {
    const invoice = await request(app)
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ customerId, items: [{ description: 'Consulting Work', quantity: 1, unitPrice: 100 }] });
    expect(invoice.status).toBe(201);
    const invoiceId = invoice.body.data.invoice.id;
    const expectedTotal = Number(invoice.body.data.invoice.total); // 100 + 10% tax = 110

    const payRes = await request(app)
      .post(`/api/v1/invoices/${invoiceId}/pay`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({});

    expect(payRes.status).toBe(200);
    const journalId = payRes.body.data.invoice.journalId;
    expect(journalId).toBeTruthy();

    const journalRes = await request(app)
      .get(`/api/v1/journal-entries/${journalId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);

    expect(journalRes.status).toBe(200);
    const journalEntry = journalRes.body.data.journalEntry;
    expect(journalEntry.status).toBe('POSTED');
    expect(journalEntry.lines.length).toBe(2);

    const cashLine = journalEntry.lines.find((l: any) => l.accountId === cashAccountId);
    const revenueLine = journalEntry.lines.find((l: any) => l.accountId === revenueAccountId);
    expect(cashLine.debit).toBe(expectedTotal);
    expect(revenueLine.credit).toBe(expectedTotal);

    const auditRows = await prisma.auditLog.findMany({
      where: { tenantId, entity: 'Invoice', entityId: invoiceId, action: 'INVOICE.PAID' },
    });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].changes).toMatchObject({ status: { from: 'SENT', to: 'PAID' } });
  });

  it('posts a real journal entry (Expense debit / Cash credit) when a vendor bill is paid', async () => {
    const bill = await request(app)
      .post('/api/v1/bills')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ vendorId, dueDate: new Date(Date.now() + 86400000).toISOString(), amount: 75 });
    expect(bill.status).toBe(201);
    const billId = bill.body.data.bill.id;

    const payRes = await request(app)
      .post(`/api/v1/bills/${billId}/pay`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({});

    expect(payRes.status).toBe(200);
    const journalId = payRes.body.data.bill.journalId;
    expect(journalId).toBeTruthy();

    const journalRes = await request(app)
      .get(`/api/v1/journal-entries/${journalId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);

    expect(journalRes.status).toBe(200);
    const journalEntry = journalRes.body.data.journalEntry;
    expect(journalEntry.status).toBe('POSTED');
    expect(journalEntry.lines.length).toBe(2);

    const expenseLine = journalEntry.lines.find((l: any) => l.accountId === expenseAccountId);
    const cashLine = journalEntry.lines.find((l: any) => l.accountId === cashAccountId);
    expect(expenseLine.debit).toBe(75);
    expect(cashLine.credit).toBe(75);

    const auditRows = await prisma.auditLog.findMany({
      where: { tenantId, entity: 'VendorBill', entityId: billId, action: 'VENDOR_BILL.PAID' },
    });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].changes).toMatchObject({ status: { from: 'UNPAID', to: 'PAID' } });
  });

  describe('Fund accounting - posted lines carry the invoice/bill fundId', () => {
    let fundId: string;

    beforeAll(async () => {
      const fund = await request(app)
        .post('/api/v1/funds')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({ name: 'Payment Posting Fund', code: `PAYFUND-${Date.now()}` });
      fundId = fund.body.data.fund.id;
    });

    it('posts every line (Cash + Revenue) with the invoice\'s fundId when a fund-tagged invoice is paid', async () => {
      const invoice = await request(app)
        .post('/api/v1/invoices')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({ customerId, fundId, items: [{ description: 'Restricted Grant Work', quantity: 1, unitPrice: 200 }] });
      expect(invoice.status).toBe(201);
      expect(invoice.body.data.invoice.fundId).toBe(fundId);
      const invoiceId = invoice.body.data.invoice.id;

      const payRes = await request(app)
        .post(`/api/v1/invoices/${invoiceId}/pay`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({});
      expect(payRes.status).toBe(200);

      const journalRes = await request(app)
        .get(`/api/v1/journal-entries/${payRes.body.data.invoice.journalId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug);
      const lines = journalRes.body.data.journalEntry.lines;
      expect(lines.length).toBeGreaterThanOrEqual(2);
      expect(lines.every((l: any) => l.fundId === fundId)).toBe(true);
    });

    it('posts every line (Expense + Cash) with the bill\'s fundId when a fund-tagged vendor bill is paid', async () => {
      const bill = await request(app)
        .post('/api/v1/bills')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({ vendorId, dueDate: new Date(Date.now() + 86400000).toISOString(), amount: 40, fundId });
      expect(bill.status).toBe(201);
      expect(bill.body.data.bill.fundId).toBe(fundId);
      const billId = bill.body.data.bill.id;

      const payRes = await request(app)
        .post(`/api/v1/bills/${billId}/pay`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({});
      expect(payRes.status).toBe(200);

      const journalRes = await request(app)
        .get(`/api/v1/journal-entries/${payRes.body.data.bill.journalId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug);
      const lines = journalRes.body.data.journalEntry.lines;
      expect(lines.length).toBe(2);
      expect(lines.every((l: any) => l.fundId === fundId)).toBe(true);
    });
  });

  it('suggests a real account for AI categorization based on the tenant\'s own Chart of Accounts', async () => {
    const res = await request(app)
      .post('/api/v1/ai/categorize')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ description: 'Monthly office rent payment' });

    expect(res.status).toBe(200);
    expect(res.body.data.suggestion).not.toBeNull();
    expect(res.body.data.suggestion.accountId).toBe(expenseAccountId);
  });

  describe('Per-levy tax account posting (accountant-requested: tax should not post to Revenue)', () => {
    async function createAccount(code: string, name: string) {
      const res = await request(app)
        .post('/api/v1/accounts')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({ code, name, type: 'LIABILITY' });
      return res.body.data.account.id as string;
    }

    async function createLayeredTaxRate(code: string, components: { name: string; rate: number; accountId?: string }[]) {
      const res = await request(app)
        .post('/api/v1/tax-rates')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({
          name: `Layered ${code}`,
          code,
          rate: components.reduce((sum, c) => sum + c.rate, 0),
          effectiveFrom: '2020-01-01',
          components,
        });
      expect(res.status).toBe(201);
      return res.body.data.taxRate;
    }

    async function payAndGetJournal(invoiceId: string) {
      const payRes = await request(app)
        .post(`/api/v1/invoices/${invoiceId}/pay`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({});
      expect(payRes.status).toBe(200);
      const journalId = payRes.body.data.invoice.journalId;
      expect(journalId).toBeTruthy();

      const journalRes = await request(app)
        .get(`/api/v1/journal-entries/${journalId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug);
      expect(journalRes.status).toBe(200);
      return journalRes.body.data.journalEntry;
    }

    it('splits collected tax across each levy\'s own account instead of crediting it all to Revenue', async () => {
      const vatAccountId = await createAccount('2201', 'VAT Payable');
      const nhilAccountId = await createAccount('2202', 'NHIL Payable');
      const getfundAccountId = await createAccount('2203', 'GETFund Payable');

      const taxRate = await createLayeredTaxRate('GH-PAY-1', [
        { name: 'VAT', rate: 0.15, accountId: vatAccountId },
        { name: 'NHIL', rate: 0.025, accountId: nhilAccountId },
        { name: 'GETFund Levy', rate: 0.025, accountId: getfundAccountId },
      ]);

      const invoice = await request(app)
        .post('/api/v1/invoices')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({ customerId, taxRateId: taxRate.id, items: [{ description: 'Per-levy test', quantity: 1, unitPrice: 1000 }] });
      expect(invoice.status).toBe(201);
      expect(Number(invoice.body.data.invoice.total)).toBeCloseTo(1200, 2);

      const journalEntry = await payAndGetJournal(invoice.body.data.invoice.id);
      expect(journalEntry.lines.length).toBe(5); // Cash + VAT + NHIL + GETFund + Revenue

      const cashLine = journalEntry.lines.find((l: any) => l.accountId === cashAccountId);
      const vatLine = journalEntry.lines.find((l: any) => l.accountId === vatAccountId);
      const nhilLine = journalEntry.lines.find((l: any) => l.accountId === nhilAccountId);
      const getfundLine = journalEntry.lines.find((l: any) => l.accountId === getfundAccountId);
      const revenueLine = journalEntry.lines.find((l: any) => l.accountId === revenueAccountId);

      expect(cashLine.debit).toBe(1200);
      expect(vatLine.credit).toBe(150);
      expect(nhilLine.credit).toBe(25);
      expect(getfundLine.credit).toBe(25);
      // Revenue only reflects the subtotal - not the full invoice total.
      expect(revenueLine.credit).toBe(1000);

      const totalCredits = journalEntry.lines.reduce((sum: number, l: any) => sum + Number(l.credit), 0);
      expect(totalCredits).toBe(1200);
    });

    it('folds any levy without a configured destination account into Revenue, alongside the subtotal', async () => {
      const vatAccountId = await createAccount('2204', 'VAT Payable (Mixed)');

      const taxRate = await createLayeredTaxRate('GH-PAY-2', [
        { name: 'VAT', rate: 0.15, accountId: vatAccountId },
        { name: 'NHIL', rate: 0.025 },
        { name: 'GETFund Levy', rate: 0.025 },
      ]);

      const invoice = await request(app)
        .post('/api/v1/invoices')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({ customerId, taxRateId: taxRate.id, items: [{ description: 'Mixed levy test', quantity: 1, unitPrice: 1000 }] });
      expect(invoice.status).toBe(201);

      const journalEntry = await payAndGetJournal(invoice.body.data.invoice.id);
      expect(journalEntry.lines.length).toBe(3); // Cash + VAT + Revenue (NHIL/GETFund folded in)

      const vatLine = journalEntry.lines.find((l: any) => l.accountId === vatAccountId);
      const revenueLine = journalEntry.lines.find((l: any) => l.accountId === revenueAccountId);
      expect(vatLine.credit).toBe(150);
      // Revenue absorbs subtotal (1000) + the two unrouted levies (25 + 25).
      expect(revenueLine.credit).toBe(1050);
    });

    it('falls back to Revenue for a levy whose destination account was deleted after the invoice was created, without blocking payment', async () => {
      const vatAccountId = await createAccount('2205', 'VAT Payable (To Be Deleted)');
      const taxRate = await createLayeredTaxRate('GH-PAY-3', [{ name: 'VAT', rate: 0.15, accountId: vatAccountId }]);

      const invoice = await request(app)
        .post('/api/v1/invoices')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({ customerId, taxRateId: taxRate.id, items: [{ description: 'Deleted account test', quantity: 1, unitPrice: 1000 }] });
      expect(invoice.status).toBe(201);
      expect(Number(invoice.body.data.invoice.total)).toBeCloseTo(1150, 2);

      const deleteRes = await request(app)
        .delete(`/api/v1/accounts/${vatAccountId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug);
      expect(deleteRes.status).toBe(200);

      const journalEntry = await payAndGetJournal(invoice.body.data.invoice.id);
      expect(journalEntry.lines.length).toBe(2); // Cash + Revenue only - stale account silently skipped

      const cashLine = journalEntry.lines.find((l: any) => l.accountId === cashAccountId);
      const revenueLine = journalEntry.lines.find((l: any) => l.accountId === revenueAccountId);
      expect(cashLine.debit).toBe(1150);
      expect(revenueLine.credit).toBe(1150);
    });
  });
});
