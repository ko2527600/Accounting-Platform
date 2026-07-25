import request from 'supertest';
import axios from 'axios';
import app from '../app';
import { prisma } from '../config/db';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

/**
 * Mocking Mono itself (the external service) is legitimate per CLAUDE.md's
 * "mocking external services is allowed for unit testing" - this proves our
 * own request/response mapping and DB persistence logic, not Mono's API.
 */
function mockMonoSuccess(monoAccountId: string) {
  mockedAxios.post.mockResolvedValue({ data: { id: monoAccountId } });
  mockedAxios.get.mockImplementation((url: string) => {
    if (url.includes('/transactions')) {
      return Promise.resolve({
        data: {
          data: [
            { id: `mono-tx-credit-${monoAccountId}`, type: 'credit', amount: 250000, narration: 'Client Payment - Invoice 001', date: new Date().toISOString() },
            { id: `mono-tx-debit-${monoAccountId}`, type: 'debit', amount: 45000, narration: 'AWS Hosting Bill', date: new Date().toISOString() },
          ],
        },
      });
    }
    return Promise.resolve({
      data: {
        account: {
          institution: { name: 'GTBank Ghana' },
          name: 'Main Business Account',
          accountNumber: '0123456789',
          currency: 'GHS',
          balance: 125000,
        },
      },
    });
  });
}

