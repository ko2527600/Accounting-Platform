import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';

describe('Approval Workflows API (multi-level, opt-in posting/payment gate)', () => {
  const runId = Date.now();
  const tenant1Slug = `approval-corp-1-${runId}`;
  const tenant1Schema = `tenant_approval_corp_1_${runId}`;
  const admin1Email = `admin_approval1_${runId}@corp1.com`;

  const tenant2Slug = `approval-corp-2-${runId}`;
  const tenant2Schema = `tenant_approval_corp_2_${runId}`;
  const admin2Email = `admin_approval2_${runId}@corp2.com`;

  let token1: string;
  let token2: string;
  let tenant1Id: string | undefined;
  let tenant2Id: string | undefined;
  let cashAccountId: string;
  let revenueAccountId: string;

  async function cleanupTestData() {
    const ids = [tenant1Id, tenant2Id].filter((id): id is string => Boolean(id));
    if (ids.length > 0) {
      await prisma.approvalWorkflow.deleteMany({ where: { tenantId: { in: ids } } }).catch(() => {});
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
      companyName: 'Approval Isolation Corp 1',
      slug: tenant1Slug,
      adminEmail: admin1Email,
      adminPassword: 'Password123!',
      adminName: 'Approval Corp 1 Admin',
      tier: 3, // Approval Workflows is a Business+ feature (requireTier gate) - not what this file tests.
    });
    token1 = onboard1.token;
    tenant1Id = onboard1.tenant.id;

    const onboard2 = await onboardTenant(prisma, {
      companyName: 'Approval Isolation Corp 2',
      slug: tenant2Slug,
      adminEmail: admin2Email,
      adminPassword: 'Password123!',
      adminName: 'Approval Corp 2 Admin',
      tier: 3, // Approval Workflows is a Business+ feature (requireTier gate) - not what this file tests.
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

  it('a DRAFT journal entry posts freely when no approval workflow was ever requested', async () => {
    const draft = await request(app)
      .post('/api/v1/journal-entries')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({
        description: 'No-approval-needed entry',
        status: 'DRAFT',
        lines: [
          { accountId: cashAccountId, debit: 50, credit: 0 },
          { accountId: revenueAccountId, debit: 0, credit: 50 },
        ],
      });
    expect(draft.status).toBe(201);

    const posted = await request(app)
      .post(`/api/v1/journal-entries/${draft.body.data.journalEntry.id}/post`)
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug);
    expect(posted.status).toBe(200);
  });

  it('blocks posting once a 2-level approval workflow is requested, until both levels approve', async () => {
    const draft = await request(app)
      .post('/api/v1/journal-entries')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({
        description: 'Needs two-level approval',
        status: 'DRAFT',
        lines: [
          { accountId: cashAccountId, debit: 300, credit: 0 },
          { accountId: revenueAccountId, debit: 0, credit: 300 },
        ],
      });
    const entryId = draft.body.data.journalEntry.id;

    const workflowRes = await request(app)
      .post('/api/v1/approval-workflows')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ entityType: 'JournalEntry', entityId: entryId, requiredLevel: 2 });
    expect(workflowRes.status).toBe(201);
    const workflowId = workflowRes.body.data.approvalWorkflow.id;
    expect(workflowRes.body.data.approvalWorkflow.approvals.length).toBe(2);

    const blockedPost = await request(app)
      .post(`/api/v1/journal-entries/${entryId}/post`)
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug);
    expect(blockedPost.status).toBe(400);

    // Cannot skip ahead to level 2 before level 1 is decided.
    const outOfOrder = await request(app)
      .post(`/api/v1/approval-workflows/${workflowId}/steps/2/decide`)
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ decision: 'APPROVE' });
    expect(outOfOrder.status).toBe(400);

    const level1Approve = await request(app)
      .post(`/api/v1/approval-workflows/${workflowId}/steps/1/decide`)
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ decision: 'APPROVE' });
    expect(level1Approve.status).toBe(200);
    expect(level1Approve.body.data.approvalWorkflow.status).toBe('PENDING');

    const stillBlocked = await request(app)
      .post(`/api/v1/journal-entries/${entryId}/post`)
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug);
    expect(stillBlocked.status).toBe(400);

    const level2Approve = await request(app)
      .post(`/api/v1/approval-workflows/${workflowId}/steps/2/decide`)
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ decision: 'APPROVE' });
    expect(level2Approve.status).toBe(200);
    expect(level2Approve.body.data.approvalWorkflow.status).toBe('APPROVED');

    const finallyPosted = await request(app)
      .post(`/api/v1/journal-entries/${entryId}/post`)
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug);
    expect(finallyPosted.status).toBe(200);
  });

  it('a rejection at any level permanently blocks the entity and cannot be re-decided', async () => {
    const draft = await request(app)
      .post('/api/v1/journal-entries')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({
        description: 'Will be rejected',
        status: 'DRAFT',
        lines: [
          { accountId: cashAccountId, debit: 75, credit: 0 },
          { accountId: revenueAccountId, debit: 0, credit: 75 },
        ],
      });
    const entryId = draft.body.data.journalEntry.id;

    const workflowRes = await request(app)
      .post('/api/v1/approval-workflows')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ entityType: 'JournalEntry', entityId: entryId, requiredLevel: 1 });
    const workflowId = workflowRes.body.data.approvalWorkflow.id;

    const rejectRes = await request(app)
      .post(`/api/v1/approval-workflows/${workflowId}/steps/1/decide`)
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ decision: 'REJECT', comments: 'Not this quarter' });
    expect(rejectRes.status).toBe(200);
    expect(rejectRes.body.data.approvalWorkflow.status).toBe('REJECTED');

    const blockedPost = await request(app)
      .post(`/api/v1/journal-entries/${entryId}/post`)
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug);
    expect(blockedPost.status).toBe(400);

    const cannotRedecide = await request(app)
      .post(`/api/v1/approval-workflows/${workflowId}/steps/1/decide`)
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ decision: 'APPROVE' });
    expect(cannotRedecide.status).toBe(400);
  });

  it('records APPROVAL_WORKFLOW.CREATED and .DECIDED audit log entries', async () => {
    const draft = await request(app)
      .post('/api/v1/journal-entries')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({
        description: 'Audit test entry',
        status: 'DRAFT',
        lines: [
          { accountId: cashAccountId, debit: 10, credit: 0 },
          { accountId: revenueAccountId, debit: 0, credit: 10 },
        ],
      });
    const entryId = draft.body.data.journalEntry.id;

    const workflowRes = await request(app)
      .post('/api/v1/approval-workflows')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ entityType: 'JournalEntry', entityId: entryId, requiredLevel: 1 });
    expect(workflowRes.status).toBe(201);
    const workflowId = workflowRes.body.data.approvalWorkflow.id;

    expect(
      await prisma.auditLog.findFirst({ where: { tenantId: tenant1Id, entity: 'ApprovalWorkflow', entityId: workflowId, action: 'APPROVAL_WORKFLOW.CREATED' } })
    ).toBeTruthy();

    const decided = await request(app)
      .post(`/api/v1/approval-workflows/${workflowId}/steps/1/decide`)
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ decision: 'APPROVE' });
    expect(decided.status).toBe(200);

    const decidedLog = await prisma.auditLog.findFirst({ where: { tenantId: tenant1Id, entity: 'ApprovalWorkflow', entityId: workflowId, action: 'APPROVAL_WORKFLOW.DECIDED' } });
    expect(decidedLog).toBeTruthy();
    expect((decidedLog!.changes as any).status).toEqual({ from: 'PENDING', to: 'APPROVED' });
  });

  it('does not let one tenant see or decide another tenant\'s approval workflows', async () => {
    const tenant1List = await request(app)
      .get('/api/v1/approval-workflows')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug);
    const someWorkflowId = tenant1List.body.data.approvalWorkflows[0].id;

    const crossTenantFetch = await request(app)
      .get(`/api/v1/approval-workflows/${someWorkflowId}`)
      .set('Authorization', `Bearer ${token2}`)
      .set('X-Tenant-ID', tenant2Slug);
    expect(crossTenantFetch.status).toBe(404);

    const crossTenantDecide = await request(app)
      .post(`/api/v1/approval-workflows/${someWorkflowId}/steps/1/decide`)
      .set('Authorization', `Bearer ${token2}`)
      .set('X-Tenant-ID', tenant2Slug)
      .send({ decision: 'APPROVE' });
    expect(crossTenantDecide.status).toBe(404);
  });
});
