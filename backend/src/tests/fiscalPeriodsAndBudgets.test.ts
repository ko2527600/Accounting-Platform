import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';

describe('Fiscal Periods & Budgets API (period locking, real variance recompute)', () => {
  const runId = Date.now();
  const tenant1Slug = `fiscal-corp-1-${runId}`;
  const tenant1Schema = `tenant_fiscal_corp_1_${runId}`;
  const admin1Email = `admin_fiscal1_${runId}@corp1.com`;

  const tenant2Slug = `fiscal-corp-2-${runId}`;
  const tenant2Schema = `tenant_fiscal_corp_2_${runId}`;
  const admin2Email = `admin_fiscal2_${runId}@corp2.com`;

  let token1: string;
  let token2: string;
  let tenant1Id: string | undefined;
  let tenant2Id: string | undefined;
  let cashAccountId: string;
  let revenueAccountId: string;

  async function cleanupTestData() {
    const ids = [tenant1Id, tenant2Id].filter((id): id is string => Boolean(id));
    if (ids.length > 0) {
      await prisma.budget.deleteMany({ where: { tenantId: { in: ids } } }).catch(() => {});
      await prisma.fiscalPeriod.deleteMany({ where: { tenantId: { in: ids } } }).catch(() => {});
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
      companyName: 'Fiscal Isolation Corp 1',
      slug: tenant1Slug,
      adminEmail: admin1Email,
      adminPassword: 'Password123!',
      adminName: 'Fiscal Corp 1 Admin',
    });
    token1 = onboard1.token;
    tenant1Id = onboard1.tenant.id;

    const onboard2 = await onboardTenant(prisma, {
      companyName: 'Fiscal Isolation Corp 2',
      slug: tenant2Slug,
      adminEmail: admin2Email,
      adminPassword: 'Password123!',
      adminName: 'Fiscal Corp 2 Admin',
    });
    token2 = onboard2.token;
    tenant2Id = onboard2.tenant.id;

    const cashAcc = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ code: '1010', name: 'Cash', type: 'ASSET' });
    cashAccountId = cashAcc.body.data.account.id;

    const revAcc = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ code: '4010', name: 'Sales Revenue', type: 'REVENUE' });
    revenueAccountId = revAcc.body.data.account.id;
  }, 120000);

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it('creates a fiscal period and rejects a duplicate year/period-number for the same tenant only', async () => {
    const created = await request(app)
      .post('/api/v1/fiscal-periods')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ name: 'January 2026', fiscalYear: 2026, periodNumber: 1, startDate: '2026-01-01', endDate: '2026-01-31' });
    expect(created.status).toBe(201);
    expect(created.body.data.fiscalPeriod.status).toBe('OPEN');

    const duplicate = await request(app)
      .post('/api/v1/fiscal-periods')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ name: 'January 2026 Again', fiscalYear: 2026, periodNumber: 1, startDate: '2026-01-01', endDate: '2026-01-31' });
    expect(duplicate.status).toBe(409);

    const otherTenantSamePeriod = await request(app)
      .post('/api/v1/fiscal-periods')
      .set('Authorization', `Bearer ${token2}`)
      .set('X-Tenant-ID', tenant2Slug)
      .send({ name: 'January 2026', fiscalYear: 2026, periodNumber: 1, startDate: '2026-01-01', endDate: '2026-01-31' });
    expect(otherTenantSamePeriod.status).toBe(201);
  });

  it('allows posting a journal entry within an OPEN period', async () => {
    const res = await request(app)
      .post('/api/v1/journal-entries')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({
        entryDate: '2026-01-15',
        description: 'January sale',
        status: 'POSTED',
        lines: [
          { accountId: cashAccountId, debit: 500, credit: 0 },
          { accountId: revenueAccountId, debit: 0, credit: 500 },
        ],
      });
    expect(res.status).toBe(201);
  });

  it('blocks posting a journal entry once the covering period is CLOSED, and unblocks nothing once LOCKED', async () => {
    const list = await request(app)
      .get('/api/v1/fiscal-periods')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug);
    const jan2026 = list.body.data.fiscalPeriods.find((p: any) => p.fiscalYear === 2026 && p.periodNumber === 1);

    const closeRes = await request(app)
      .patch(`/api/v1/fiscal-periods/${jan2026.id}/close`)
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug);
    expect(closeRes.status).toBe(200);
    expect(closeRes.body.data.fiscalPeriod.status).toBe('CLOSED');

    const blockedPost = await request(app)
      .post('/api/v1/journal-entries')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({
        entryDate: '2026-01-20',
        description: 'Late January entry',
        status: 'POSTED',
        lines: [
          { accountId: cashAccountId, debit: 100, credit: 0 },
          { accountId: revenueAccountId, debit: 0, credit: 100 },
        ],
      });
    expect(blockedPost.status).toBe(400);

    // A DRAFT for the same closed-period date is still allowed - it has no ledger effect yet.
    const draftStillAllowed = await request(app)
      .post('/api/v1/journal-entries')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({
        entryDate: '2026-01-20',
        description: 'Late January draft',
        status: 'DRAFT',
        lines: [
          { accountId: cashAccountId, debit: 100, credit: 0 },
          { accountId: revenueAccountId, debit: 0, credit: 100 },
        ],
      });
    expect(draftStillAllowed.status).toBe(201);

    // Locking requires Admin role and only works from CLOSED.
    const lockRes = await request(app)
      .patch(`/api/v1/fiscal-periods/${jan2026.id}/lock`)
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug);
    expect(lockRes.status).toBe(200);
    expect(lockRes.body.data.fiscalPeriod.status).toBe('LOCKED');

    const reCloseAttempt = await request(app)
      .patch(`/api/v1/fiscal-periods/${jan2026.id}/close`)
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug);
    expect(reCloseAttempt.status).toBe(400);
  });

  it('does not block postings for dates with no fiscal period configured at all (opt-in enforcement)', async () => {
    const res = await request(app)
      .post('/api/v1/journal-entries')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({
        entryDate: '2030-06-01',
        description: 'Undefined-period entry',
        status: 'POSTED',
        lines: [
          { accountId: cashAccountId, debit: 10, credit: 0 },
          { accountId: revenueAccountId, debit: 0, credit: 10 },
        ],
      });
    expect(res.status).toBe(201);
  });

  it('creates a budget and recomputes actualAmount/variance from real ledger activity', async () => {
    const periods = await request(app)
      .get('/api/v1/fiscal-periods')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug);
    const jan2026 = periods.body.data.fiscalPeriods.find((p: any) => p.fiscalYear === 2026 && p.periodNumber === 1);

    const budgetRes = await request(app)
      .post('/api/v1/budgets')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ accountId: revenueAccountId, fiscalPeriodId: jan2026.id, budgetAmount: 400 });
    expect(budgetRes.status).toBe(201);
    const budgetId = budgetRes.body.data.budget.id;

    const fetched = await request(app)
      .get(`/api/v1/budgets/${budgetId}`)
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug);

    expect(fetched.status).toBe(200);
    // The January sale posted earlier credited Sales Revenue 500 (debit - credit = -500 for a revenue account).
    expect(Number(fetched.body.data.budget.actualAmount)).toBeCloseTo(-500, 2);
    expect(Number(fetched.body.data.budget.variance)).toBeCloseTo(-900, 2);

    const duplicateBudget = await request(app)
      .post('/api/v1/budgets')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ accountId: revenueAccountId, fiscalPeriodId: jan2026.id, budgetAmount: 999 });
    expect(duplicateBudget.status).toBe(409);
  });

  it('does not let one tenant see or fetch another tenant\'s fiscal periods/budgets', async () => {
    const tenant2List = await request(app)
      .get('/api/v1/fiscal-periods')
      .set('Authorization', `Bearer ${token2}`)
      .set('X-Tenant-ID', tenant2Slug);
    const tenant2Period = tenant2List.body.data.fiscalPeriods[0];

    const crossTenantFetch = await request(app)
      .get(`/api/v1/fiscal-periods/${tenant2Period.id}`)
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug);
    expect(crossTenantFetch.status).toBe(404);
  });
});
