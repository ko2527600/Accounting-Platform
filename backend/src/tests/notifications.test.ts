import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists, createUser } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';
import { generateJwtToken } from '../utils/jwt';

describe('Notifications API - read-all tenant isolation', () => {
  const tenantSlug = 'notif-corp-1';
  const tenantSchema = 'tenant_notif_corp_1';
  const adminEmail = 'admin_notif@corp1.com';
  const secondUserEmail = 'seconduser_notif@corp1.com';

  let tenantId: string;
  let adminToken: string;
  let secondUserToken: string;

  async function cleanupTestData() {
    await deleteTenantBySlug(prisma, tenantSlug).catch(() => {});
    await deleteUserByEmail(prisma, adminEmail).catch(() => {});
    await deleteUserByEmail(prisma, secondUserEmail).catch(() => {});
    await dropTenantSchema(prisma, tenantSchema).catch(() => {});
  }

  beforeAll(async () => {
    await prisma.$connect();
    await ensureTenantTableExists(prisma);
    await ensureUserTableExists(prisma);
    await cleanupTestData();

    const onboard = await onboardTenant(prisma, {
      companyName: 'Notif Corp 1',
      slug: tenantSlug,
      adminEmail,
      adminPassword: 'Password123!',
      adminName: 'Notif Corp 1 Admin',
    });
    tenantId = onboard.tenant.id;
    adminToken = onboard.token;

    const secondUser = await createUser(prisma, {
      email: secondUserEmail,
      password: 'Password123!',
      name: 'Notif Corp 1 Second User',
      role: 'Viewer',
      tenantId,
    });
    secondUserToken = generateJwtToken({
      id: secondUser.id,
      email: secondUser.email,
      role: secondUser.role,
      tenantId,
    });
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it('read-all only marks the caller\'s own and global notifications as read, not other users\' notifications', async () => {
    // Global notification (no owner)
    const globalNotif = await request(app)
      .post('/api/v1/notifications')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ title: 'Global', message: 'Applies to everyone' });
    expect(globalNotif.status).toBe(201);

    const adminMe = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${adminToken}`);
    const adminUserId = adminMe.body.data.user.id;

    const secondUserMe = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${secondUserToken}`);
    const secondUserId = secondUserMe.body.data.user.id;

    // Admin's personal notification
    const adminNotif = await request(app)
      .post('/api/v1/notifications')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ title: 'For Admin', message: 'Admin-only', userId: adminUserId });
    expect(adminNotif.status).toBe(201);

    // Second user's personal notification
    const secondUserNotif = await request(app)
      .post('/api/v1/notifications')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ title: 'For Second User', message: 'Second-user-only', userId: secondUserId });
    expect(secondUserNotif.status).toBe(201);
    const secondUserNotifId = secondUserNotif.body.data.notification.id;

    // Second user calls read-all
    const readAllRes = await request(app)
      .put('/api/v1/notifications/read-all')
      .set('Authorization', `Bearer ${secondUserToken}`)
      .set('X-Tenant-ID', tenantSlug);
    expect(readAllRes.status).toBe(200);

    // Second user's own + global notification should now be read for their view
    const secondUserView = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${secondUserToken}`)
      .set('X-Tenant-ID', tenantSlug);
    const secondUsersNotif = secondUserView.body.data.notifications.find((n: any) => n.id === secondUserNotifId);
    expect(secondUsersNotif.read).toBe(true);

    // Admin's personal notification must remain UNREAD - this is the regression check:
    // read-all previously had no userId filter and marked every tenant notification read.
    const adminView = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);
    const adminOwnNotif = adminView.body.data.notifications.find((n: any) => n.id === adminNotif.body.data.notification.id);
    expect(adminOwnNotif.read).toBe(false);
  });
});
