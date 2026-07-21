import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { verifyJwtToken } from '../utils/jwt';
import { deleteTenantBySlug, findTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists, findUserByEmail } from '../repository/userRepository';
import { dropTenantSchema, checkSchemaExists } from '../database/tenantSchemaManager';

describe('Tenant Onboarding API & Service Integration Tests (BE-104)', () => {
  jest.setTimeout(30000);

  const testSlug1 = 'apex-acc';
  const testSchema1 = 'tenant_apex_acc';
  const testAdminEmail1 = 'onboard_admin_be104@apex.com';

  const testSlug2 = 'beta-solutions';
  const testSchema2 = 'tenant_beta_solutions';
  const testAdminEmail2 = 'admin_be104@beta.com';

  const defaultPassword = 'Password123!';

  async function cleanupTestData() {
    await deleteTenantBySlug(prisma, testSlug1);
    await deleteTenantBySlug(prisma, testSlug2);

    await deleteUserByEmail(prisma, testAdminEmail1);
    await deleteUserByEmail(prisma, testAdminEmail2);

    await dropTenantSchema(prisma, testSchema1).catch(() => {});
    await dropTenantSchema(prisma, testSchema2).catch(() => {});
  }

  beforeAll(async () => {
    await prisma.$connect();
    await ensureTenantTableExists(prisma);
    await ensureUserTableExists(prisma);
    await cleanupTestData();
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  describe('1. Successful Tenant Onboarding (POST /api/v1/tenants/onboard)', () => {
    it('should onboard a new tenant, provision schema, run DDL migrations, register Admin user, and return JWT token', async () => {
      const payload = {
        companyName: 'Apex Accounting Ltd',
        slug: testSlug1,
        adminEmail: testAdminEmail1,
        adminPassword: defaultPassword,
        adminName: 'Apex Admin',
      };

      const response = await request(app)
        .post('/api/v1/tenants/onboard')
        .send(payload);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Tenant onboarded successfully');

      const data = response.body.data;
      expect(data.tenant).toBeDefined();
      expect(data.tenant.id).toBeDefined();
      expect(data.tenant.name).toBe('Apex Accounting Ltd');
      expect(data.tenant.slug).toBe(testSlug1);
      expect(data.tenant.schema).toBe(testSchema1);

      expect(data.admin).toBeDefined();
      expect(data.admin.id).toBeDefined();
      expect(data.admin.email).toBe(testAdminEmail1);
      expect(data.admin.name).toBe('Apex Admin');
      expect(data.admin.role).toBe('Admin');
      expect(data.admin.tenantId).toBe(data.tenant.id);
      expect(data.admin.password).toBeUndefined();

      expect(data.token).toBeDefined();
      expect(data.migration).toBeDefined();
      expect(data.migration.appliedMigrations).toContain('001_initial_tenant_core_schema');

      // 1. Verify tenant record in public.tenants
      const dbTenant = await findTenantBySlug(prisma, testSlug1);
      expect(dbTenant).not.toBeNull();
      expect(dbTenant?.name).toBe('Apex Accounting Ltd');
      expect(dbTenant?.schema).toBe(testSchema1);

      // 2. Verify admin user record in public.users
      const dbUser = await findUserByEmail(prisma, testAdminEmail1);
      expect(dbUser).not.toBeNull();
      expect(dbUser?.role).toBe('Admin');
      expect(dbUser?.tenantId).toBe(dbTenant?.id);

      // 3. Verify PostgreSQL dedicated tenant schema existence
      const schemaExists = await checkSchemaExists(prisma, testSchema1);
      expect(schemaExists).toBe(true);

      // 4. Verify core DDL migration tables inside tenant schema
      const tables: Array<{ table_name: string }> = await prisma.$queryRawUnsafe(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = '${testSchema1}'
      `);
      const tableNames = tables.map((t) => t.table_name);
      expect(tableNames).toContain('accounts');
      expect(tableNames).toContain('journal_entries');
      expect(tableNames).toContain('journal_entry_lines');
      expect(tableNames).toContain('ledgers');
      expect(tableNames).toContain('schema_migrations');

      // 5. Verify JWT Token claims
      const claims = verifyJwtToken(data.token);
      expect(claims.email).toBe(testAdminEmail1);
      expect(claims.role).toBe('Admin');
      expect(claims.tenantId).toBe(data.tenant.id);
    });

    it('should auto-generate clean slug if slug is omitted in request payload', async () => {
      const payload = {
        companyName: 'Beta Solutions',
        adminEmail: testAdminEmail2,
        adminPassword: defaultPassword,
      };

      const response = await request(app)
        .post('/api/v1/tenants/onboard')
        .send(payload);

      expect(response.status).toBe(201);
      expect(response.body.data.tenant.slug).toBe(testSlug2);
      expect(response.body.data.tenant.schema).toBe(testSchema2);

      const dbTenant = await findTenantBySlug(prisma, testSlug2);
      expect(dbTenant).not.toBeNull();
    });
  });

  describe('2. Validation Error Handling (POST /api/v1/tenants/onboard)', () => {
    it('should return 400 Bad Request when company name is missing', async () => {
      const response = await request(app)
        .post('/api/v1/tenants/onboard')
        .send({
          adminEmail: 'some@email.com',
          adminPassword: defaultPassword,
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Company name');
    });

    it('should return 400 Bad Request when email format is invalid', async () => {
      const response = await request(app)
        .post('/api/v1/tenants/onboard')
        .send({
          companyName: 'Invalid Email Corp',
          adminEmail: 'invalid-email-address',
          adminPassword: defaultPassword,
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Invalid email format');
    });

    it('should return 400 Bad Request when password is shorter than 6 characters', async () => {
      const response = await request(app)
        .post('/api/v1/tenants/onboard')
        .send({
          companyName: 'Short Password Corp',
          adminEmail: 'short@password.com',
          adminPassword: '123',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('at least 6 characters');
    });
  });

  describe('3. Conflict Error Handling (POST /api/v1/tenants/onboard)', () => {
    it('should return 409 Conflict when attempting to onboard duplicate tenant slug', async () => {
      const response = await request(app)
        .post('/api/v1/tenants/onboard')
        .send({
          companyName: 'Apex Accounting Ltd Duplicate',
          slug: testSlug1,
          adminEmail: 'different_admin@apex.com',
          adminPassword: defaultPassword,
        });

      expect(response.status).toBe(409);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain(`Tenant with slug "${testSlug1}" already exists`);
    });

    it('should return 409 Conflict when attempting to onboard with an already registered admin email', async () => {
      const response = await request(app)
        .post('/api/v1/tenants/onboard')
        .send({
          companyName: 'New Tenant Same Email',
          slug: 'new-tenant-slug',
          adminEmail: testAdminEmail1,
          adminPassword: defaultPassword,
        });

      expect(response.status).toBe(409);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain(`User with email "${testAdminEmail1}" already exists`);
    });
  });

  describe('4. Tenants List API Endpoint (GET /api/v1/tenants)', () => {
    it('should return list of registered tenants', async () => {
      const response = await request(app).get('/api/v1/tenants');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data.tenants)).toBe(true);

      const slugs = response.body.data.tenants.map((t: any) => t.slug);
      expect(slugs).toContain(testSlug1);
      expect(slugs).toContain(testSlug2);
    });
  });
});
