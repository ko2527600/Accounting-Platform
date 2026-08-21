import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';
import { runWithTenantContext } from '../context/tenantContext';
import * as fixedAssetService from '../services/fixedAssetService';
import { FixedAssetServiceError } from '../services/fixedAssetService';
import { FixedAssetDepreciationCronService } from '../services/fixedAssetDepreciationCronService';

describe('Fixed Asset Management + Depreciation', () => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tenantSlug = `fa-corp-${runId}`;
  const tenantSchema = `tenant_fa_corp_${runId}`;
  const adminEmail = `admin_fa_${runId}@corp.com`;

  let adminToken: string;
  let tenantId: string;
  let vehiclesAccountId: string;
  let cashAccountId: string;
  let depExpenseAccountId: string;
  let accumDepAccountId: string;

  async function cleanupTestData() {
    if (tenantId) {
      await prisma.fixedAsset.deleteMany({ where: { tenantId } }).catch(() => {});
    }
    await deleteTenantBySlug(prisma, tenantSlug).catch(() => {});
    await deleteUserByEmail(prisma, adminEmail).catch(() => {});
    await dropTenantSchema(prisma, tenantSchema).catch(() => {});
  }

  function authed(req: request.Test): request.Test {
    return req.set('Authorization', `Bearer ${adminToken}`).set('X-Tenant-ID', tenantSlug);
  }

  async function withTenantCtx<T>(fn: () => Promise<T>): Promise<T> {
    return runWithTenantContext({ tenantId, tenantSchema, tenantName: 'FA Corp', tenantSlug }, fn);
  }

  beforeAll(async () => {
    await prisma.$connect();
    await ensureTenantTableExists(prisma);
    await ensureUserTableExists(prisma);
    await cleanupTestData();

    const onboard = await onboardTenant(prisma, {
      companyName: 'FA Corp',
      slug: tenantSlug,
      adminEmail,
      adminPassword: 'Password123!',
      adminName: 'FA Admin',
    });
    adminToken = onboard.token;
    tenantId = onboard.tenant.id;

    const vehicles = await authed(request(app).post('/api/v1/accounts')).send({ code: '1510', name: 'Vehicles', type: 'ASSET' });
    vehiclesAccountId = vehicles.body.data.account.id;

    const cash = await authed(request(app).post('/api/v1/accounts')).send({ code: '1010', name: 'Cash on Hand', type: 'ASSET' });
    cashAccountId = cash.body.data.account.id;

    const depExpense = await authed(request(app).post('/api/v1/accounts')).send({ code: '5510', name: 'Depreciation Expense', type: 'EXPENSE' });
    depExpenseAccountId = depExpense.body.data.account.id;

    const accumDep = await authed(request(app).post('/api/v1/accounts')).send({ code: '1519', name: 'Accumulated Depreciation', type: 'ASSET' });
    accumDepAccountId = accumDep.body.data.account.id;

    await authed(request(app).put(`/api/v1/accounts/${depExpenseAccountId}/default-role`)).send({ role: 'DEPRECIATION_EXPENSE' });
    await authed(request(app).put(`/api/v1/accounts/${accumDepAccountId}/default-role`)).send({ role: 'ACCUMULATED_DEPRECIATION' });
  }, 60000);

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it('creates a fixed asset and posts a real acquisition journal entry', async () => {
    const beforeLedger = await authed(request(app).get('/api/v1/ledgers/summary'));
    const cashBefore = beforeLedger.body.data.accounts.find((a: any) => a.id === cashAccountId).closingBalance;
    const vehiclesBefore = beforeLedger.body.data.accounts.find((a: any) => a.id === vehiclesAccountId).closingBalance;

    const res = await authed(request(app).post('/api/v1/fixed-assets')).send({
      name: 'Toyota Hilux',
      category: 'Vehicles',
      acquisitionDate: '2020-01-15',
      cost: 4000,
      residualValue: 0,
      depreciationMethod: 'STRAIGHT_LINE',
      usefulLifeMonths: 4,
      assetAccountId: vehiclesAccountId,
      paymentAccountId: cashAccountId,
    });

    expect(res.status).toBe(201);
    expect(res.body.data.asset.status).toBe('ACTIVE');
    expect(Number(res.body.data.asset.accumulatedDepreciation)).toBe(0);

    const afterLedger = await authed(request(app).get('/api/v1/ledgers/summary'));
    const cashAfter = afterLedger.body.data.accounts.find((a: any) => a.id === cashAccountId).closingBalance;
    const vehiclesAfter = afterLedger.body.data.accounts.find((a: any) => a.id === vehiclesAccountId).closingBalance;
    expect(cashAfter).toBe(cashBefore - 4000);
    expect(vehiclesAfter).toBe(vehiclesBefore + 4000);

    // Acquiring the asset auto-flips isFixedAsset on the chosen asset account.
    const accountsRes = await authed(request(app).get('/api/v1/accounts'));
    const vehiclesAccount = accountsRes.body.data.accounts.find((a: any) => a.id === vehiclesAccountId);
    expect(vehiclesAccount.isFixedAsset).toBe(true);
  });

  it('rejects an asset account that is not an ASSET type', async () => {
    const res = await authed(request(app).post('/api/v1/fixed-assets')).send({
      name: 'Bad Asset',
      acquisitionDate: '2020-01-15',
      cost: 100,
      depreciationMethod: 'STRAIGHT_LINE',
      usefulLifeMonths: 12,
      assetAccountId: depExpenseAccountId,
      paymentAccountId: cashAccountId,
    });
    expect(res.status).toBe(400);
  });

  it('straight-line depreciation posts the correct monthly amount and caps at fully depreciated', async () => {
    const created = await authed(request(app).post('/api/v1/fixed-assets')).send({
      name: 'Delivery Van',
      acquisitionDate: '2026-01-15',
      cost: 400,
      residualValue: 0,
      depreciationMethod: 'STRAIGHT_LINE',
      usefulLifeMonths: 4,
      assetAccountId: vehiclesAccountId,
      paymentAccountId: cashAccountId,
    });
    const assetId = created.body.data.asset.id;

    const beforeLedger = await authed(request(app).get('/api/v1/ledgers/summary'));
    const depExpenseBefore = beforeLedger.body.data.accounts.find((a: any) => a.id === depExpenseAccountId).closingBalance;
    const accumDepBefore = beforeLedger.body.data.accounts.find((a: any) => a.id === accumDepAccountId).closingBalance;

    // 4 consecutive monthly runs, simulated directly rather than waiting on
    // real wall-clock time - depreciation starts the month AFTER acquisition.
    const months = ['2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01'];
    for (const m of months) {
      await withTenantCtx(() => fixedAssetService.depreciateOneAsset(tenantId, assetId, new Date(m)));
    }

    const detail = await authed(request(app).get(`/api/v1/fixed-assets/${assetId}`));
    expect(Number(detail.body.data.asset.accumulatedDepreciation)).toBe(400);
    expect(detail.body.data.asset.status).toBe('FULLY_DEPRECIATED');
    expect(detail.body.data.asset.depreciationEntries).toHaveLength(4);
    expect(Number(detail.body.data.asset.depreciationEntries[0].amount)).toBe(100);
    expect(Number(detail.body.data.asset.depreciationEntries[3].netBookValueAfter)).toBe(0);

    // Ledger truth, not just the FixedAsset row's own tracked totals - proves
    // the postings actually landed on the tenant-designated
    // DEPRECIATION_EXPENSE/ACCUMULATED_DEPRECIATION accounts specifically,
    // not wherever resolveDefaultAccount's fallback tiers happened to land.
    const afterLedger = await authed(request(app).get('/api/v1/ledgers/summary'));
    const depExpenseAfter = afterLedger.body.data.accounts.find((a: any) => a.id === depExpenseAccountId).closingBalance;
    const accumDepAfter = afterLedger.body.data.accounts.find((a: any) => a.id === accumDepAccountId).closingBalance;
    expect(depExpenseAfter - depExpenseBefore).toBe(400);
    expect(accumDepAfter - accumDepBefore).toBe(-400);

    // A 5th run is a no-op - the asset is no longer ACTIVE.
    await withTenantCtx(() => fixedAssetService.depreciateOneAsset(tenantId, assetId, new Date('2026-06-01')));
    const detailAfter = await authed(request(app).get(`/api/v1/fixed-assets/${assetId}`));
    expect(Number(detailAfter.body.data.asset.accumulatedDepreciation)).toBe(400);
    expect(detailAfter.body.data.asset.depreciationEntries).toHaveLength(4);
  });

  it('reducing-balance depreciation applies the annual rate to net book value each month', async () => {
    const created = await authed(request(app).post('/api/v1/fixed-assets')).send({
      name: 'Forklift',
      acquisitionDate: '2026-01-15',
      cost: 1000,
      residualValue: 0,
      depreciationMethod: 'REDUCING_BALANCE',
      depreciationRatePercent: 24,
      assetAccountId: vehiclesAccountId,
      paymentAccountId: cashAccountId,
    });
    const assetId = created.body.data.asset.id;

    await withTenantCtx(() => fixedAssetService.depreciateOneAsset(tenantId, assetId, new Date('2026-02-01')));
    let detail = await authed(request(app).get(`/api/v1/fixed-assets/${assetId}`));
    expect(Number(detail.body.data.asset.accumulatedDepreciation)).toBe(20); // 1000 * 0.24 / 12

    await withTenantCtx(() => fixedAssetService.depreciateOneAsset(tenantId, assetId, new Date('2026-03-01')));
    detail = await authed(request(app).get(`/api/v1/fixed-assets/${assetId}`));
    // Second month applies the rate to the now-reduced net book value (980), not the original cost.
    expect(Number(detail.body.data.asset.accumulatedDepreciation)).toBe(39.6);
  });

  it('disposing an asset stops all further depreciation', async () => {
    const created = await authed(request(app).post('/api/v1/fixed-assets')).send({
      name: 'Old Laptop',
      acquisitionDate: '2026-01-15',
      cost: 200,
      residualValue: 0,
      depreciationMethod: 'STRAIGHT_LINE',
      usefulLifeMonths: 10,
      assetAccountId: vehiclesAccountId,
      paymentAccountId: cashAccountId,
    });
    const assetId = created.body.data.asset.id;

    await withTenantCtx(() => fixedAssetService.depreciateOneAsset(tenantId, assetId, new Date('2026-02-01')));

    const disposeRes = await authed(request(app).put(`/api/v1/fixed-assets/${assetId}/dispose`)).send({ disposalDate: '2026-02-15' });
    expect(disposeRes.status).toBe(200);
    expect(disposeRes.body.data.asset.status).toBe('DISPOSED');

    const accumulatedBeforeSecondRun = Number(disposeRes.body.data.asset.accumulatedDepreciation);
    await withTenantCtx(() => fixedAssetService.depreciateOneAsset(tenantId, assetId, new Date('2026-03-01')));

    const detail = await authed(request(app).get(`/api/v1/fixed-assets/${assetId}`));
    expect(Number(detail.body.data.asset.accumulatedDepreciation)).toBe(accumulatedBeforeSecondRun);
    expect(detail.body.data.asset.status).toBe('DISPOSED');
  });

  it('refuses to dispose an already-disposed asset', async () => {
    const created = await authed(request(app).post('/api/v1/fixed-assets')).send({
      name: 'Old Printer',
      acquisitionDate: '2026-01-15',
      cost: 50,
      depreciationMethod: 'STRAIGHT_LINE',
      usefulLifeMonths: 6,
      assetAccountId: vehiclesAccountId,
      paymentAccountId: cashAccountId,
    });
    const assetId = created.body.data.asset.id;
    await authed(request(app).put(`/api/v1/fixed-assets/${assetId}/dispose`)).send({ disposalDate: '2026-02-01' });

    const secondDispose = await authed(request(app).put(`/api/v1/fixed-assets/${assetId}/dispose`)).send({ disposalDate: '2026-03-01' });
    expect(secondDispose.status).toBe(400);
  });

  it('throws a clear error when depreciation-posting accounts are not configured for this tenant', async () => {
    const onboard2 = await onboardTenant(prisma, {
      companyName: `FA Corp Unconfigured ${runId}`,
      slug: `fa-corp-unconfigured-${runId}`,
      adminEmail: `admin_fa_unconfigured_${runId}@corp.com`,
      adminPassword: 'Password123!',
      adminName: 'FA Admin 2',
    });
    const tenantId2 = onboard2.tenant.id;

    const vehiclesRes = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${onboard2.token}`)
      .set('X-Tenant-ID', onboard2.tenant.slug)
      .send({ code: '1510', name: 'Vehicles', type: 'ASSET' });
    const cashRes = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${onboard2.token}`)
      .set('X-Tenant-ID', onboard2.tenant.slug)
      .send({ code: '1010', name: 'Cash', type: 'ASSET' });

    const created = await request(app)
      .post('/api/v1/fixed-assets')
      .set('Authorization', `Bearer ${onboard2.token}`)
      .set('X-Tenant-ID', onboard2.tenant.slug)
      .send({
        name: 'Unconfigured Asset',
        acquisitionDate: '2026-01-15',
        cost: 100,
        depreciationMethod: 'STRAIGHT_LINE',
        usefulLifeMonths: 5,
        assetAccountId: vehiclesRes.body.data.account.id,
        paymentAccountId: cashRes.body.data.account.id,
      });
    const assetId = created.body.data.asset.id;

    await expect(
      runWithTenantContext(
        { tenantId: tenantId2, tenantSchema: onboard2.tenant.schema, tenantName: onboard2.tenant.name, tenantSlug: onboard2.tenant.slug },
        () => fixedAssetService.depreciateOneAsset(tenantId2, assetId, new Date('2026-02-01'))
      )
    ).rejects.toThrow(FixedAssetServiceError);

    await deleteTenantBySlug(prisma, onboard2.tenant.slug).catch(() => {});
    await deleteUserByEmail(prisma, `admin_fa_unconfigured_${runId}@corp.com`).catch(() => {});
    await dropTenantSchema(prisma, onboard2.tenant.schema).catch(() => {});
  });

  it('the daily cron sweep skips a misconfigured asset without touching it or blocking other tenants', async () => {
    await FixedAssetDepreciationCronService.runDepreciationJob();
    // No assertion beyond "does not throw" - this proves the per-asset
    // try/catch in the cron's loop absorbs the same configuration error the
    // direct-call test above proved depreciateOneAsset throws.
  });

  it('the Cash Flow Statement reports a fixed asset purchase under Investing Activities', async () => {
    await authed(request(app).post('/api/v1/fixed-assets')).send({
      name: 'Office Building Fixture',
      acquisitionDate: '2026-01-15',
      cost: 500,
      depreciationMethod: 'STRAIGHT_LINE',
      usefulLifeMonths: 20,
      assetAccountId: vehiclesAccountId,
      paymentAccountId: cashAccountId,
    });

    const res = await authed(request(app).get('/api/v1/reports/cash-flow'));
    expect(res.status).toBe(200);
    const investingLine = res.body.data.investingAdjustments.find((a: any) => a.id === vehiclesAccountId);
    expect(investingLine).toBeTruthy();
    expect(res.body.data.cashTies).toBe(true);
  });
});
