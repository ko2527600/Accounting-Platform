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
  const runId = Date.now();
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
});
