import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';
import { GHANA_SME_CHART_OF_ACCOUNTS_TEMPLATE } from '../data/ghanaSmeChartOfAccountsTemplate';
import * as accountRepository from '../repository/accountRepository';
import type { AccountRecord } from '../repository/accountRepository';

function makeAccount(overrides: Partial<AccountRecord>): AccountRecord {
  return {
    id: 'x',
    code: '0000',
    name: 'Test',
    type: 'ASSET',
    parentId: null,
    currency: 'USD',
    isActive: true,
    isCashEquivalent: false,
    defaultRole: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('Account default-role resolution (fixes silent revenue/cash misposting)', () => {
  describe('resolveDefaultAccount - pure resolution logic', () => {
    it('prefers an explicitly designated account over anything else', () => {
      const accounts = [
        makeAccount({ id: 'a', code: '4010', type: 'REVENUE' }),
        makeAccount({ id: 'b', code: '4000', type: 'REVENUE', defaultRole: 'REVENUE' }),
      ];
      expect(accountRepository.resolveDefaultAccount(accounts, 'REVENUE')?.id).toBe('b');
    });

    it('falls back to the legacy code convention when nothing is designated', () => {
      const accounts = [
        makeAccount({ id: 'a', code: '1000', type: 'ASSET' }),
        makeAccount({ id: 'b', code: '1010', type: 'ASSET' }),
      ];
      expect(accountRepository.resolveDefaultAccount(accounts, 'CASH')?.id).toBe('b');
    });

    it('this is the exact bug: without a designation or the legacy code, it must fall back to a REVENUE-type account, never an ASSET account', () => {
      // Mirrors the platform's own Ghana SME starter template: Sales Revenue
      // is coded 4000 (not 4010, the old hardcoded lookup), and Cash Till is
      // coded 1010. Before this fix, revenue resolution had no type-based
      // fallback at all and would have silently returned Cash Till here.
      const cashTill = makeAccount({ id: 'cash', code: '1010', name: 'Cash Till', type: 'ASSET', isCashEquivalent: true });
      const salesRevenue = makeAccount({ id: 'rev', code: '4000', name: 'Sales Revenue', type: 'REVENUE' });
      const accounts = [cashTill, salesRevenue];

      const resolvedCash = accountRepository.resolveDefaultAccount(accounts, 'CASH');
      const resolvedRevenue = accountRepository.resolveDefaultAccount(accounts, 'REVENUE');

      expect(resolvedCash?.id).toBe('cash');
      expect(resolvedRevenue?.id).toBe('rev');
      // The actual regression this closes: cash and revenue must never
      // resolve to the same account (a self-canceling debit+credit that
      // posts neither real cash received nor real revenue).
      expect(resolvedCash?.id).not.toBe(resolvedRevenue?.id);
    });

    it('returns undefined when no account of a plausible type exists at all', () => {
      const accounts = [makeAccount({ id: 'a', code: '2000', type: 'LIABILITY' })];
      expect(accountRepository.resolveDefaultAccount(accounts, 'REVENUE')).toBeUndefined();
    });
  });

  describe('pickAutoDefaultCandidate - wizard auto-designation heuristic', () => {
    it('picks the lowest-code cash-equivalent ASSET for CASH', () => {
      const accounts = [
        makeAccount({ id: 'a', code: '1020', type: 'ASSET', isCashEquivalent: true }),
        makeAccount({ id: 'b', code: '1010', type: 'ASSET', isCashEquivalent: true }),
        makeAccount({ id: 'c', code: '1000', type: 'ASSET', isCashEquivalent: false }),
      ];
      expect(accountRepository.pickAutoDefaultCandidate(accounts, 'CASH')?.id).toBe('b');
    });

    it('prefers a "Miscellaneous" account for EXPENSE over a lower-code but more specific one', () => {
      const accounts = [
        makeAccount({ id: 'a', code: '6000', name: 'Rent Expense', type: 'EXPENSE' }),
        makeAccount({ id: 'b', code: '6900', name: 'Miscellaneous Expense', type: 'EXPENSE' }),
      ];
      expect(accountRepository.pickAutoDefaultCandidate(accounts, 'EXPENSE')?.id).toBe('b');
    });
  });

  describe('Live tenant: wizard-seeded Ghana SME template auto-designates correctly', () => {
    const runId = Date.now();
    const tenantSlug = `default-role-corp-${runId}`;
    const tenantSchema = `tenant_default_role_corp_${runId}`;
    const adminEmail = `admin_defaultrole_${runId}@corp.com`;

    let adminToken: string;
    let customerId: string;

    async function cleanupTestData() {
      await deleteTenantBySlug(prisma, tenantSlug).catch(() => {});
      await deleteUserByEmail(prisma, adminEmail).catch(() => {});
      await dropTenantSchema(prisma, tenantSchema).catch(() => {});
    }

    function authed(req: request.Test): request.Test {
      return req.set('Authorization', `Bearer ${adminToken}`).set('X-Tenant-ID', tenantSlug);
    }

    beforeAll(async () => {
      await prisma.$connect();
      await ensureTenantTableExists(prisma);
      await ensureUserTableExists(prisma);
      await cleanupTestData();

      const onboard = await onboardTenant(prisma, {
        companyName: 'Default Role Corp',
        slug: tenantSlug,
        adminEmail,
        adminPassword: 'Password123!',
        adminName: 'Default Role Admin',
      });
      adminToken = onboard.token;

      const seedRes = await authed(request(app).post('/api/v1/onboarding/chart-of-accounts/seed')).send({
        accounts: GHANA_SME_CHART_OF_ACCOUNTS_TEMPLATE,
      });
      expect(seedRes.status).toBe(201);

      const customer = await authed(request(app).post('/api/v1/invoices/customers')).send({
        name: 'Default Role Client',
        email: `defaultrole_${runId}@client.com`,
      });
      customerId = customer.body.data.customer.id;
    }, 60000);

    afterAll(async () => {
      await cleanupTestData();
      await prisma.$disconnect();
    });

    it('auto-designates exactly one account per role from the real starter template', async () => {
      const res = await authed(request(app).get('/api/v1/accounts'));
      expect(res.status).toBe(200);
      const accounts = res.body.data.accounts;

      const cashDefaults = accounts.filter((a: any) => a.defaultRole === 'CASH');
      const revenueDefaults = accounts.filter((a: any) => a.defaultRole === 'REVENUE');
      const expenseDefaults = accounts.filter((a: any) => a.defaultRole === 'EXPENSE');

      expect(cashDefaults).toHaveLength(1);
      expect(revenueDefaults).toHaveLength(1);
      expect(expenseDefaults).toHaveLength(1);

      // The actual regression: Sales Revenue is coded 4000 in this template,
      // not the old hardcoded '4010' lookup - it must still be the one
      // designated, not some unrelated account.
      expect(revenueDefaults[0].code).toBe('4000');
      expect(revenueDefaults[0].name).toBe('Sales Revenue');
      // Lowest-code cash-equivalent ASSET wins - Cash on Hand (1000) sorts
      // before Cash Till (1010) and Bank Account (1020), both also
      // cash-equivalent. Fully visible and reassignable in Chart of Accounts.
      expect(cashDefaults[0].code).toBe('1000');
    });

    it('end-to-end proof: paying an invoice actually increases Cash and Sales Revenue, not a self-cancelling no-op', async () => {
      const accountsRes = await authed(request(app).get('/api/v1/accounts'));
      const accounts = accountsRes.body.data.accounts;
      const cashAccount = accounts.find((a: any) => a.defaultRole === 'CASH');
      const revenueAccount = accounts.find((a: any) => a.defaultRole === 'REVENUE');

      const ledgerBefore = await authed(request(app).get('/api/v1/ledgers/summary'));
      const cashBefore = ledgerBefore.body.data.accounts.find((a: any) => a.id === cashAccount.id).closingBalance;
      const revenueBefore = ledgerBefore.body.data.accounts.find((a: any) => a.id === revenueAccount.id).closingBalance;

      const invoiceRes = await authed(request(app).post('/api/v1/invoices')).send({
        customerId,
        items: [{ description: 'Consulting', quantity: 1, unitPrice: 500 }],
      });
      expect(invoiceRes.status).toBe(201);

      const payRes = await authed(request(app).post(`/api/v1/invoices/${invoiceRes.body.data.invoice.id}/pay`));
      expect(payRes.status).toBe(200);

      const ledgerAfter = await authed(request(app).get('/api/v1/ledgers/summary'));
      const cashAfter = ledgerAfter.body.data.accounts.find((a: any) => a.id === cashAccount.id).closingBalance;
      const revenueAfter = ledgerAfter.body.data.accounts.find((a: any) => a.id === revenueAccount.id).closingBalance;

      expect(cashAfter).toBe(cashBefore + 500);
      // Revenue is credit-normal, so closingBalance (debit - credit) moves
      // further negative as real revenue is recognized.
      expect(revenueAfter).toBe(revenueBefore - 500);
    });

    it('PUT /accounts/:id/default-role reassigns atomically - only the new account holds the role afterward', async () => {
      const accountsRes = await authed(request(app).get('/api/v1/accounts'));
      const accounts = accountsRes.body.data.accounts;
      const originalCash = accounts.find((a: any) => a.defaultRole === 'CASH');
      const bankAccount = accounts.find((a: any) => a.code === '1020');

      const res = await authed(request(app).put(`/api/v1/accounts/${bankAccount.id}/default-role`)).send({ role: 'CASH' });
      expect(res.status).toBe(200);
      expect(res.body.data.account.defaultRole).toBe('CASH');

      const afterRes = await authed(request(app).get('/api/v1/accounts'));
      const afterAccounts = afterRes.body.data.accounts;
      const cashDefaults = afterAccounts.filter((a: any) => a.defaultRole === 'CASH');
      expect(cashDefaults).toHaveLength(1);
      expect(cashDefaults[0].id).toBe(bankAccount.id);
      expect(afterAccounts.find((a: any) => a.id === originalCash.id).defaultRole).toBeNull();

      // Restore for subsequent tests in this file.
      await authed(request(app).put(`/api/v1/accounts/${originalCash.id}/default-role`)).send({ role: 'CASH' });
    });

    it('rejects designating a LIABILITY account as the default CASH account', async () => {
      const accountsRes = await authed(request(app).get('/api/v1/accounts'));
      const liabilityAccount = accountsRes.body.data.accounts.find((a: any) => a.type === 'LIABILITY');

      const res = await authed(request(app).put(`/api/v1/accounts/${liabilityAccount.id}/default-role`)).send({ role: 'CASH' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('LIABILITY');
    });

    it('rejects an invalid role value', async () => {
      const accountsRes = await authed(request(app).get('/api/v1/accounts'));
      const anyAccount = accountsRes.body.data.accounts[0];

      const res = await authed(request(app).put(`/api/v1/accounts/${anyAccount.id}/default-role`)).send({ role: 'NOT_A_ROLE' });
      expect(res.status).toBe(400);
    });

    it('clears a role when role: null is sent', async () => {
      const accountsRes = await authed(request(app).get('/api/v1/accounts'));
      const expenseAccount = accountsRes.body.data.accounts.find((a: any) => a.defaultRole === 'EXPENSE');

      const res = await authed(request(app).put(`/api/v1/accounts/${expenseAccount.id}/default-role`)).send({ role: null });
      expect(res.status).toBe(200);
      expect(res.body.data.account.defaultRole).toBeNull();

      // Restore for cleanliness.
      await authed(request(app).put(`/api/v1/accounts/${expenseAccount.id}/default-role`)).send({ role: 'EXPENSE' });
    });
  });
});
