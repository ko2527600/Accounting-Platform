import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';

describe('Feedback (every role can submit, Admin/Auditor review)', () => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tenantSlug = `feedback-corp-${runId}`;
  const tenantSchema = `tenant_feedback_corp_${runId}`;
  const adminEmail = `admin_feedback_${runId}@corp.com`;
  const viewerEmail = `viewer_feedback_${runId}@corp.com`;

  const otherTenantSlug = `feedback-corp-other-${runId}`;
  const otherTenantSchema = `tenant_feedback_corp_other_${runId}`;
  const otherAdminEmail = `admin_feedback_other_${runId}@corp.com`;

  let adminToken: string;
  let viewerToken: string;
  let tenantId: string;
  let otherAdminToken: string;

  async function cleanupTestData() {
    if (tenantId) {
      await prisma.feedback.deleteMany({ where: { tenantId } }).catch(() => {});
    }
    await deleteTenantBySlug(prisma, tenantSlug).catch(() => {});
    await deleteUserByEmail(prisma, adminEmail).catch(() => {});
    await deleteUserByEmail(prisma, viewerEmail).catch(() => {});
    await dropTenantSchema(prisma, tenantSchema).catch(() => {});

    await deleteTenantBySlug(prisma, otherTenantSlug).catch(() => {});
    await deleteUserByEmail(prisma, otherAdminEmail).catch(() => {});
    await dropTenantSchema(prisma, otherTenantSchema).catch(() => {});
  }

  function authed(req: request.Test, token: string, slug: string): request.Test {
    return req.set('Authorization', `Bearer ${token}`).set('X-Tenant-ID', slug);
  }

  beforeAll(async () => {
    await prisma.$connect();
    await ensureTenantTableExists(prisma);
    await ensureUserTableExists(prisma);
    await cleanupTestData();

    const onboard = await onboardTenant(prisma, {
      companyName: 'Feedback Corp',
      slug: tenantSlug,
      adminEmail,
      adminPassword: 'Password123!',
      adminName: 'Feedback Admin',
    });
    adminToken = onboard.token;
    tenantId = onboard.tenant.id;

    const invite = await request(app)
      .post('/api/v1/tenants/invite')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ email: viewerEmail, role: 'Viewer' });
    const accept = await request(app)
      .post('/api/v1/auth/accept-invitation')
      .send({ token: invite.body.data.invitation.token, name: 'Feedback Viewer', password: 'Password123!' });
    viewerToken = accept.body.data.token;

    const otherOnboard = await onboardTenant(prisma, {
      companyName: 'Feedback Corp Other',
      slug: otherTenantSlug,
      adminEmail: otherAdminEmail,
      adminPassword: 'Password123!',
      adminName: 'Feedback Other Admin',
    });
    otherAdminToken = otherOnboard.token;
  }, 60000);

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it('rejects an empty message', async () => {
    const res = await authed(request(app).post('/api/v1/feedback'), viewerToken, tenantSlug).send({ message: '   ' });
    expect(res.status).toBe(400);
  });

  it('rejects an unknown category', async () => {
    const res = await authed(request(app).post('/api/v1/feedback'), viewerToken, tenantSlug).send({
      message: 'hello',
      category: 'NOT_A_CATEGORY',
    });
    expect(res.status).toBe(400);
  });

  it('lets a Viewer (or any role) submit feedback, stamping their own name/role', async () => {
    const res = await authed(request(app).post('/api/v1/feedback'), viewerToken, tenantSlug).send({
      message: 'The invoice PDF is missing the tax breakdown.',
      category: 'BUG',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.feedback.userRole).toBe('Viewer');
    expect(res.body.data.feedback.status).toBe('NEW');
  });

  it('rejects a Viewer (scoped, not explicitly granted) from GET /feedback with 403', async () => {
    const res = await authed(request(app).get('/api/v1/feedback'), viewerToken, tenantSlug);
    expect(res.status).toBe(403);
  });

  it('lets Admin list feedback for their tenant, and never another tenant\'s feedback', async () => {
    await authed(request(app).post('/api/v1/feedback'), otherAdminToken, otherTenantSlug).send({
      message: 'Feedback from a completely different tenant.',
    });

    const res = await authed(request(app).get('/api/v1/feedback'), adminToken, tenantSlug);
    expect(res.status).toBe(200);
    const messages = res.body.data.feedback.map((f: any) => f.message);
    expect(messages).toContain('The invoice PDF is missing the tax breakdown.');
    expect(messages).not.toContain('Feedback from a completely different tenant.');
    expect(res.body.data.feedback.every((f: any) => f.tenantId === tenantId)).toBe(true);
  });

  it('lets Admin mark a feedback item reviewed, and it drops out of the NEW-only filter', async () => {
    const created = await authed(request(app).post('/api/v1/feedback'), adminToken, tenantSlug).send({
      message: 'Please add dark mode to the invoice PDF.',
      category: 'FEATURE_REQUEST',
    });
    const id = created.body.data.feedback.id;

    const patch = await authed(request(app).put(`/api/v1/feedback/${id}/status`), adminToken, tenantSlug).send({
      status: 'REVIEWED',
    });
    expect(patch.status).toBe(200);
    expect(patch.body.data.feedback.status).toBe('REVIEWED');

    const newOnly = await authed(request(app).get('/api/v1/feedback').query({ status: 'NEW' }), adminToken, tenantSlug);
    const ids = newOnly.body.data.feedback.map((f: any) => f.id);
    expect(ids).not.toContain(id);
  });

  it("404s marking another tenant's feedback id reviewed", async () => {
    const otherCreated = await authed(request(app).post('/api/v1/feedback'), otherAdminToken, otherTenantSlug).send({
      message: 'Another tenant item to try cross-tenant patch against.',
    });
    const otherId = otherCreated.body.data.feedback.id;

    const res = await authed(request(app).put(`/api/v1/feedback/${otherId}/status`), adminToken, tenantSlug).send({
      status: 'REVIEWED',
    });
    expect(res.status).toBe(404);
  });
});
