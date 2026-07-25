import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';

describe('Banking API (POST /connect, GET /accounts, GET /transactions, POST /reconcile)', () => {
  const runId = Date.now();
  const tenant1Slug = `bank-corp-1-${runId}`;
  const tenant1Schema = `tenant_bank_corp_1_${runId}`;
  const admin1Email = `admin_bank1_${runId}@corp1.com`;

  const tenant2Slug = `bank-corp-2-${runId}`;
  const tenant2Schema = `tenant_bank_corp_2_${runId}`;
  const admin2Email = `admin_bank2_${runId}@corp2.com`;

  let token1: string;
  let token2: string;

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

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it('connects a bank account, lists it and its seeded transactions, and reconciles one', async () => {
    const connectRes = await request(app)
      .post('/api/v1/banking/connect')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ accountName: 'Main Checking', bankName: 'First National', accountNumber: '123456789' });

    expect(connectRes.status).toBe(201);
    const bankAccountId = connectRes.body.data.bankAccount.id;
    expect(bankAccountId).toBeTruthy();

    const accountsRes = await request(app)
      .get('/api/v1/banking/accounts')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug);

    expect(accountsRes.status).toBe(200);
    expect(accountsRes.body.data.bankAccounts.map((a: any) => a.id)).toContain(bankAccountId);

    const transactionsRes = await request(app)
      .get('/api/v1/banking/transactions')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug);

    expect(transactionsRes.status).toBe(200);
    expect(transactionsRes.body.data.transactions.length).toBeGreaterThan(0);
    const txId = transactionsRes.body.data.transactions[0].id;
    expect(transactionsRes.body.data.transactions[0].status).toBe('UNRECONCILED');

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
    const connectRes = await request(app)
      .post('/api/v1/banking/connect')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ accountName: 'Tenant 1 Secret Account', bankName: 'First National', accountNumber: '999999999' });
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
});
