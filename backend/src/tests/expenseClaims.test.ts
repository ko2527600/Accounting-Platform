import { deleteAuditLogs } from './testHelpers';
import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';

describe('Expense Claims (submit / approve / reject / reimburse)', () => {
  const runId = Date.now();
  const tenantSlug = `expense-corp-${runId}`;
  const tenantSchema = `tenant_expense_corp_${runId}`;
  const adminEmail = `admin_expense_${runId}@corp.com`;
  const viewerEmail = `viewer_expense_${runId}@corp.com`;
  const hrEmail = `hr_expense_${runId}@corp.com`;

  let adminToken: string;
  let viewerToken: string;
  let hrToken: string;
  let tenantId: string;
  let cashAccountId: string;
  let expenseAccountId: string;

  async function cleanupTestData() {
    if (tenantId) {
      await deleteAuditLogs(prisma, { tenantId });
    }
    await deleteTenantBySlug(prisma, tenantSlug).catch(() => {});
    await deleteUserByEmail(prisma, adminEmail).catch(() => {});
    await deleteUserByEmail(prisma, viewerEmail).catch(() => {});
    await deleteUserByEmail(prisma, hrEmail).catch(() => {});
    await dropTenantSchema(prisma, tenantSchema).catch(() => {});
  }

  async function submitClaim(amount = 150, extra: any = {}) {
    const res = await request(app)
      .post('/api/v1/expense-claims')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({
        category: 'Travel',
        description: 'Taxi to client meeting',
        amount,
        currency: 'USD',
        expenseDate: '2026-08-01',
        ...extra,
      });
    expect(res.status).toBe(201);
    return res.body.data.expenseClaim;
  }

  beforeAll(async () => {
    await prisma.$connect();
    await ensureTenantTableExists(prisma);
    await ensureUserTableExists(prisma);
    await cleanupTestData();

    const onboard = await onboardTenant(prisma, {
      companyName: 'Expense Corp',
      slug: tenantSlug,
      adminEmail,
      adminPassword: 'Password123!',
      adminName: 'Expense Admin',
      tier: 3, // Approval Workflows (GET /approval-workflows/:id used below) is a Business+ feature (requireTier gate) - not what this file tests.
    });
    adminToken = onboard.token;
    tenantId = onboard.tenant.id;

    const cashAcc = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ code: '1010', name: 'Cash & Bank', type: 'ASSET' });
    cashAccountId = cashAcc.body.data.account.id;

    const expAcc = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ code: '5010', name: 'Travel & Entertainment Expense', type: 'EXPENSE' });
    expenseAccountId = expAcc.body.data.account.id;

    const invite = await request(app)
      .post('/api/v1/tenants/invite')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ email: viewerEmail, role: 'Viewer' });
    const accept = await request(app)
      .post('/api/v1/auth/accept-invitation')
      .send({ token: invite.body.data.invitation.token, name: 'Expense Viewer', password: 'Password123!' });
    viewerToken = accept.body.data.token;

    const hrInvite = await request(app)
      .post('/api/v1/tenants/invite')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ email: hrEmail, role: 'HR' });
    const hrAccept = await request(app)
      .post('/api/v1/auth/accept-invitation')
      .send({ token: hrInvite.body.data.invitation.token, name: 'Expense HR', password: 'Password123!' });
    hrToken = hrAccept.body.data.token;
  }, 120000);

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it('rejects a claim with a non-positive amount or missing fields', async () => {
    const res = await request(app)
      .post('/api/v1/expense-claims')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ category: 'Travel', description: 'Bad claim', amount: 0, expenseDate: '2026-08-01' });
    expect(res.status).toBe(400);
  });

  it('lets any tenant member (including Viewer) file a claim, creating a real pending approval workflow', async () => {
    const res = await request(app)
      .post('/api/v1/expense-claims')
      .set('Authorization', `Bearer ${viewerToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ category: 'Supplies', description: 'Notebooks', amount: 25, expenseDate: '2026-08-01' });

    expect(res.status).toBe(201);
    expect(res.body.data.expenseClaim.status).toBe('PENDING_APPROVAL');
    expect(res.body.data.expenseClaim.approvalWorkflowId).toBeTruthy();
    expect(res.body.data.expenseClaim.submittedByName).toBe('Expense Viewer');

    const wfRes = await request(app)
      .get(`/api/v1/approval-workflows/${res.body.data.expenseClaim.approvalWorkflowId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);
    expect(wfRes.body.data.approvalWorkflow.entityType).toBe('ExpenseClaim');
    expect(wfRes.body.data.approvalWorkflow.entityId).toBe(res.body.data.expenseClaim.id);
  });

  it('rejects a Viewer from deciding or reimbursing a claim (Accountant-only actions)', async () => {
    const claim = await submitClaim();
    const decideRes = await request(app)
      .post(`/api/v1/expense-claims/${claim.id}/decide`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ decision: 'APPROVE' });
    expect(decideRes.status).toBe(403);
  });

  it('lets HR view and file claims (a "scoped" role that needs explicit listing, unlike hierarchy-based roles) but not decide them', async () => {
    const listRes = await request(app)
      .get('/api/v1/expense-claims')
      .set('Authorization', `Bearer ${hrToken}`)
      .set('X-Tenant-ID', tenantSlug);
    expect(listRes.status).toBe(200);

    const submitRes = await request(app)
      .post('/api/v1/expense-claims')
      .set('Authorization', `Bearer ${hrToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ category: 'Supplies', description: 'Stationery', amount: 15, expenseDate: '2026-08-01' });
    expect(submitRes.status).toBe(201);
    expect(submitRes.body.data.expenseClaim.submittedByName).toBe('Expense HR');

    const decideRes = await request(app)
      .post(`/api/v1/expense-claims/${submitRes.body.data.expenseClaim.id}/decide`)
      .set('Authorization', `Bearer ${hrToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ decision: 'APPROVE' });
    expect(decideRes.status).toBe(403);
  });

  it('approves a claim then reimburses it with a real Expense/Cash journal entry', async () => {
    const claim = await submitClaim(200, { expenseAccountId });

    const beforeLedger = await request(app)
      .get('/api/v1/ledgers/summary')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);
    const cashBefore = beforeLedger.body.data.accounts.find((a: any) => a.id === cashAccountId).closingBalance;
    const expenseBefore = beforeLedger.body.data.accounts.find((a: any) => a.id === expenseAccountId).closingBalance;

    const decideRes = await request(app)
      .post(`/api/v1/expense-claims/${claim.id}/decide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ decision: 'APPROVE', comments: 'Looks right' });
    expect(decideRes.status).toBe(200);
    expect(decideRes.body.data.expenseClaim.status).toBe('APPROVED');

    const reimburseRes = await request(app)
      .post(`/api/v1/expense-claims/${claim.id}/reimburse`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);
    expect(reimburseRes.status).toBe(200);
    expect(reimburseRes.body.data.expenseClaim.status).toBe('REIMBURSED');
    expect(reimburseRes.body.data.expenseClaim.journalId).toBeTruthy();

    const afterLedger = await request(app)
      .get('/api/v1/ledgers/summary')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);
    const cashAfter = afterLedger.body.data.accounts.find((a: any) => a.id === cashAccountId).closingBalance;
    const expenseAfter = afterLedger.body.data.accounts.find((a: any) => a.id === expenseAccountId).closingBalance;
    // Cash is debit-normal (closingBalance = debit - credit), so a $200 payout moves it down.
    expect(cashAfter).toBe(cashBefore - 200);
    // Expense is also debit-normal, so recording $200 of expense moves it up.
    expect(expenseAfter).toBe(expenseBefore + 200);
  });

  it('rejects reimbursing a claim that is not yet APPROVED', async () => {
    const claim = await submitClaim(50);
    const res = await request(app)
      .post(`/api/v1/expense-claims/${claim.id}/reimburse`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);
    expect(res.status).toBe(400);
  });

  it('rejects the claim and leaves it un-reimbursable when a decision is REJECT', async () => {
    const claim = await submitClaim(75);
    const decideRes = await request(app)
      .post(`/api/v1/expense-claims/${claim.id}/decide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ decision: 'REJECT', comments: 'No receipt attached' });
    expect(decideRes.status).toBe(200);
    expect(decideRes.body.data.expenseClaim.status).toBe('REJECTED');

    const reimburseRes = await request(app)
      .post(`/api/v1/expense-claims/${claim.id}/reimburse`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);
    expect(reimburseRes.status).toBe(400);
  });

  it('rejects deciding a claim twice', async () => {
    const claim = await submitClaim(60);
    await request(app)
      .post(`/api/v1/expense-claims/${claim.id}/decide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ decision: 'APPROVE' });

    const secondDecide = await request(app)
      .post(`/api/v1/expense-claims/${claim.id}/decide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ decision: 'REJECT' });
    expect(secondDecide.status).toBe(400);
  });

  it('rejects submitting a claim against a non-EXPENSE account', async () => {
    const res = await request(app)
      .post('/api/v1/expense-claims')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({
        category: 'Travel',
        description: 'Bad account',
        amount: 100,
        expenseDate: '2026-08-01',
        expenseAccountId: cashAccountId,
      });
    expect(res.status).toBe(400);
  });

  it('lists only the caller\'s own claims when mine=true', async () => {
    await submitClaim(30);
    const res = await request(app)
      .get('/api/v1/expense-claims?mine=true')
      .set('Authorization', `Bearer ${viewerToken}`)
      .set('X-Tenant-ID', tenantSlug);
    expect(res.status).toBe(200);
    expect(res.body.data.expenseClaims.every((c: any) => c.submittedByName === 'Expense Viewer')).toBe(true);
  });
});
