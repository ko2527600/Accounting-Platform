import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { generateJwtToken } from '../utils/jwt';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists, createUser } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';

describe('Chart of Accounts CRUD API Integration Tests (BE-106)', () => {
  const tenant1Slug = 'accounts-corp-1';
  const tenant1Schema = 'tenant_accounts_corp_1';
  const adminEmail1 = 'admin_acc1@corp1.com';
  const accountantEmail1 = 'accountant_acc1@corp1.com';
  const viewerEmail1 = 'viewer_acc1@corp1.com';

  const tenant2Slug = 'accounts-corp-2';
  const tenant2Schema = 'tenant_accounts_corp_2';
  const adminEmail2 = 'admin_acc2@corp2.com';

  let tenant1Id: string;
  let tenant2Id: string;

  let adminToken1: string;
  let accountantToken1: string;
  let viewerToken1: string;

  let adminToken2: string;

  let parentAccountId: string;
  let subAccountId: string;
  let leafAccountId: string;

  async function cleanupTestData() {
    await deleteTenantBySlug(prisma, tenant1Slug).catch(() => {});
    await deleteTenantBySlug(prisma, tenant2Slug).catch(() => {});

    await deleteUserByEmail(prisma, adminEmail1).catch(() => {});
    await deleteUserByEmail(prisma, accountantEmail1).catch(() => {});
    await deleteUserByEmail(prisma, viewerEmail1).catch(() => {});
    await deleteUserByEmail(prisma, adminEmail2).catch(() => {});

    await dropTenantSchema(prisma, tenant1Schema).catch(() => {});
    await dropTenantSchema(prisma, tenant2Schema).catch(() => {});
  }

  beforeAll(async () => {
    await prisma.$connect();
    await ensureTenantTableExists(prisma);
    await ensureUserTableExists(prisma);
    await cleanupTestData();

    // 1. Onboard Tenant 1
    const onboard1 = await onboardTenant(prisma, {
      companyName: 'Accounts Corp 1',
      slug: tenant1Slug,
      adminEmail: adminEmail1,
      adminPassword: 'Password123!',
      adminName: 'Corp 1 Admin',
    });
    tenant1Id = onboard1.tenant.id;
    adminToken1 = onboard1.token;

    // Create Accountant User for Tenant 1
    const accountantUser1 = await createUser(prisma, {
      email: accountantEmail1,
      password: 'Password123!',
      name: 'Corp 1 Accountant',
      role: 'Accountant',
      tenantId: tenant1Id,
    });
    accountantToken1 = generateJwtToken({
      id: accountantUser1.id,
      email: accountantUser1.email,
      role: accountantUser1.role,
      tenantId: tenant1Id,
    });

    // Create Viewer User for Tenant 1
    const viewerUser1 = await createUser(prisma, {
      email: viewerEmail1,
      password: 'Password123!',
      name: 'Corp 1 Viewer',
      role: 'Viewer',
      tenantId: tenant1Id,
    });
    viewerToken1 = generateJwtToken({
      id: viewerUser1.id,
      email: viewerUser1.email,
      role: viewerUser1.role,
      tenantId: tenant1Id,
    });

    // 2. Onboard Tenant 2
    const onboard2 = await onboardTenant(prisma, {
      companyName: 'Accounts Corp 2',
      slug: tenant2Slug,
      adminEmail: adminEmail2,
      adminPassword: 'Password123!',
      adminName: 'Corp 2 Admin',
    });
    tenant2Id = onboard2.tenant.id;
    adminToken2 = onboard2.token;
  }, 30000);

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  describe('1. Authentication & Authorization Middleware Safeguards', () => {
    it('should return 401 Unauthorized when Authorization header is missing', async () => {
      const res = await request(app)
        .get('/api/v1/accounts')
        .set('X-Tenant-ID', tenant1Slug);

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Unauthorized');
    });

    it('should return 400 Bad Request when tenant context header is missing', async () => {
      const res = await request(app)
        .get('/api/v1/accounts')
        .set('Authorization', `Bearer ${viewerToken1}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Missing Tenant Identifier');
    });

    it('should return 403 Forbidden when a Viewer user attempts write operations (POST)', async () => {
      const res = await request(app)
        .post('/api/v1/accounts')
        .set('Authorization', `Bearer ${viewerToken1}`)
        .set('X-Tenant-ID', tenant1Slug)
        .send({
          code: '1000',
          name: 'Assets',
          type: 'ASSET',
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Forbidden');
    });
  });

  describe('2. POST /api/v1/accounts - Create Accounts', () => {
    it('should create a top-level parent account (1000 - Assets) as Accountant', async () => {
      const res = await request(app)
        .post('/api/v1/accounts')
        .set('Authorization', `Bearer ${accountantToken1}`)
        .set('X-Tenant-ID', tenant1Slug)
        .send({
          code: '1000',
          name: 'Assets',
          type: 'ASSET',
          currency: 'USD',
          isActive: true,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.account).toBeDefined();
      expect(res.body.data.account.code).toBe('1000');
      expect(res.body.data.account.name).toBe('Assets');
      expect(res.body.data.account.type).toBe('ASSET');
      expect(res.body.data.account.parentId).toBeNull();

      parentAccountId = res.body.data.account.id;
    });

    it('should create a sub-account (1100 - Current Assets) linking to parent', async () => {
      const res = await request(app)
        .post('/api/v1/accounts')
        .set('Authorization', `Bearer ${adminToken1}`)
        .set('X-Tenant-ID', tenant1Slug)
        .send({
          code: '1100',
          name: 'Current Assets',
          type: 'ASSET',
          parentId: parentAccountId,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.account.parentId).toBe(parentAccountId);

      subAccountId = res.body.data.account.id;
    });

    it('should create a leaf account (1110 - Checking Account) linking to sub-account', async () => {
      const res = await request(app)
        .post('/api/v1/accounts')
        .set('Authorization', `Bearer ${accountantToken1}`)
        .set('X-Tenant-ID', tenant1Slug)
        .send({
          code: '1110',
          name: 'Checking Account',
          type: 'ASSET',
          parentId: subAccountId,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.account.parentId).toBe(subAccountId);

      leafAccountId = res.body.data.account.id;
    });

    it('should return 409 Conflict when creating an account with duplicate code', async () => {
      const res = await request(app)
        .post('/api/v1/accounts')
        .set('Authorization', `Bearer ${accountantToken1}`)
        .set('X-Tenant-ID', tenant1Slug)
        .send({
          code: '1000',
          name: 'Duplicate Assets',
          type: 'ASSET',
        });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('already exists');
    });

    it('should return 400 Bad Request when account type is invalid', async () => {
      const res = await request(app)
        .post('/api/v1/accounts')
        .set('Authorization', `Bearer ${accountantToken1}`)
        .set('X-Tenant-ID', tenant1Slug)
        .send({
          code: '9999',
          name: 'Invalid Type Acc',
          type: 'INVALID_TYPE',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('Invalid account type');
    });

    it('should return 400 Bad Request when parentId does not exist', async () => {
      const fakeParentId = '00000000-0000-0000-0000-000000000000';
      const res = await request(app)
        .post('/api/v1/accounts')
        .set('Authorization', `Bearer ${accountantToken1}`)
        .set('X-Tenant-ID', tenant1Slug)
        .send({
          code: '1200',
          name: 'Orphan Sub Account',
          type: 'ASSET',
          parentId: fakeParentId,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('Parent account');
    });
  });

  describe('3. GET /api/v1/accounts - List Accounts & Tree Hierarchy', () => {
    it('should return flat list and nested tree structure for Viewer user', async () => {
      const res = await request(app)
        .get('/api/v1/accounts')
        .set('Authorization', `Bearer ${viewerToken1}`)
        .set('X-Tenant-ID', tenant1Slug);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const { accounts, tree } = res.body.data;
      expect(Array.isArray(accounts)).toBe(true);
      expect(accounts.length).toBeGreaterThanOrEqual(3);

      expect(Array.isArray(tree)).toBe(true);

      // Verify parent node in tree
      const parentInTree = tree.find((node: any) => node.id === parentAccountId);
      expect(parentInTree).toBeDefined();
      expect(parentInTree.code).toBe('1000');
      expect(parentInTree.children.length).toBe(1);

      // Verify child node in tree
      const subInTree = parentInTree.children[0];
      expect(subInTree.id).toBe(subAccountId);
      expect(subInTree.children.length).toBe(1);

      // Verify leaf node in tree
      const leafInTree = subInTree.children[0];
      expect(leafInTree.id).toBe(leafAccountId);
      expect(leafInTree.children.length).toBe(0);
    });
  });

  describe('4. GET /api/v1/accounts/:id - Get Single Account', () => {
    it('should return account details by valid ID', async () => {
      const res = await request(app)
        .get(`/api/v1/accounts/${leafAccountId}`)
        .set('Authorization', `Bearer ${viewerToken1}`)
        .set('X-Tenant-ID', tenant1Slug);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.account).toBeDefined();
      expect(res.body.data.account.id).toBe(leafAccountId);
      expect(res.body.data.account.name).toBe('Checking Account');
    });

    it('should return 404 Not Found for non-existent account ID', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000099';
      const res = await request(app)
        .get(`/api/v1/accounts/${fakeId}`)
        .set('Authorization', `Bearer ${viewerToken1}`)
        .set('X-Tenant-ID', tenant1Slug);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('not found');
    });
  });

  describe('5. PUT /api/v1/accounts/:id - Update Account', () => {
    it('should update account details (name and active state) as Accountant', async () => {
      const res = await request(app)
        .put(`/api/v1/accounts/${leafAccountId}`)
        .set('Authorization', `Bearer ${accountantToken1}`)
        .set('X-Tenant-ID', tenant1Slug)
        .send({
          name: 'Main Checking Account',
          isActive: true,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.account.name).toBe('Main Checking Account');
    });

    it('should return 400 Bad Request when setting parentId to itself', async () => {
      const res = await request(app)
        .put(`/api/v1/accounts/${subAccountId}`)
        .set('Authorization', `Bearer ${accountantToken1}`)
        .set('X-Tenant-ID', tenant1Slug)
        .send({
          parentId: subAccountId,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('cannot be set as its own parent');
    });

    it('should return 400 Bad Request when setting parentId that causes circular reference', async () => {
      // Trying to set parentAccountId's parent to leafAccountId (circular!)
      const res = await request(app)
        .put(`/api/v1/accounts/${parentAccountId}`)
        .set('Authorization', `Bearer ${accountantToken1}`)
        .set('X-Tenant-ID', tenant1Slug)
        .send({
          parentId: leafAccountId,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('Circular parent');
    });
  });

  describe('6. DELETE /api/v1/accounts/:id - Delete Account', () => {
    it('should return 400 Bad Request when deleting an account with child accounts', async () => {
      const res = await request(app)
        .delete(`/api/v1/accounts/${parentAccountId}`)
        .set('Authorization', `Bearer ${accountantToken1}`)
        .set('X-Tenant-ID', tenant1Slug);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('child account(s)');
    });

    it('should delete leaf account successfully', async () => {
      const res = await request(app)
        .delete(`/api/v1/accounts/${leafAccountId}`)
        .set('Authorization', `Bearer ${accountantToken1}`)
        .set('X-Tenant-ID', tenant1Slug);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('deleted successfully');

      // Verify deletion
      const getRes = await request(app)
        .get(`/api/v1/accounts/${leafAccountId}`)
        .set('Authorization', `Bearer ${viewerToken1}`)
        .set('X-Tenant-ID', tenant1Slug);

      expect(getRes.status).toBe(404);
    });
  });

  describe('7. Multi-Tenant Schema Data Isolation', () => {
    it('should isolate accounts between different tenant schemas', async () => {
      // Create account in Tenant 2
      const createTenant2Acc = await request(app)
        .post('/api/v1/accounts')
        .set('Authorization', `Bearer ${adminToken2}`)
        .set('X-Tenant-ID', tenant2Slug)
        .send({
          code: '1000',
          name: 'Tenant 2 Assets',
          type: 'ASSET',
        });

      expect(createTenant2Acc.status).toBe(201);

      // Query Tenant 1 accounts
      const listTenant1 = await request(app)
        .get('/api/v1/accounts')
        .set('Authorization', `Bearer ${adminToken1}`)
        .set('X-Tenant-ID', tenant1Slug);

      expect(listTenant1.status).toBe(200);
      const namesTenant1 = listTenant1.body.data.accounts.map((a: any) => a.name);
      expect(namesTenant1).not.toContain('Tenant 2 Assets');

      // Query Tenant 2 accounts
      const listTenant2 = await request(app)
        .get('/api/v1/accounts')
        .set('Authorization', `Bearer ${adminToken2}`)
        .set('X-Tenant-ID', tenant2Slug);

      expect(listTenant2.status).toBe(200);
      const namesTenant2 = listTenant2.body.data.accounts.map((a: any) => a.name);
      expect(namesTenant2).toContain('Tenant 2 Assets');
      expect(namesTenant2).not.toContain('Current Assets');
    });
  });
});
