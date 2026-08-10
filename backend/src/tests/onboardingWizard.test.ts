import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';
import { GHANA_SME_CHART_OF_ACCOUNTS_TEMPLATE } from '../data/ghanaSmeChartOfAccountsTemplate';

describe('Guided onboarding wizard (Phase 3 trust feature - hard trial-balance gate)', () => {
  const runId = Date.now();
  const tenantSlug = `onboard-wizard-corp-${runId}`;
  const tenantSchema = `tenant_onboard_wizard_corp_${runId}`;
  const adminEmail = `admin_onboardwizard_${runId}@corp.com`;

  let adminToken: string;
  let tenantId: string;

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
      companyName: 'Onboard Wizard Corp',
      slug: tenantSlug,
      adminEmail,
      adminPassword: 'Password123!',
      adminName: 'Onboard Wizard Admin',
    });
    adminToken = onboard.token;
    tenantId = onboard.tenant.id;
  }, 60000);

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  function authed(req: request.Test): request.Test {
    return req.set('Authorization', `Bearer ${adminToken}`).set('X-Tenant-ID', tenantSlug);
  }

  it('starts with an incomplete checklist for a freshly onboarded tenant', async () => {
    const res = await authed(request(app).get('/api/v1/onboarding/status'));
    expect(res.status).toBe(200);
    expect(res.body.data.checklist).toEqual({
      businessProfileComplete: false,
      chartOfAccountsReady: false,
      openingBalancesPosted: false,
      firstTransactionRecorded: false,
    });
    expect(res.body.data.isLive).toBe(false);
  });

  it('PUT /business-profile records business type, VAT/GRA status, and marks that checklist item done', async () => {
    const res = await authed(request(app).put('/api/v1/onboarding/business-profile')).send({
      businessType: 'Sole Proprietor',
      vatRegistered: true,
      graTin: 'TIN-12345',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.checklist.businessProfileComplete).toBe(true);
    expect(res.body.data.businessType).toBe('Sole Proprietor');
    expect(res.body.data.vatRegistered).toBe(true);
  });

  it('GET /chart-of-accounts-template returns the real Ghana SME default template', async () => {
    const res = await authed(request(app).get('/api/v1/onboarding/chart-of-accounts-template'));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(GHANA_SME_CHART_OF_ACCOUNTS_TEMPLATE.length);
    expect(res.body.data.find((a: any) => a.code === '1010').name).toBe('Cash Till');
  });

  it('POST /chart-of-accounts/seed creates the template accounts and marks that checklist item done', async () => {
    const res = await authed(request(app).post('/api/v1/onboarding/chart-of-accounts/seed')).send({
      accounts: GHANA_SME_CHART_OF_ACCOUNTS_TEMPLATE,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.created).toBe(GHANA_SME_CHART_OF_ACCOUNTS_TEMPLATE.length);

    const statusRes = await authed(request(app).get('/api/v1/onboarding/status'));
    expect(statusRes.body.data.checklist.chartOfAccountsReady).toBe(true);
    expect(statusRes.body.data.accountCount).toBe(GHANA_SME_CHART_OF_ACCOUNTS_TEMPLATE.length);
  });

  it('re-running the seed skips accounts that already exist instead of erroring', async () => {
    const res = await authed(request(app).post('/api/v1/onboarding/chart-of-accounts/seed')).send({
      accounts: GHANA_SME_CHART_OF_ACCOUNTS_TEMPLATE,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.created).toBe(0);
    expect(res.body.data.skippedExisting.length).toBe(GHANA_SME_CHART_OF_ACCOUNTS_TEMPLATE.length);
  });

  describe('POST /opening-balances - the hard trial-balance gate', () => {
    let cashAccountId: string;
    let equityAccountId: string;

    beforeAll(async () => {
      const accountsRes = await authed(request(app).get('/api/v1/accounts'));
      const accounts = accountsRes.body.data.accounts;
      cashAccountId = accounts.find((a: any) => a.code === '1000').id;
      equityAccountId = accounts.find((a: any) => a.code === '3000').id;
    });

    it('rejects an unbalanced set of opening balances with a clear debits-vs-credits error, and does NOT flip isLive', async () => {
      const res = await authed(request(app).post('/api/v1/onboarding/opening-balances')).send({
        asOfDate: '2026-08-01',
        lines: [
          { accountId: cashAccountId, debit: 5000, credit: 0 },
          { accountId: equityAccountId, debit: 0, credit: 4000 },
        ],
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Total Debits.*must equal Total Credits/);
      expect(res.body.error).toContain('5000');
      expect(res.body.error).toContain('4000');

      const statusRes = await authed(request(app).get('/api/v1/onboarding/status'));
      expect(statusRes.body.data.isLive).toBe(false);
      expect(statusRes.body.data.checklist.openingBalancesPosted).toBe(false);
    });

    it('accepts a genuinely balanced set of opening balances, posts a real journal entry, and flips isLive true', async () => {
      const res = await authed(request(app).post('/api/v1/onboarding/opening-balances')).send({
        asOfDate: '2026-08-01',
        lines: [
          { accountId: cashAccountId, debit: 5000, credit: 0 },
          { accountId: equityAccountId, debit: 0, credit: 5000 },
        ],
      });

      expect(res.status).toBe(201);
      expect(res.body.data.entryNumber).toMatch(/^OB-/);

      const je = await request(app)
        .get(`/api/v1/journal-entries/${res.body.data.journalEntryId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug);
      expect(je.body.data.journalEntry.status).toBe('POSTED');

      const statusRes = await authed(request(app).get('/api/v1/onboarding/status'));
      expect(statusRes.body.data.isLive).toBe(true);
      expect(statusRes.body.data.checklist.openingBalancesPosted).toBe(true);
    });
  });
});
