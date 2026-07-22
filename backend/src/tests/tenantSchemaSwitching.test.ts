import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { generateJwtToken } from '../utils/jwt';
import { createTenant, deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { createUser, deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';
import { dropTenantSchema, checkSchemaExists } from '../database/tenantSchemaManager';
import { clearMigratedSchemasCache } from '../database/tenantClient';

describe('Strict Tenant Context & Request-Level Schema Switching (BE-110)', () => {
  const tenant1Slug = 'switch-alpha';
  const tenant1Schema = 'tenant_switch_alpha';
  const tenant1Email = 'admin_alpha@switch.com';

  const tenant2Slug = 'switch-beta';
  const tenant2Schema = 'tenant_switch_beta';
  const tenant2Email = 'admin_beta@switch.com';

  const tenant3Slug = 'switch-auto-migrated';
  const tenant3Schema = 'tenant_switch_auto_migrated';

  let tenant1Id: string;
  let tenant2Id: string;
  let tenant3Id: string;

  let tenant1Token: string;
  let tenant2Token: string;

  async function cleanupTestData() {
    clearMigratedSchemasCache();

    await deleteTenantBySlug(prisma, tenant1Slug).catch(() => {});
    await deleteTenantBySlug(prisma, tenant2Slug).catch(() => {});
    await deleteTenantBySlug(prisma, tenant3Slug).catch(() => {});

    await deleteUserByEmail(prisma, tenant1Email).catch(() => {});
    await deleteUserByEmail(prisma, tenant2Email).catch(() => {});

    await dropTenantSchema(prisma, tenant1Schema).catch(() => {});
    await dropTenantSchema(prisma, tenant2Schema).catch(() => {});
    await dropTenantSchema(prisma, tenant3Schema).catch(() => {});
  }

  beforeAll(async () => {
    await prisma.$connect();
    await ensureTenantTableExists(prisma);
    await ensureUserTableExists(prisma);
    await cleanupTestData();

    // 1. Create Tenant Alpha
    const t1 = await createTenant(prisma, {
      name: 'Switch Alpha Corp',
      slug: tenant1Slug,
      schema: tenant1Schema,
    });
    tenant1Id = t1.id;

    const u1 = await createUser(prisma, {
      email: tenant1Email,
      password: 'Password123!',
      name: 'Alpha Admin',
      role: 'Admin',
      tenantId: tenant1Id,
    });
    tenant1Token = generateJwtToken({
      id: u1.id,
      email: u1.email,
      role: u1.role,
      tenantId: tenant1Id,
    });

    // 2. Create Tenant Beta
    const t2 = await createTenant(prisma, {
      name: 'Switch Beta Corp',
      slug: tenant2Slug,
      schema: tenant2Schema,
    });
    tenant2Id = t2.id;

    const u2 = await createUser(prisma, {
      email: tenant2Email,
      password: 'Password123!',
      name: 'Beta Admin',
      role: 'Admin',
      tenantId: tenant2Id,
    });
    tenant2Token = generateJwtToken({
      id: u2.id,
      email: u2.email,
      role: u2.role,
      tenantId: tenant2Id,
    });
  }, 30000);

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  }, 30000);

  describe('1. Missing and Invalid Tenant Context Error Responses', () => {
    it('should return 400 Bad Request with clear JSON error when tenant context header is missing', async () => {
      const res = await request(app)
        .get('/api/v1/accounts')
        .set('Authorization', `Bearer ${tenant1Token}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Missing Tenant Identifier');
      expect(res.body.message).toContain('Header "X-Tenant-ID", "X-Tenant-Slug", or "X-Tenant-Schema" is required');
    });

    it('should return 404 Not Found when unregistered tenant slug is supplied in header', async () => {
      const res = await request(app)
        .get('/api/v1/accounts')
        .set('Authorization', `Bearer ${tenant1Token}`)
        .set('X-Tenant-Slug', 'non-existent-tenant-999');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Tenant Not Found');
      expect(res.body.message).toContain('non-existent-tenant-999');
    });

    it('should return 404 Not Found when unregistered tenant UUID is supplied in header', async () => {
      const fakeUuid = '00000000-0000-0000-0000-000000000000';
      const res = await request(app)
        .get('/api/v1/accounts')
        .set('Authorization', `Bearer ${tenant1Token}`)
        .set('X-Tenant-ID', fakeUuid);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Tenant Not Found');
      expect(res.body.message).toContain(fakeUuid);
    });
  });

  describe('2. Header Extraction Verification (X-Tenant-ID, X-Tenant-Slug, X-Tenant-Schema)', () => {
    it('should extract tenant context using X-Tenant-Slug header', async () => {
      const res = await request(app)
        .get('/api/v1/accounts')
        .set('Authorization', `Bearer ${tenant1Token}`)
        .set('X-Tenant-Slug', tenant1Slug);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should extract tenant context using X-Tenant-ID header', async () => {
      const res = await request(app)
        .get('/api/v1/accounts')
        .set('Authorization', `Bearer ${tenant1Token}`)
        .set('X-Tenant-ID', tenant1Id);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should extract tenant context using X-Tenant-Schema header', async () => {
      const res = await request(app)
        .get('/api/v1/accounts')
        .set('Authorization', `Bearer ${tenant1Token}`)
        .set('X-Tenant-Schema', tenant1Schema);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('3. Automatic Schema Existence Check & Auto-Migration Provisioning (ensureTenantSchemaMigrated)', () => {
    it('should automatically provision schema and run migrations on first request if schema is unprovisioned', async () => {
      // Register tenant 3 in public.tenants WITHOUT running manual migrations beforehand
      const t3 = await createTenant(prisma, {
        name: 'Auto Migrated Corp',
        slug: tenant3Slug,
        schema: tenant3Schema,
      });
      tenant3Id = t3.id;

      // Verify schema does not exist yet
      const existsBefore = await checkSchemaExists(prisma, tenant3Schema);
      expect(existsBefore).toBe(false);

      // Make API call with Tenant 3 header. Middleware should invoke ensureTenantSchemaMigrated automatically
      const res = await request(app)
        .get('/api/v1/accounts')
        .set('Authorization', `Bearer ${tenant1Token}`)
        .set('X-Tenant-Slug', tenant3Slug);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify schema was created and provisioned automatically
      const existsAfter = await checkSchemaExists(prisma, tenant3Schema);
      expect(existsAfter).toBe(true);
    });
  });

  describe('4. Concurrent Tenant Requests & Schema Isolation', () => {
    it('should maintain strict schema data isolation under concurrent request execution', async () => {
      // Execute concurrent requests to create accounts in Tenant Alpha and Tenant Beta simultaneously
      const [resAlpha, resBeta] = await Promise.all([
        request(app)
          .post('/api/v1/accounts')
          .set('Authorization', `Bearer ${tenant1Token}`)
          .set('X-Tenant-Slug', tenant1Slug)
          .send({
            code: '1010',
            name: 'Alpha Bank Account',
            type: 'ASSET',
          }),
        request(app)
          .post('/api/v1/accounts')
          .set('Authorization', `Bearer ${tenant2Token}`)
          .set('X-Tenant-Slug', tenant2Slug)
          .send({
            code: '1010',
            name: 'Beta Bank Account',
            type: 'ASSET',
          }),
      ]);

      expect(resAlpha.status).toBe(201);
      expect(resBeta.status).toBe(201);

      // Query Tenant Alpha accounts concurrently with Tenant Beta accounts
      const [listAlpha, listBeta] = await Promise.all([
        request(app)
          .get('/api/v1/accounts')
          .set('Authorization', `Bearer ${tenant1Token}`)
          .set('X-Tenant-Slug', tenant1Slug),
        request(app)
          .get('/api/v1/accounts')
          .set('Authorization', `Bearer ${tenant2Token}`)
          .set('X-Tenant-Slug', tenant2Slug),
      ]);

      expect(listAlpha.status).toBe(200);
      expect(listBeta.status).toBe(200);

      const alphaAccountNames = listAlpha.body.data.accounts.map((a: any) => a.name);
      const betaAccountNames = listBeta.body.data.accounts.map((a: any) => a.name);

      // Verify complete data isolation between schemas
      expect(alphaAccountNames).toContain('Alpha Bank Account');
      expect(alphaAccountNames).not.toContain('Beta Bank Account');

      expect(betaAccountNames).toContain('Beta Bank Account');
      expect(betaAccountNames).not.toContain('Alpha Bank Account');
    });
  });
});
