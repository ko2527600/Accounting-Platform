import { deleteAuditLogs } from './testHelpers';
import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { generateJwtToken } from '../utils/jwt';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists, createUser } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';

describe('PUT /api/v1/tenants/members/:id/role - change an existing team member role', () => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tenantSlug = `role-change-corp-${runId}`;
  const tenantSchema = `tenant_role_change_corp_${runId}`;
  const adminEmail = `admin_rolechange_${runId}@corp.com`;
  const accountantEmail = `accountant_rolechange_${runId}@corp.com`;
  const secondAdminEmail = `admin2_rolechange_${runId}@corp.com`;

  let adminToken: string;
  let accountantToken: string;
  let tenantId: string;
  let accountantUserId: string;

  async function cleanupTestData() {
    if (tenantId) {
      await deleteAuditLogs(prisma, { tenantId });
    }
    await deleteTenantBySlug(prisma, tenantSlug).catch(() => {});
    await deleteUserByEmail(prisma, adminEmail).catch(() => {});
    await deleteUserByEmail(prisma, accountantEmail).catch(() => {});
    await deleteUserByEmail(prisma, secondAdminEmail).catch(() => {});
    await dropTenantSchema(prisma, tenantSchema).catch(() => {});
  }

  beforeAll(async () => {
    await prisma.$connect();
    await ensureTenantTableExists(prisma);
    await ensureUserTableExists(prisma);
    await cleanupTestData();

    const onboard = await onboardTenant(prisma, {
      companyName: 'Role Change Corp',
      slug: tenantSlug,
      adminEmail,
      adminPassword: 'Password123!',
      adminName: 'Role Change Admin',
    });
    adminToken = onboard.token;
    tenantId = onboard.tenant.id;
    // onboardTenant() creates the admin as isActive: false (inactive until
    // email/SMS verification) - the lockout guard only counts *active*
    // Admins as "another usable admin", so this test's admin needs to be
    // activated directly, matching what the real verify flow would do.
    await prisma.user.update({ where: { id: onboard.admin.id }, data: { isActive: true } });

    const accountantUser = await createUser(prisma, {
      email: accountantEmail,
      password: 'Password123!',
      name: 'Role Change Accountant',
      role: 'Accountant',
      tenantId,
    });
    accountantUserId = accountantUser.id;
    accountantToken = generateJwtToken({
      id: accountantUser.id,
      email: accountantUser.email,
      role: accountantUser.role,
      tenantId,
    });
  }, 60000);

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it('rejects non-Admin callers', async () => {
    const res = await request(app)
      .put(`/api/v1/tenants/members/${accountantUserId}/role`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ role: 'Admin' });

    expect(res.status).toBe(403);
  });

  it('rejects an unrecognized role', async () => {
    const res = await request(app)
      .put(`/api/v1/tenants/members/${accountantUserId}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ role: 'Superuser' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 404 for a member outside the tenant', async () => {
    const res = await request(app)
      .put('/api/v1/tenants/members/00000000-0000-0000-0000-000000000000/role')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ role: 'Admin' });

    expect(res.status).toBe(404);
  });

  it('changes an existing member role as Admin and records an audit log entry', async () => {
    const res = await request(app)
      .put(`/api/v1/tenants/members/${accountantUserId}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ role: 'Admin' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.role).toBe('Admin');

    const dbUser = await prisma.user.findUnique({ where: { id: accountantUserId } });
    expect(dbUser?.role).toBe('Admin');

    const auditRows = await prisma.auditLog.findMany({
      where: { tenantId, action: 'TEAM_MEMBER.ROLE_CHANGED', entityId: accountantUserId },
    });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].changes).toEqual({ role: { from: 'Accountant', to: 'Admin' } });
  });

  it('blocks demoting the tenant\'s only remaining Admin', async () => {
    // At this point in the suite, the original admin and the promoted
    // accountant are both Admins - demoting the original admin should
    // succeed since another Admin (the promoted one) still exists.
    const demoteOriginal = await request(app)
      .put(`/api/v1/tenants/members/${accountantUserId}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ role: 'Viewer' });
    expect(demoteOriginal.status).toBe(200);

    // Now only the original admin remains an Admin - attempting to demote
    // them (even via their own token) must be blocked to avoid a lockout.
    const meRes = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);
    const originalAdminId = meRes.body.data.user.id;

    const lockoutAttempt = await request(app)
      .put(`/api/v1/tenants/members/${originalAdminId}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ role: 'Accountant' });

    expect(lockoutAttempt.status).toBe(400);
    expect(lockoutAttempt.body.error).toContain('only Admin');

    const dbUser = await prisma.user.findUnique({ where: { id: originalAdminId } });
    expect(dbUser?.role).toBe('Admin');
  });
});
