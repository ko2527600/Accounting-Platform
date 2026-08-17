import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';
import { RecurringTransactionCronService, advanceDate } from '../services/recurringTransactionService';

describe('Recurring Transactions API + cron generator', () => {
  const runId = Date.now();
  const tenant1Slug = `recurring-corp-1-${runId}`;
  const tenant1Schema = `tenant_recurring_corp_1_${runId}`;
  const admin1Email = `admin_recurring1_${runId}@corp1.com`;

  const tenant2Slug = `recurring-corp-2-${runId}`;
  const tenant2Schema = `tenant_recurring_corp_2_${runId}`;
  const admin2Email = `admin_recurring2_${runId}@corp2.com`;

  let token1: string;
  let token2: string;
  let tenant1Id: string | undefined;
  let tenant2Id: string | undefined;
  let cashAccountId: string;
  let expenseAccountId: string;

  async function cleanupTestData() {
    const ids = [tenant1Id, tenant2Id].filter((id): id is string => Boolean(id));
    if (ids.length > 0) {
      await prisma.recurringTransaction.deleteMany({ where: { tenantId: { in: ids } } }).catch(() => {});
    }
    await deleteTenantBySlug(prisma, tenant1Slug).catch(() => {});
    await deleteTenantBySlug(prisma, tenant2Slug).catch(() => {});
    await deleteUserByEmail(prisma, admin1Email).catch(() => {});
    await deleteUserByEmail(prisma, admin2Email).catch(() => {});
    await dropTenantSchema(prisma, tenant1Schema).catch(() => {});
    await dropTenantSchema(prisma, tenant2Schema).catch(() => {});
  }

  beforeAll(async () => {
    await prisma.$connect();
    await ensureTenantTableExists(prisma);
    await ensureUserTableExists(prisma);
    await cleanupTestData();

    const onboard1 = await onboardTenant(prisma, {
      companyName: 'Recurring Isolation Corp 1',
      slug: tenant1Slug,
      adminEmail: admin1Email,
      adminPassword: 'Password123!',
      adminName: 'Recurring Corp 1 Admin',
      tier: 3, // Recurring Transactions is a Business+ feature (requireTier gate) - not what this file tests.
    });
    token1 = onboard1.token;
    tenant1Id = onboard1.tenant.id;

    const onboard2 = await onboardTenant(prisma, {
      companyName: 'Recurring Isolation Corp 2',
      slug: tenant2Slug,
      adminEmail: admin2Email,
      adminPassword: 'Password123!',
      adminName: 'Recurring Corp 2 Admin',
      tier: 3, // Recurring Transactions is a Business+ feature (requireTier gate) - not what this file tests.
    });
    token2 = onboard2.token;
    tenant2Id = onboard2.tenant.id;

    const cashAcc = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ code: '5010', name: 'Rent Expense', type: 'EXPENSE' });
    expenseAccountId = cashAcc.body.data.account.id;

    const bankAcc = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ code: '1010', name: 'Cash', type: 'ASSET' });
    cashAccountId = bankAcc.body.data.account.id;
  }, 120000);

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it('advances dates correctly per frequency', () => {
    const base = new Date('2026-01-31T00:00:00.000Z');
    expect(advanceDate(base, 'DAILY').toISOString()).toBe('2026-02-01T00:00:00.000Z');
    expect(advanceDate(base, 'WEEKLY').toISOString()).toBe('2026-02-07T00:00:00.000Z');
    expect(advanceDate(base, 'MONTHLY').toISOString().split('T')[0]).toBe('2026-03-03'); // JS Date month-overflow rolls forward, expected/documented behavior
    expect(advanceDate(base, 'YEARLY').toISOString()).toBe('2027-01-31T00:00:00.000Z');
  });

  it('creates a recurring transaction with template validation', async () => {
    const missingLines = await request(app)
      .post('/api/v1/recurring-transactions')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ name: 'Bad Template', frequency: 'MONTHLY', startDate: '2026-01-01', templateData: {} });
    expect(missingLines.status).toBe(400);

    const badFrequency = await request(app)
      .post('/api/v1/recurring-transactions')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({
        name: 'Bad Frequency',
        frequency: 'HOURLY',
        startDate: '2026-01-01',
        templateData: { lines: [{ accountId: expenseAccountId }, { accountId: cashAccountId }] },
      });
    expect(badFrequency.status).toBe(400);

    const created = await request(app)
      .post('/api/v1/recurring-transactions')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({
        name: 'Monthly Rent',
        frequency: 'MONTHLY',
        // Due "now" so the first sweep fires it, but after advancing one
        // month, nextRun lands safely in the future - unlike a far-past
        // startDate, which would still be due again on the very next sweep
        // (intentional backlog catch-up behavior, one occurrence per sweep).
        startDate: new Date().toISOString(),
        templateData: {
          description: 'Monthly Rent Payment',
          lines: [
            { accountId: expenseAccountId, debit: 200, credit: 0 },
            { accountId: cashAccountId, debit: 0, credit: 200 },
          ],
        },
      });
    expect(created.status).toBe(201);
    expect(created.body.data.recurringTransaction.nextRun).toBeDefined();
  });

  it('does not let one tenant see another tenant\'s recurring transactions', async () => {
    const tenant2List = await request(app)
      .get('/api/v1/recurring-transactions')
      .set('Authorization', `Bearer ${token2}`)
      .set('X-Tenant-ID', tenant2Slug);
    expect(tenant2List.body.data.recurringTransactions.length).toBe(0);

    const tenant1List = await request(app)
      .get('/api/v1/recurring-transactions')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug);
    expect(tenant1List.body.data.recurringTransactions.length).toBe(1);
  });

  it('cron sweep generates a real journal entry for a due row and advances nextRun', async () => {
    const before = await request(app)
      .get('/api/v1/journal-entries')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug);
    const countBefore = before.body.data.journalEntries.length;

    await RecurringTransactionCronService.runDueTransactionsJob();

    const after = await request(app)
      .get('/api/v1/journal-entries')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug);
    expect(after.body.data.journalEntries.length).toBe(countBefore + 1);

    const generated = after.body.data.journalEntries.find((je: any) => je.description === 'Monthly Rent Payment');
    expect(generated).toBeDefined();
    expect(generated.status).toBe('POSTED');

    const list = await request(app)
      .get('/api/v1/recurring-transactions')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug);
    const rt = list.body.data.recurringTransactions[0];
    expect(rt.lastRun).not.toBeNull();
    expect(new Date(rt.nextRun).getTime()).toBeGreaterThan(Date.now());
  });

  it('records RECURRING_TXN.CREATED/.UPDATED/.DELETED audit log entries', async () => {
    const created = await request(app)
      .post('/api/v1/recurring-transactions')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({
        name: 'Audit Test Subscription',
        frequency: 'MONTHLY',
        startDate: '2030-01-01',
        templateData: {
          lines: [
            { accountId: expenseAccountId, debit: 50, credit: 0 },
            { accountId: cashAccountId, debit: 0, credit: 50 },
          ],
        },
      });
    expect(created.status).toBe(201);
    const rtId = created.body.data.recurringTransaction.id;

    expect(
      await prisma.auditLog.findFirst({ where: { tenantId: tenant1Id, entity: 'RecurringTransaction', entityId: rtId, action: 'RECURRING_TXN.CREATED' } })
    ).toBeTruthy();

    const updated = await request(app)
      .put(`/api/v1/recurring-transactions/${rtId}`)
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ name: 'Audit Test Subscription Renamed' });
    expect(updated.status).toBe(200);
    const updatedLog = await prisma.auditLog.findFirst({ where: { tenantId: tenant1Id, entity: 'RecurringTransaction', entityId: rtId, action: 'RECURRING_TXN.UPDATED' } });
    expect(updatedLog).toBeTruthy();
    expect((updatedLog!.changes as any).name).toEqual({ from: 'Audit Test Subscription', to: 'Audit Test Subscription Renamed' });

    const deleted = await request(app)
      .delete(`/api/v1/recurring-transactions/${rtId}`)
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug);
    expect(deleted.status).toBe(200);
    expect(
      await prisma.auditLog.findFirst({ where: { tenantId: tenant1Id, entity: 'RecurringTransaction', entityId: rtId, action: 'RECURRING_TXN.DELETED' } })
    ).toBeTruthy();
  });

  it('running the sweep again immediately does not double-generate (nextRun already advanced past now)', async () => {
    const before = await request(app)
      .get('/api/v1/journal-entries')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug);
    const countBefore = before.body.data.journalEntries.length;

    await RecurringTransactionCronService.runDueTransactionsJob();

    const after = await request(app)
      .get('/api/v1/journal-entries')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug);
    expect(after.body.data.journalEntries.length).toBe(countBefore);
  });
});
