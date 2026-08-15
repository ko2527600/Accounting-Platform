import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';

/**
 * Verifies the RBAC lockdown: Shop Manager/Cashier previously fell through
 * to hasRequiredRole()'s "legacy free-text job title" fallback rule
 * (rbacMiddleware.ts), which grants full operational access to anything not
 * Admin-only - meaning they could create invoices, post journal entries,
 * view/export the audit trail, and approve/reimburse expense claims, none
 * of which their intended scope (Inventory/POS/Expense Claims) should
 * allow. Both roles are now in SCOPED_ROLES, so they only pass a
 * requireRole() check where explicitly listed.
 */
describe('RBAC lockdown for Shop Manager / Cashier', () => {
  const runId = Date.now();
  const tenantSlug = `rbac-lockdown-corp-${runId}`;
  const tenantSchema = `tenant_rbac_lockdown_corp_${runId}`;
  const adminEmail = `admin_rbaclock_${runId}@corp.com`;
  const managerEmail = `manager_rbaclock_${runId}@corp.com`;
  const cashierEmail = `cashier_rbaclock_${runId}@corp.com`;

  let adminToken: string;
  let tenantId: string;
  let managerToken: string;
  let cashierToken: string;
  let warehouseId: string;

  async function cleanupTestData() {
    if (tenantId) {
      await prisma.auditLog.deleteMany({ where: { tenantId } }).catch(() => {});
    }
    await deleteTenantBySlug(prisma, tenantSlug).catch(() => {});
    await deleteUserByEmail(prisma, adminEmail).catch(() => {});
    await deleteUserByEmail(prisma, managerEmail).catch(() => {});
    await deleteUserByEmail(prisma, cashierEmail).catch(() => {});
    await dropTenantSchema(prisma, tenantSchema).catch(() => {});
  }

  async function inviteAndAccept(email: string, role: string, name: string) {
    const invite = await request(app)
      .post('/api/v1/tenants/invite')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ email, role, warehouseIds: [warehouseId] });
    expect(invite.status).toBe(201);

    const accept = await request(app)
      .post('/api/v1/auth/accept-invitation')
      .send({ token: invite.body.data.invitation.token, name, password: 'Password123!' });
    expect(accept.status).toBe(200);
    return accept.body.data.token as string;
  }

  beforeAll(async () => {
    await prisma.$connect();
    await ensureTenantTableExists(prisma);
    await ensureUserTableExists(prisma);
    await cleanupTestData();

    const onboard = await onboardTenant(prisma, {
      companyName: 'RBAC Lockdown Corp',
      slug: tenantSlug,
      adminEmail,
      adminPassword: 'Password123!',
      adminName: 'Lockdown Admin',
      tier: 3, // Banking is a Business+ feature (requireTier gate) - this file tests role scoping, not tiers, so the 403 assertions below must come from the role check.
    });
    adminToken = onboard.token;
    tenantId = onboard.tenant.id;

    const wh = await request(app)
      .post('/api/v1/inventory/warehouses')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ name: 'Main Shop' });
    warehouseId = wh.body.data.warehouse.id;

    managerToken = await inviteAndAccept(managerEmail, 'Shop Manager', 'Lockdown Shop Manager');
    cashierToken = await inviteAndAccept(cashierEmail, 'Cashier', 'Lockdown Cashier');
  }, 60000);

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  describe.each([
    ['Shop Manager', () => managerToken],
    ['Cashier', () => cashierToken],
  ])('%s', (_roleName, getToken) => {
    it('still has full access to their real scope: inventory writes, reading accounts, and expense claims', async () => {
      const token = getToken();

      const item = await request(app)
        .post('/api/v1/inventory/items')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({ name: 'Locked-down Widget', costPrice: 1, sellingPrice: 2, initialWarehouseId: warehouseId, initialQty: 5 });
      expect(item.status).toBe(201);
      const itemId = item.body.data.item.id;

      const adjustment = await request(app)
        .post('/api/v1/inventory/adjustments')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({ warehouseId, itemId, mode: 'add', quantity: 5, reason: 'Restock' });
      expect(adjustment.status).toBe(201);

      const stockTake = await request(app)
        .post('/api/v1/inventory/stock-take')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({ warehouseId, counts: [{ itemId, countedQty: 10 }] });
      expect(stockTake.status).toBe(200);

      const accountsRes = await request(app)
        .get('/api/v1/accounts')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', tenantSlug);
      expect(accountsRes.status).toBe(200);

      const claim = await request(app)
        .post('/api/v1/expense-claims')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({ description: 'Shop supplies', amount: 25, category: 'Supplies', expenseDate: '2026-08-14' });
      expect(claim.status).toBe(201);

      const claimsList = await request(app)
        .get('/api/v1/expense-claims?mine=true')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', tenantSlug);
      expect(claimsList.status).toBe(200);
    });

    it('is now blocked from creating a new warehouse (business-setup action, still Accountant/Admin-only)', async () => {
      const res = await request(app)
        .post('/api/v1/inventory/warehouses')
        .set('Authorization', `Bearer ${getToken()}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({ name: 'Should Not Be Created' });
      expect(res.status).toBe(403);
    });

    it('is now blocked from issuing an invoice', async () => {
      const res = await request(app)
        .post('/api/v1/invoices')
        .set('Authorization', `Bearer ${getToken()}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({ customerId: '00000000-0000-0000-0000-000000000000', items: [{ description: 'x', quantity: 1, unitPrice: 1 }] });
      expect(res.status).toBe(403);
    });

    it('is now blocked from posting a journal entry', async () => {
      const res = await request(app)
        .post('/api/v1/journal-entries')
        .set('Authorization', `Bearer ${getToken()}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({ description: 'x', status: 'POSTED', lines: [] });
      expect(res.status).toBe(403);
    });

    it('is now blocked from reconciling a bank transaction', async () => {
      const res = await request(app)
        .post('/api/v1/banking/reconcile')
        .set('Authorization', `Bearer ${getToken()}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({ transactionId: '00000000-0000-0000-0000-000000000000', ledgerId: '00000000-0000-0000-0000-000000000000' });
      expect(res.status).toBe(403);
    });

    it('is now blocked from viewing the audit trail', async () => {
      const res = await request(app)
        .get('/api/v1/audit-logs')
        .set('Authorization', `Bearer ${getToken()}`)
        .set('X-Tenant-ID', tenantSlug);
      expect(res.status).toBe(403);
    });

    it('is now blocked from viewing financial reports', async () => {
      const res = await request(app)
        .get('/api/v1/reports/profit-loss')
        .set('Authorization', `Bearer ${getToken()}`)
        .set('X-Tenant-ID', tenantSlug);
      expect(res.status).toBe(403);
    });

    it('is still blocked from deciding/reimbursing an expense claim (was an accidental over-permission, deliberately not re-granted)', async () => {
      const decide = await request(app)
        .post('/api/v1/expense-claims/00000000-0000-0000-0000-000000000000/decide')
        .set('Authorization', `Bearer ${getToken()}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({ decision: 'APPROVE' });
      expect(decide.status).toBe(403);

      const reimburse = await request(app)
        .post('/api/v1/expense-claims/00000000-0000-0000-0000-000000000000/reimburse')
        .set('Authorization', `Bearer ${getToken()}`)
        .set('X-Tenant-ID', tenantSlug);
      expect(reimburse.status).toBe(403);
    });
  });
});
