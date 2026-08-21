import { deleteAuditLogs } from './testHelpers';
import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { generateJwtToken } from '../utils/jwt';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists, createUser } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';

describe('DELETE /api/v1/tenants/members/:id - remove an existing team member', () => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tenantSlug = `member-removal-corp-${runId}`;
  const tenantSchema = `tenant_member_removal_corp_${runId}`;
  const adminEmail = `admin_removal_${runId}@corp.com`;
  const accountantEmail = `accountant_removal_${runId}@corp.com`;
  const secondAdminEmail = `admin2_removal_${runId}@corp.com`;

  let adminToken: string;
  let accountantToken: string;
  let secondAdminToken: string;
  let tenantId: string;
  let accountantUserId: string;
  let secondAdminUserId: string;
  let originalAdminId: string;

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
      companyName: 'Member Removal Corp',
      slug: tenantSlug,
      adminEmail,
      adminPassword: 'Password123!',
      adminName: 'Removal Admin',
    });
    adminToken = onboard.token;
    tenantId = onboard.tenant.id;
    originalAdminId = onboard.admin.id;
    await prisma.user.update({ where: { id: originalAdminId }, data: { isActive: true } });

    const accountantUser = await createUser(prisma, {
      email: accountantEmail,
      password: 'Password123!',
      name: 'Removal Accountant',
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

    const secondAdminUser = await createUser(prisma, {
      email: secondAdminEmail,
      password: 'Password123!',
      name: 'Removal Second Admin',
      role: 'Admin',
      tenantId,
      isActive: true,
    } as any);
    secondAdminUserId = secondAdminUser.id;
    secondAdminToken = generateJwtToken({
      id: secondAdminUser.id,
      email: secondAdminUser.email,
      role: secondAdminUser.role,
      tenantId,
    });
  }, 60000);

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it('rejects non-Admin callers', async () => {
    const res = await request(app)
      .delete(`/api/v1/tenants/members/${accountantUserId}`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .set('X-Tenant-ID', tenantSlug);

    expect(res.status).toBe(403);
  });

  it('rejects removing your own account', async () => {
    const res = await request(app)
      .delete(`/api/v1/tenants/members/${originalAdminId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('own account');
  });

  it('returns 404 for a member outside the tenant', async () => {
    const res = await request(app)
      .delete('/api/v1/tenants/members/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);

    expect(res.status).toBe(404);
  });

  it('removes an existing team member as Admin, frees their email, and records an audit log entry', async () => {
    const res = await request(app)
      .delete(`/api/v1/tenants/members/${accountantUserId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const dbUser = await prisma.user.findUnique({ where: { id: accountantUserId } });
    expect(dbUser).toBeNull();

    const auditRows = await prisma.auditLog.findMany({
      where: { tenantId, action: 'TEAM_MEMBER.REMOVED', entityId: accountantUserId },
    });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].details).toContain(accountantEmail);

    // The email is now free to be reused for a brand-new account elsewhere.
    const reusable = await prisma.user.findUnique({ where: { email: accountantEmail } });
    expect(reusable).toBeNull();
  });

  it('blocks removing the tenant\'s only other active Admin when the caller\'s own account has since been deactivated', async () => {
    // Self-removal is already unconditionally blocked, so the only way the
    // "don't leave the tenant with zero active Admins" guard can actually
    // fire is this edge case: the caller holds a still-valid JWT (issued
    // before their account was deactivated) and tries to remove the
    // tenant's only *other* active Admin - the caller no longer counts as
    // "another admin" once inactive, so removing the target would leave
    // the tenant with zero admins able to log in.
    await prisma.user.update({ where: { id: secondAdminUserId }, data: { isActive: false } });

    const res = await request(app)
      .delete(`/api/v1/tenants/members/${originalAdminId}`)
      .set('Authorization', `Bearer ${secondAdminToken}`)
      .set('X-Tenant-ID', tenantSlug);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('only Admin');

    const dbUser = await prisma.user.findUnique({ where: { id: originalAdminId } });
    expect(dbUser).not.toBeNull();

    // Restore for a clean afterAll cleanup pass.
    await prisma.user.update({ where: { id: secondAdminUserId }, data: { isActive: true } });
  });
});
