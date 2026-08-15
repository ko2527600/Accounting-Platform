import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';

describe('Bank reconciliation matching logic (GET suggestions / POST reconcile validation)', () => {
  const runId = Date.now();
  const tenantSlug = `bankrec-corp-${runId}`;
  const tenantSchema = `tenant_bankrec_corp_${runId}`;
  const adminEmail = `admin_bankrec_${runId}@corp.com`;

  let adminToken: string;
  let tenantId: string;
  let bankAccountId: string;
  let cashAccountId: string;
  let revenueAccountId: string;

  async function cleanupTestData() {
    if (tenantId) {
      await prisma.bankAccount.deleteMany({ where: { tenantId } }).catch(() => {});
    }
    await deleteTenantBySlug(prisma, tenantSlug).catch(() => {});
    await deleteUserByEmail(prisma, adminEmail).catch(() => {});
    await dropTenantSchema(prisma, tenantSchema).catch(() => {});
  }

  /** Posts a journal entry that produces one Ledger row on the cash account (debit = deposit) for `amount`. */
  async function createLedgerEntry(amount: number, entryDate: string, description: string) {
    const res = await request(app)
      .post('/api/v1/journal-entries')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({
        description,
        status: 'POSTED',
        entryDate,
        lines: [
          { accountId: cashAccountId, debit: amount, credit: 0 },
          { accountId: revenueAccountId, debit: 0, credit: amount },
        ],
      });
    expect(res.status).toBe(201);
    return res.body.data.journalEntry;
  }

  async function createBankTransaction(amount: number, postedDate: string, payee: string) {
    return (prisma as any).bankTransaction.create({
      data: { tenantId, bankAccountId, amount, payee, postedDate: new Date(postedDate), status: 'UNRECONCILED' },
    });
  }

  /** Finds the real Ledger row id created for a given amount/date by round-tripping through the suggestions endpoint (Ledger ids aren't exposed on the journal-entry creation response - they're a separate table). */
  async function findLedgerIdFor(amount: number, date: string): Promise<string> {
    const probeTx = await createBankTransaction(amount, date, 'Probe (matches ledger id lookup only)');
    const res = await request(app)
      .get(`/api/v1/banking/transactions/${probeTx.id}/suggestions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);
    expect(res.body.data.candidates.length).toBeGreaterThanOrEqual(1);
    return res.body.data.candidates[0].id;
  }

  beforeAll(async () => {
    await prisma.$connect();
    await ensureTenantTableExists(prisma);
    await ensureUserTableExists(prisma);
    await cleanupTestData();

    const onboard = await onboardTenant(prisma, {
      companyName: 'Bank Rec Corp',
      slug: tenantSlug,
      adminEmail,
      adminPassword: 'Password123!',
      adminName: 'Bank Rec Admin',
      tier: 3, // Bank Reconciliation is a Business+ feature (requireTier gate) - not what this file tests.
    });
    adminToken = onboard.token;
    tenantId = onboard.tenant.id;

    bankAccountId = (
      await (prisma as any).bankAccount.create({
        data: { tenantId, accountName: 'Test Feed', accountNumber: '0000', bankName: 'Test Bank', currency: 'USD' },
      })
    ).id;

    const cashAcc = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ code: `1010-${runId}`, name: 'Cash', type: 'ASSET' });
    cashAccountId = cashAcc.body.data.account.id;

    const revenueAcc = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ code: `4010-${runId}`, name: 'Consulting Revenue', type: 'REVENUE' });
    revenueAccountId = revenueAcc.body.data.account.id;
  }, 60000);

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it('suggests an exact amount/date match on a cash-equivalent account', async () => {
    await createLedgerEntry(1000, '2026-03-10', 'Consulting invoice paid');
    const bankTx = await createBankTransaction(1000, '2026-03-11', 'Client Deposit');

    const res = await request(app)
      .get(`/api/v1/banking/transactions/${bankTx.id}/suggestions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);

    expect(res.status).toBe(200);
    expect(res.body.data.candidates.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.candidates[0].accountCode).toBe(`1010-${runId}`);
  });

  it('does not suggest a ledger entry outside the day window', async () => {
    await createLedgerEntry(2500, '2026-01-01', 'Old unrelated payment');
    const bankTx = await createBankTransaction(2500, '2026-03-15', 'Unrelated Deposit');

    const res = await request(app)
      .get(`/api/v1/banking/transactions/${bankTx.id}/suggestions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);

    expect(res.status).toBe(200);
    expect(res.body.data.candidates.length).toBe(0);
  });

  it('does not suggest a ledger entry with a different amount', async () => {
    await createLedgerEntry(777, '2026-04-01', 'Different amount entry');
    const bankTx = await createBankTransaction(778, '2026-04-01', 'Almost Matching Deposit');

    const res = await request(app)
      .get(`/api/v1/banking/transactions/${bankTx.id}/suggestions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);

    expect(res.status).toBe(200);
    expect(res.body.data.candidates.length).toBe(0);
  });

  it('excludes a ledger entry already linked to a different bank transaction', async () => {
    await createLedgerEntry(4321, '2026-05-01', 'Shared amount entry');
    const ledgerId = await findLedgerIdFor(4321, '2026-05-01');

    const firstTx = await createBankTransaction(4321, '2026-05-01', 'First Deposit');
    const firstReconcile = await request(app)
      .post('/api/v1/banking/reconcile')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ transactionId: firstTx.id, ledgerId });
    expect(firstReconcile.status).toBe(200);

    const secondTx = await createBankTransaction(4321, '2026-05-02', 'Second Deposit Same Amount');
    const res = await request(app)
      .get(`/api/v1/banking/transactions/${secondTx.id}/suggestions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);

    expect(res.status).toBe(200);
    const ledgerIds = res.body.data.candidates.map((c: any) => c.id);
    expect(ledgerIds).not.toContain(ledgerId);
  });

  it('reconciles when the ledgerId matches, records an audit log entry', async () => {
    await createLedgerEntry(9900, '2026-06-01', 'Matched consulting fee');
    const ledgerId = await findLedgerIdFor(9900, '2026-06-01');
    const bankTx = await createBankTransaction(9900, '2026-06-01', 'Consulting Fee Deposit');

    const res = await request(app)
      .post('/api/v1/banking/reconcile')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ transactionId: bankTx.id, ledgerId });

    expect(res.status).toBe(200);
    expect(res.body.data.transaction.status).toBe('RECONCILED');
    expect(res.body.data.transaction.ledgerId).toBe(ledgerId);

    const log = await prisma.auditLog.findFirst({
      where: { tenantId, entity: 'BankTransaction', entityId: bankTx.id, action: 'BANK_TRANSACTION.RECONCILED' },
    });
    expect(log).toBeTruthy();
  });

  it('rejects reconciling against a ledger entry with a mismatched amount', async () => {
    await createLedgerEntry(3000, '2026-07-01', 'Mismatched amount entry');
    const ledgerId = await findLedgerIdFor(3000, '2026-07-01');
    const bankTx = await createBankTransaction(3500, '2026-07-01', 'Mismatched Deposit');

    const res = await request(app)
      .post('/api/v1/banking/reconcile')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ transactionId: bankTx.id, ledgerId });

    expect(res.status).toBe(400);
  });

  it('rejects reconciling a ledger entry that is already matched to a different bank transaction', async () => {
    await createLedgerEntry(5555, '2026-08-01', 'Already claimed entry');
    const ledgerId = await findLedgerIdFor(5555, '2026-08-01');

    const firstTx = await createBankTransaction(5555, '2026-08-01', 'First Claim Deposit');
    const firstRes = await request(app)
      .post('/api/v1/banking/reconcile')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ transactionId: firstTx.id, ledgerId });
    expect(firstRes.status).toBe(200);

    const secondTx = await createBankTransaction(5555, '2026-08-01', 'Second Claim Deposit');
    const res = await request(app)
      .post('/api/v1/banking/reconcile')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ transactionId: secondTx.id, ledgerId });

    expect(res.status).toBe(409);
  });

  it('returns 404 for an unknown ledgerId', async () => {
    const bankTx = await createBankTransaction(1234, '2026-09-01', 'Unknown Ledger Deposit');
    const res = await request(app)
      .post('/api/v1/banking/reconcile')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ transactionId: bankTx.id, ledgerId: '00000000-0000-0000-0000-000000000000' });

    expect(res.status).toBe(404);
  });
});