describe('Banking API (POST /connect via Mono, GET /accounts, GET /transactions, POST /reconcile)', () => {
  const runId = Date.now();
  const tenant1Slug = `bank-corp-1-${runId}`;
  const tenant1Schema = `tenant_bank_corp_1_${runId}`;
  const admin1Email = `admin_bank1_${runId}@corp1.com`;

  const tenant2Slug = `bank-corp-2-${runId}`;
  const tenant2Schema = `tenant_bank_corp_2_${runId}`;
  const admin2Email = `admin_bank2_${runId}@corp2.com`;

  let token1: string;
  let token2: string;
  let originalMonoSecretKey: string | undefined;
  let originalMonoWebhookSecret: string | undefined;

  async function cleanupTestData() {
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

    originalMonoSecretKey = process.env.MONO_SECRET_KEY;
    originalMonoWebhookSecret = process.env.MONO_WEBHOOK_SECRET;

    const onboard1 = await onboardTenant(prisma, {
      companyName: 'Bank Isolation Corp 1',
      slug: tenant1Slug,
      adminEmail: admin1Email,
      adminPassword: 'Password123!',
      adminName: 'Bank Corp 1 Admin',
    });
    token1 = onboard1.token;

    const onboard2 = await onboardTenant(prisma, {
      companyName: 'Bank Isolation Corp 2',
      slug: tenant2Slug,
      adminEmail: admin2Email,
      adminPassword: 'Password123!',
      adminName: 'Bank Corp 2 Admin',
    });
    token2 = onboard2.token;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    process.env.MONO_SECRET_KEY = originalMonoSecretKey;
    process.env.MONO_WEBHOOK_SECRET = originalMonoWebhookSecret;
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it('refuses to connect (and creates no fake data) when Mono is not configured', async () => {
    delete process.env.MONO_SECRET_KEY;

    const res = await request(app)
      .post('/api/v1/banking/connect')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ monoCode: 'some-code' });

    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);

    const accountsRes = await request(app)
      .get('/api/v1/banking/accounts')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug);
    expect(accountsRes.body.data.bankAccounts.length).toBe(0);
  });

  it('connects a real bank account via Mono, syncs real transactions, and reconciles one', async () => {
    process.env.MONO_SECRET_KEY = 'test-mono-secret';
    mockMonoSuccess('mono-acc-tenant1');

    const connectRes = await request(app)
      .post('/api/v1/banking/connect')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ monoCode: 'auth-code-from-widget' });

    expect(connectRes.status).toBe(201);
    const bankAccount = connectRes.body.data.bankAccount;
    expect(bankAccount.institutionName).toBe('GTBank Ghana');
    expect(bankAccount.currency).toBe('GHS');
    expect(Number(bankAccount.currentBalance)).toBe(125000);

    const accountsRes = await request(app)
      .get('/api/v1/banking/accounts')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug);
    expect(accountsRes.body.data.bankAccounts.map((a: any) => a.id)).toContain(bankAccount.id);

    const transactionsRes = await request(app)
      .get('/api/v1/banking/transactions')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug);

    expect(transactionsRes.status).toBe(200);
    const payees = transactionsRes.body.data.transactions.map((t: any) => t.payee);
    expect(payees).toContain('Client Payment - Invoice 001');
    expect(payees).toContain('AWS Hosting Bill');
    expect(payees).not.toContain('Acme Client Corp'); // the old hardcoded fake payee

    const txId = transactionsRes.body.data.transactions[0].id;
    const reconcileRes = await request(app)
      .post('/api/v1/banking/reconcile')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ transactionId: txId });

    expect(reconcileRes.status).toBe(200);
    expect(reconcileRes.body.data.transaction.status).toBe('RECONCILED');

    const notFoundRes = await request(app)
      .post('/api/v1/banking/reconcile')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ transactionId: '00000000-0000-0000-0000-000000000000' });
    expect(notFoundRes.status).toBe(404);
  });

  it('does not let one tenant see or reconcile another tenant\'s bank accounts/transactions', async () => {
    process.env.MONO_SECRET_KEY = 'test-mono-secret';
    mockMonoSuccess('mono-acc-tenant1-secret');

    const connectRes = await request(app)
      .post('/api/v1/banking/connect')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ monoCode: 'auth-code-tenant1-secret' });
    const tenant1AccountId = connectRes.body.data.bankAccount.id;

    const tenant2AccountsRes = await request(app)
      .get('/api/v1/banking/accounts')
      .set('Authorization', `Bearer ${token2}`)
      .set('X-Tenant-ID', tenant2Slug);

    expect(tenant2AccountsRes.status).toBe(200);
    expect(tenant2AccountsRes.body.data.bankAccounts.map((a: any) => a.id)).not.toContain(tenant1AccountId);

    const tenant1TransactionsRes = await request(app)
      .get('/api/v1/banking/transactions')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug);
    const tenant1TxId = tenant1TransactionsRes.body.data.transactions.find(
      (t: any) => t.bankAccountId === tenant1AccountId
    ).id;

    const crossTenantReconcile = await request(app)
      .post('/api/v1/banking/reconcile')
      .set('Authorization', `Bearer ${token2}`)
      .set('X-Tenant-ID', tenant2Slug)
      .send({ transactionId: tenant1TxId });

    expect(crossTenantReconcile.status).toBe(404);
  });

  it('manual sync (Sync Feeds) pulls new transactions and updates the balance', async () => {
    process.env.MONO_SECRET_KEY = 'test-mono-secret';
    mockMonoSuccess('mono-acc-sync-test');

    const connectRes = await request(app)
      .post('/api/v1/banking/connect')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ monoCode: 'auth-code-sync-test' });
    const bankAccountId = connectRes.body.data.bankAccount.id;

    // Simulate a new transaction appearing since the initial connect.
    mockedAxios.get.mockImplementation((url: string) => {
      if (url.includes('/transactions')) {
        return Promise.resolve({
          data: {
            data: [
              { id: `mono-tx-credit-mono-acc-sync-test`, type: 'credit', amount: 250000, narration: 'Client Payment - Invoice 001', date: new Date().toISOString() },
              { id: `mono-tx-debit-mono-acc-sync-test`, type: 'debit', amount: 45000, narration: 'AWS Hosting Bill', date: new Date().toISOString() },
              { id: `mono-tx-new-sync-test`, type: 'credit', amount: 99900, narration: 'New Sync Transaction', date: new Date().toISOString() },
            ],
          },
        });
      }
      return Promise.resolve({
        data: { account: { institution: { name: 'GTBank Ghana' }, name: 'Main Business Account', accountNumber: '0123456789', currency: 'GHS', balance: 175000 } },
      });
    });

    const syncRes = await request(app)
      .post(`/api/v1/banking/accounts/${bankAccountId}/sync`)
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug);

    expect(syncRes.status).toBe(200);
    expect(Number(syncRes.body.data.bankAccount.currentBalance)).toBe(175000);

    const transactionsRes = await request(app)
      .get('/api/v1/banking/transactions')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug);
    const payees = transactionsRes.body.data.transactions
      .filter((t: any) => t.bankAccountId === bankAccountId)
      .map((t: any) => t.payee);

    expect(payees).toContain('New Sync Transaction');
    // No duplicates from re-syncing the same two original transactions.
    expect(payees.filter((p: string) => p === 'AWS Hosting Bill').length).toBe(1);
  });

  it('webhook rejects the wrong mono-webhook-secret and accepts + syncs on the correct one', async () => {
    process.env.MONO_SECRET_KEY = 'test-mono-secret';
    process.env.MONO_WEBHOOK_SECRET = 'test-webhook-secret';
    mockMonoSuccess('mono-acc-webhook-test');

    const connectRes = await request(app)
      .post('/api/v1/banking/connect')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ monoCode: 'auth-code-webhook-test' });
    const bankAccountId = connectRes.body.data.bankAccount.id;

    const wrongSecretRes = await request(app)
      .post('/api/v1/banking/webhooks/mono')
      .set('mono-webhook-secret', 'wrong-secret')
      .send({ event: 'mono.events.account_updated', data: { id: 'mono-acc-webhook-test' } });
    expect(wrongSecretRes.status).toBe(401);

    const correctSecretRes = await request(app)
      .post('/api/v1/banking/webhooks/mono')
      .set('mono-webhook-secret', 'test-webhook-secret')
      .send({ event: 'mono.events.account_updated', data: { id: 'mono-acc-webhook-test' } });
    expect(correctSecretRes.status).toBe(200);

    const accountRes = await request(app)
      .get('/api/v1/banking/accounts')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug);
    const synced = accountRes.body.data.bankAccounts.find((a: any) => a.id === bankAccountId);
    expect(synced.lastSyncedAt).not.toBeNull();
  });
});
