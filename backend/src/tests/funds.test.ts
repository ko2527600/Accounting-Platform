import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';

describe('Funds API (CRUD, tenant isolation, delete-guard against real references)', () => {
  const runId = Date.now();
  const tenant1Slug = `fund-corp-1-${runId}`;
  const tenant1Schema = `tenant_fund_corp_1_${runId}`;
  const admin1Email = `admin_fund1_${runId}@corp1.com`;

  const tenant2Slug = `fund-corp-2-${runId}`;
  const tenant2Schema = `tenant_fund_corp_2_${runId}`;
  const admin2Email = `admin_fund2_${runId}@corp2.com`;

  let token1: string;
  let token2: string;
  let tenant1Id: string | undefined;
  let tenant2Id: string | undefined;
  let cashAccountId: string;
  let revenueAccountId: string;
  let customerId: string;

  async function cleanupTestData() {
    const ids = [tenant1Id, tenant2Id].filter((id): id is string => Boolean(id));
    if (ids.length > 0) {
      await prisma.fund.deleteMany({ where: { tenantId: { in: ids } } }).catch(() => {});
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
      companyName: 'Fund Isolation Corp 1',
      slug: tenant1Slug,
      adminEmail: admin1Email,
      adminPassword: 'Password123!',
      adminName: 'Fund Corp 1 Admin',
    });
    token1 = onboard1.token;
    tenant1Id = onboard1.tenant.id;

    const onboard2 = await onboardTenant(prisma, {
      companyName: 'Fund Isolation Corp 2',
      slug: tenant2Slug,
      adminEmail: admin2Email,
      adminPassword: 'Password123!',
      adminName: 'Fund Corp 2 Admin',
    });
    token2 = onboard2.token;
    tenant2Id = onboard2.tenant.id;

    const cashAcc = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ code: '1010', name: 'Cash on Hand', type: 'ASSET' });
    cashAccountId = cashAcc.body.data.account.id;

    const revenueAcc = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ code: '4010', name: 'Donations', type: 'REVENUE' });
    revenueAccountId = revenueAcc.body.data.account.id;

    const customer = await request(app)
      .post('/api/v1/invoices/customers')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ name: 'Fund Test Donor', email: 'donor@fundtest.test' });
    customerId = customer.body.data.customer.id;
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it('creates a fund with validation on required fields', async () => {
    const missingName = await request(app)
      .post('/api/v1/funds')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ code: 'NONAME' });
    expect(missingName.status).toBe(400);

    const missingCode = await request(app)
      .post('/api/v1/funds')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ name: 'No Code Fund' });
    expect(missingCode.status).toBe(400);

    const ok = await request(app)
      .post('/api/v1/funds')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ name: 'Building Fund', code: 'BUILDING', description: 'Restricted roof grant', isRestricted: true });
    expect(ok.status).toBe(201);
    expect(ok.body.data.fund.isRestricted).toBe(true);
    expect(ok.body.data.fund.isActive).toBe(true);
  });

  it('rejects duplicate codes within the same tenant, but allows the same code in a different tenant', async () => {
    const first = await request(app)
      .post('/api/v1/funds')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ name: 'General Fund', code: 'GENERAL', isRestricted: false });
    expect(first.status).toBe(201);

    const duplicate = await request(app)
      .post('/api/v1/funds')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ name: 'General Fund Again', code: 'GENERAL' });
    expect(duplicate.status).toBe(409);

    const otherTenantSameCode = await request(app)
      .post('/api/v1/funds')
      .set('Authorization', `Bearer ${token2}`)
      .set('X-Tenant-ID', tenant2Slug)
      .send({ name: 'General Fund (Tenant 2)', code: 'GENERAL' });
    expect(otherTenantSameCode.status).toBe(201);
  });

  it('does not let one tenant see, fetch, update, or delete another tenant\'s funds (404s, never 403s)', async () => {
    const created = await request(app)
      .post('/api/v1/funds')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ name: 'Cross-Tenant Probe Fund', code: 'PROBE' });
    const fundId = created.body.data.fund.id;

    const list1 = await request(app)
      .get('/api/v1/funds')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug);
    const list2 = await request(app)
      .get('/api/v1/funds')
      .set('Authorization', `Bearer ${token2}`)
      .set('X-Tenant-ID', tenant2Slug);
    expect(list1.body.data.funds.map((f: any) => f.code)).toContain('PROBE');
    expect(list2.body.data.funds.map((f: any) => f.code)).not.toContain('PROBE');

    const crossFetch = await request(app)
      .get(`/api/v1/funds/${fundId}`)
      .set('Authorization', `Bearer ${token2}`)
      .set('X-Tenant-ID', tenant2Slug);
    expect(crossFetch.status).toBe(404);

    const crossUpdate = await request(app)
      .put(`/api/v1/funds/${fundId}`)
      .set('Authorization', `Bearer ${token2}`)
      .set('X-Tenant-ID', tenant2Slug)
      .send({ name: 'Hijacked' });
    expect(crossUpdate.status).toBe(404);

    const crossDelete = await request(app)
      .delete(`/api/v1/funds/${fundId}`)
      .set('Authorization', `Bearer ${token2}`)
      .set('X-Tenant-ID', tenant2Slug);
    expect(crossDelete.status).toBe(404);
  });

  it('blocks deleting a fund referenced by an invoice - suggests deactivating instead - and deactivate succeeds', async () => {
    const fund = await request(app)
      .post('/api/v1/funds')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ name: 'Delete Guard Fund', code: 'DELGUARD' });
    const fundId = fund.body.data.fund.id;

    const invoice = await request(app)
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ customerId, fundId, items: [{ description: 'Donation', quantity: 1, unitPrice: 500 }] });
    expect(invoice.status).toBe(201);
    expect(invoice.body.data.invoice.fundId).toBe(fundId);

    const deleteAttempt = await request(app)
      .delete(`/api/v1/funds/${fundId}`)
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug);
    expect(deleteAttempt.status).toBe(400);
    expect(deleteAttempt.body.error).toMatch(/deactivat/i);

    const deactivate = await request(app)
      .put(`/api/v1/funds/${fundId}`)
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ isActive: false });
    expect(deactivate.status).toBe(200);
    expect(deactivate.body.data.fund.isActive).toBe(false);
  });

  it('rejects creating an invoice with a nonexistent or cross-tenant fundId', async () => {
    const bogus = await request(app)
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ customerId, fundId: '00000000-0000-0000-0000-000000000000', items: [{ description: 'x', quantity: 1, unitPrice: 10 }] });
    expect(bogus.status).toBe(400);

    const otherTenantFund = await request(app)
      .post('/api/v1/funds')
      .set('Authorization', `Bearer ${token2}`)
      .set('X-Tenant-ID', tenant2Slug)
      .send({ name: 'Tenant 2 Fund', code: 'T2FUND' });
    const otherFundId = otherTenantFund.body.data.fund.id;

    const crossTenantFundOnInvoice = await request(app)
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ customerId, fundId: otherFundId, items: [{ description: 'x', quantity: 1, unitPrice: 10 }] });
    expect(crossTenantFundOnInvoice.status).toBe(400);
  });

  it('blocks deleting a fund referenced by a journal entry line', async () => {
    const fund = await request(app)
      .post('/api/v1/funds')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ name: 'JE-Referenced Fund', code: 'JEFUND' });
    const fundId = fund.body.data.fund.id;

    const je = await request(app)
      .post('/api/v1/journal-entries')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({
        entryNumber: `JE-FUND-DELGUARD-${runId}`,
        status: 'POSTED',
        lines: [
          { accountId: cashAccountId, debit: 50, credit: 0, fundId },
          { accountId: revenueAccountId, debit: 0, credit: 50, fundId },
        ],
      });
    expect(je.status).toBe(201);

    const deleteAttempt = await request(app)
      .delete(`/api/v1/funds/${fundId}`)
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug);
    expect(deleteAttempt.status).toBe(400);
  });
});
