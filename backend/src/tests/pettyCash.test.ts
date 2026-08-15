import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';

describe('Petty Cash logs', () => {
  const runId = Date.now();
  const tenantSlug = `pettycash-corp-${runId}`;
  const tenantSchema = `tenant_pettycash_corp_${runId}`;
  const adminEmail = `admin_pettycash_${runId}@corp.com`;

  let adminToken: string;
  let pettyCashAccountId: string;
  let expenseAccountId: string;
  let bankAccountId: string;

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
      companyName: 'Petty Cash Corp',
      slug: tenantSlug,
      adminEmail,
      adminPassword: 'Password123!',
      adminName: 'Petty Cash Admin',
    });
    adminToken = onboard.token;

    const pettyCashAcc = await authed(request(app).post('/api/v1/accounts')).send({ code: '1050', name: 'Petty Cash Tin', type: 'ASSET' });
    pettyCashAccountId = pettyCashAcc.body.data.account.id;

    const expenseAcc = await authed(request(app).post('/api/v1/accounts')).send({ code: '5020', name: 'Office Supplies', type: 'EXPENSE' });
    expenseAccountId = expenseAcc.body.data.account.id;

    const bankAcc = await authed(request(app).post('/api/v1/accounts')).send({ code: '1010', name: 'Bank Account', type: 'ASSET' });
    bankAccountId = bankAcc.body.data.account.id;
  }, 60000);

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  async function ledgerBalance(accountId: string) {
    const res = await authed(request(app).get('/api/v1/ledgers/summary'));
    return res.body.data.accounts.find((a: any) => a.id === accountId).closingBalance;
  }

  it('records a replenishment: posts Debit petty cash / Credit funding account, and increases the running balance', async () => {
    const res = await authed(request(app).post('/api/v1/petty-cash')).send({
      direction: 'REPLENISHMENT',
      description: 'Initial top-up from bank',
      amount: 500,
      pettyCashAccountId,
      counterAccountId: bankAccountId,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.entry.direction).toBe('REPLENISHMENT');
    expect(res.body.data.journal.status).toBe('POSTED');

    expect(Number(await ledgerBalance(pettyCashAccountId))).toBe(500);
    expect(Number(await ledgerBalance(bankAccountId))).toBe(-500);
  });

  it('records a disbursement: posts Debit expense / Credit petty cash, and decreases the running balance', async () => {
    const res = await authed(request(app).post('/api/v1/petty-cash')).send({
      direction: 'DISBURSEMENT',
      description: 'Bought printer paper',
      amount: 45,
      pettyCashAccountId,
      counterAccountId: expenseAccountId,
    });
    expect(res.status).toBe(201);

    expect(Number(await ledgerBalance(pettyCashAccountId))).toBe(455);
    expect(Number(await ledgerBalance(expenseAccountId))).toBe(45);
  });

  it('lists entries oldest-first with a correct running balance and current balance', async () => {
    const res = await authed(request(app).get('/api/v1/petty-cash').query({ accountId: pettyCashAccountId }));
    expect(res.status).toBe(200);
    expect(res.body.data.entries).toHaveLength(2);
    expect(res.body.data.entries[0].direction).toBe('REPLENISHMENT');
    expect(res.body.data.entries[0].runningBalance).toBe(500);
    expect(res.body.data.entries[1].direction).toBe('DISBURSEMENT');
    expect(res.body.data.entries[1].runningBalance).toBe(455);
    expect(res.body.data.currentBalance).toBe(455);
  });

  it('rejects the same account as both the petty cash account and the counter account', async () => {
    const res = await authed(request(app).post('/api/v1/petty-cash')).send({
      direction: 'DISBURSEMENT',
      description: 'Invalid',
      amount: 10,
      pettyCashAccountId,
      counterAccountId: pettyCashAccountId,
    });
    expect(res.status).toBe(400);
  });

  it('rejects a non-positive amount', async () => {
    const res = await authed(request(app).post('/api/v1/petty-cash')).send({
      direction: 'DISBURSEMENT',
      description: 'Bad amount',
      amount: 0,
      pettyCashAccountId,
      counterAccountId: expenseAccountId,
    });
    expect(res.status).toBe(400);
  });
});
