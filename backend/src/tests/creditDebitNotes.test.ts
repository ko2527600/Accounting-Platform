import { deleteAuditLogs } from './testHelpers';
import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';

describe('Credit Notes (AR) and Debit Notes (AP)', () => {
  const runId = Date.now();
  const tenantSlug = `notes-corp-${runId}`;
  const tenantSchema = `tenant_notes_corp_${runId}`;
  const adminEmail = `admin_notes_${runId}@corp.com`;

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

  async function createInvoice(amount: number) {
    const res = await request(app)
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ customerId, items: [{ description: 'Consulting', quantity: 1, unitPrice: amount }] });
    expect(res.status).toBe(201);
    return res.body.data.invoice;
  }

  async function payInvoice(id: string) {
    const res = await request(app)
      .post(`/api/v1/invoices/${id}/pay`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);
    expect(res.status).toBe(200);
    return res.body.data.invoice;
  }

  async function createBill(amount: number) {
    const res = await request(app)
      .post('/api/v1/bills')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ vendorId, amount, dueDate: '2026-09-01' });
    expect(res.status).toBe(201);
    return res.body.data.bill;
  }

  async function payBill(id: string) {
    const res = await request(app)
      .post(`/api/v1/bills/${id}/pay`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);
    expect(res.status).toBe(200);
    return res.body.data.bill;
  }

  beforeAll(async () => {
    await prisma.$connect();
    await ensureTenantTableExists(prisma);
    await ensureUserTableExists(prisma);
    await cleanupTestData();

    const onboard = await onboardTenant(prisma, {
      companyName: 'Notes Corp',
      slug: tenantSlug,
      adminEmail,
      adminPassword: 'Password123!',
      adminName: 'Notes Admin',
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
      .send({ code: '4010', name: 'Sales Revenue', type: 'REVENUE' });
    revenueAccountId = revAcc.body.data.account.id;

    const expAcc = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ code: '5010', name: 'Supplies Expense', type: 'EXPENSE' });
    expenseAccountId = expAcc.body.data.account.id;

    const customer = await request(app)
      .post('/api/v1/invoices/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ name: 'Acme Client', email: `acme_${runId}@client.com` });
    customerId = customer.body.data.customer.id;

    const vendor = await request(app)
      .post('/api/v1/bills/vendors')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ name: 'Acme Supplier', email: `acmesupplier_${runId}@vendor.com` });
    vendorId = vendor.body.data.vendor.id;
  }, 120000);

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  describe('POST /api/v1/invoices/:id/credit-notes', () => {
    it('reduces the invoice total with no journal entry when the invoice is unpaid', async () => {
      const invoice = await createInvoice(1000);
      const res = await request(app)
        .post(`/api/v1/invoices/${invoice.id}/credit-notes`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({ amount: 200, reason: 'Customer returned one unit' });

      expect(res.status).toBe(201);
      expect(res.body.data.creditNote.method).toBe('INVOICE_REDUCTION');
      expect(res.body.data.creditNote.journalId).toBeNull();

      const list = await request(app)
        .get('/api/v1/invoices')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug);
      const updated = list.body.data.invoices.find((i: any) => i.id === invoice.id);
      expect(Number(updated.total)).toBe(800);
    });

    it('posts a real reversing journal entry and leaves the invoice total untouched when already paid', async () => {
      const invoice = await createInvoice(1000);
      await payInvoice(invoice.id);

      const beforeLedger = await request(app)
        .get('/api/v1/ledgers/summary')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug);
      const cashBefore = beforeLedger.body.data.accounts.find((a: any) => a.id === cashAccountId).closingBalance;
      const revenueBefore = beforeLedger.body.data.accounts.find((a: any) => a.id === revenueAccountId).closingBalance;

      const res = await request(app)
        .post(`/api/v1/invoices/${invoice.id}/credit-notes`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({ amount: 300, reason: 'Overcharged customer' });

      expect(res.status).toBe(201);
      expect(res.body.data.creditNote.method).toBe('JOURNAL_REVERSAL');
      expect(res.body.data.creditNote.journalId).toBeTruthy();

      const list = await request(app)
        .get('/api/v1/invoices')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug);
      const stillOriginal = list.body.data.invoices.find((i: any) => i.id === invoice.id);
      expect(Number(stillOriginal.total)).toBe(1000);

      const afterLedger = await request(app)
        .get('/api/v1/ledgers/summary')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug);
      const cashAfter = afterLedger.body.data.accounts.find((a: any) => a.id === cashAccountId).closingBalance;
      const revenueAfter = afterLedger.body.data.accounts.find((a: any) => a.id === revenueAccountId).closingBalance;
      expect(cashAfter).toBe(cashBefore - 300);
      // Revenue is credit-normal, so closingBalance (debit - credit) is negative
      // when revenue exists; debiting it to reverse moves the number toward zero.
      expect(revenueAfter).toBe(revenueBefore + 300);
    });

    it('carries the invoice\'s fundId through to a credit note\'s reversal lines (regression: same class of bug as the void-mapper fix)', async () => {
      const fund = await request(app)
        .post('/api/v1/funds')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({ name: 'Credit Note Fund', code: `CNFUND-${Date.now()}` });
      const fundId = fund.body.data.fund.id;

      const invoice = await request(app)
        .post('/api/v1/invoices')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({ customerId, fundId, items: [{ description: 'Fund-tagged consulting', quantity: 1, unitPrice: 400 }] });
      expect(invoice.status).toBe(201);
      const paid = await payInvoice(invoice.body.data.invoice.id);
      expect(paid.status).toBe('PAID');

      const creditNote = await request(app)
        .post(`/api/v1/invoices/${invoice.body.data.invoice.id}/credit-notes`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({ amount: 150, reason: 'Fund credit note regression test' });
      expect(creditNote.status).toBe(201);
      expect(creditNote.body.data.creditNote.method).toBe('JOURNAL_REVERSAL');

      const journalRes = await request(app)
        .get(`/api/v1/journal-entries/${creditNote.body.data.creditNote.journalId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug);
      const lines = journalRes.body.data.journalEntry.lines;
      expect(lines.length).toBe(2);
      expect(lines.every((l: any) => l.fundId === fundId)).toBe(true);
    });

    it('rejects a credit amount exceeding the remaining creditable balance', async () => {
      const invoice = await createInvoice(500);
      const res = await request(app)
        .post(`/api/v1/invoices/${invoice.id}/credit-notes`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({ amount: 600, reason: 'Too much' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('exceeds the remaining creditable balance');
    });

    it('rejects a missing reason', async () => {
      const invoice = await createInvoice(500);
      const res = await request(app)
        .post(`/api/v1/invoices/${invoice.id}/credit-notes`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({ amount: 100 });
      expect(res.status).toBe(400);
    });

    it('rejects a non-positive amount', async () => {
      const invoice = await createInvoice(500);
      const res = await request(app)
        .post(`/api/v1/invoices/${invoice.id}/credit-notes`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({ amount: 0, reason: 'Nothing' });
      expect(res.status).toBe(400);
    });

    it('404s for an invoice that does not belong to the tenant', async () => {
      const res = await request(app)
        .post(`/api/v1/invoices/00000000-0000-0000-0000-000000000000/credit-notes`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({ amount: 100, reason: 'Test' });
      expect(res.status).toBe(404);
    });

    it('lists credit notes issued against an invoice', async () => {
      const invoice = await createInvoice(500);
      await request(app)
        .post(`/api/v1/invoices/${invoice.id}/credit-notes`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({ amount: 100, reason: 'Partial return' });

      const res = await request(app)
        .get(`/api/v1/invoices/${invoice.id}/credit-notes`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug);
      expect(res.status).toBe(200);
      expect(res.body.data.creditNotes.length).toBe(1);
      expect(Number(res.body.data.creditNotes[0].amount)).toBe(100);
    });
  });

  describe('POST /api/v1/bills/:id/debit-notes', () => {
    it('reduces the bill amount with no journal entry when the bill is unpaid', async () => {
      const bill = await createBill(800);
      const res = await request(app)
        .post(`/api/v1/bills/${bill.id}/debit-notes`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({ amount: 150, reason: 'Returned defective supplies' });

      expect(res.status).toBe(201);
      expect(res.body.data.debitNote.method).toBe('BILL_REDUCTION');
      expect(res.body.data.debitNote.journalId).toBeNull();

      const list = await request(app)
        .get('/api/v1/bills')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug);
      const updated = list.body.data.bills.find((b: any) => b.id === bill.id);
      expect(Number(updated.amount)).toBe(650);
    });

    it('posts a real reversing journal entry and leaves the bill amount untouched when already paid', async () => {
      const bill = await createBill(800);
      await payBill(bill.id);

      const beforeLedger = await request(app)
        .get('/api/v1/ledgers/summary')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug);
      const cashBefore = beforeLedger.body.data.accounts.find((a: any) => a.id === cashAccountId).closingBalance;
      const expenseBefore = beforeLedger.body.data.accounts.find((a: any) => a.id === expenseAccountId).closingBalance;

      const res = await request(app)
        .post(`/api/v1/bills/${bill.id}/debit-notes`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({ amount: 200, reason: 'Vendor refunded overcharge' });

      expect(res.status).toBe(201);
      expect(res.body.data.debitNote.method).toBe('JOURNAL_REVERSAL');
      expect(res.body.data.debitNote.journalId).toBeTruthy();

      const list = await request(app)
        .get('/api/v1/bills')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug);
      const stillOriginal = list.body.data.bills.find((b: any) => b.id === bill.id);
      expect(Number(stillOriginal.amount)).toBe(800);

      const afterLedger = await request(app)
        .get('/api/v1/ledgers/summary')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug);
      const cashAfter = afterLedger.body.data.accounts.find((a: any) => a.id === cashAccountId).closingBalance;
      const expenseAfter = afterLedger.body.data.accounts.find((a: any) => a.id === expenseAccountId).closingBalance;
      expect(cashAfter).toBe(cashBefore + 200);
      expect(expenseAfter).toBe(expenseBefore - 200);
    });

    it('rejects a debit amount exceeding the remaining debitable balance', async () => {
      const bill = await createBill(300);
      const res = await request(app)
        .post(`/api/v1/bills/${bill.id}/debit-notes`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({ amount: 400, reason: 'Too much' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('exceeds the remaining debitable balance');
    });

    it('lists debit notes issued against a bill', async () => {
      const bill = await createBill(300);
      await request(app)
        .post(`/api/v1/bills/${bill.id}/debit-notes`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({ amount: 50, reason: 'Partial return' });

      const res = await request(app)
        .get(`/api/v1/bills/${bill.id}/debit-notes`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug);
      expect(res.status).toBe(200);
      expect(res.body.data.debitNotes.length).toBe(1);
      expect(Number(res.body.data.debitNotes[0].amount)).toBe(50);
    });
  });
});
