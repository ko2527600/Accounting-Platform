import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { generateJwtToken } from '../utils/jwt';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists, createUser } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';

describe('Journal Entries API Integration Tests (BE-107)', () => {
  const tenant1Slug = 'je-corp-1-v2';
  const tenant1Schema = 'tenant_je_corp_1_v2';
  const adminEmail1 = 'admin_je1_v2@corp1.com';
  const accountantEmail1 = 'accountant_je1_v2@corp1.com';
  const viewerEmail1 = 'viewer_je1_v2@corp1.com';

  const tenant2Slug = 'je-corp-2-v2';
  const tenant2Schema = 'tenant_je_corp_2_v2';
  const adminEmail2 = 'admin_je2_v2@corp2.com';

  let tenant1Id: string;
  let tenant2Id: string;

  let adminToken1: string;
  let accountantToken1: string;
  let viewerToken1: string;
  let adminToken2: string;

  let cashAccountId1: string;
  let revenueAccountId1: string;
  let expenseAccountId1: string;

  let draftEntryId: string;
  let postedEntryId: string;
  let voidedEntryId: string;

  async function cleanupTestData() {
    console.log("-> cleanup: deleteTenantBySlug 1");
    await deleteTenantBySlug(prisma, tenant1Slug).catch(() => {});
    console.log("-> cleanup: deleteTenantBySlug 2");
    await deleteTenantBySlug(prisma, tenant2Slug).catch(() => {});

    console.log("-> cleanup: deleteUserByEmail 1");
    await deleteUserByEmail(prisma, adminEmail1).catch(() => {});
    console.log("-> cleanup: deleteUserByEmail 2");
    await deleteUserByEmail(prisma, accountantEmail1).catch(() => {});
    console.log("-> cleanup: deleteUserByEmail 3");
    await deleteUserByEmail(prisma, viewerEmail1).catch(() => {});
    console.log("-> cleanup: deleteUserByEmail 4");
    await deleteUserByEmail(prisma, adminEmail2).catch(() => {});

    console.log("-> cleanup: dropTenantSchema 1");
    await dropTenantSchema(prisma, tenant1Schema).catch(() => {});
    console.log("-> cleanup: dropTenantSchema 2");
    await dropTenantSchema(prisma, tenant2Schema).catch(() => {});
    console.log("-> cleanup: done");
  }

  beforeAll(async () => {
    console.log("-> Connecting to Prisma");
    await prisma.$connect();
    console.log("-> Ensuring Tenant Table");
    await ensureTenantTableExists(prisma);
    console.log("-> Ensuring User Table");
    await ensureUserTableExists(prisma);
    console.log("-> Cleaning up test data");
    await cleanupTestData();

    console.log("-> Onboarding Tenant 1");
    // 1. Onboard Tenant 1
    const onboard1 = await onboardTenant(prisma, {
      companyName: 'JE Corp 1',
      slug: tenant1Slug,
      adminEmail: adminEmail1,
      adminPassword: 'Password123!',
      adminName: 'JE Corp 1 Admin',
    });
    console.log("-> Onboarded Tenant 1");
    tenant1Id = onboard1.tenant.id;
    adminToken1 = onboard1.token;

    // Create Accountant User for Tenant 1
    const accountantUser1 = await createUser(prisma, {
      email: accountantEmail1,
      password: 'Password123!',
      name: 'JE Corp 1 Accountant',
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
      name: 'JE Corp 1 Viewer',
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
      companyName: 'JE Corp 2',
      slug: tenant2Slug,
      adminEmail: adminEmail2,
      adminPassword: 'Password123!',
      adminName: 'JE Corp 2 Admin',
    });
    tenant2Id = onboard2.tenant.id;
    adminToken2 = onboard2.token;

    // 3. Set up Accounts for Tenant 1
    const cashAcc = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${accountantToken1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ code: '1010', name: 'Cash', type: 'ASSET' });
    cashAccountId1 = cashAcc.body.data.account.id;

    const revAcc = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${accountantToken1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ code: '4010', name: 'Sales Revenue', type: 'REVENUE' });
    revenueAccountId1 = revAcc.body.data.account.id;

    const expAcc = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${accountantToken1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ code: '5010', name: 'Office Expense', type: 'EXPENSE' });
    expenseAccountId1 = expAcc.body.data.account.id;
  }, 120000);

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  describe('1. Authentication & Authorization Middleware Safeguards', () => {
    it('should return 401 Unauthorized when Authorization header is missing', async () => {
      const res = await request(app)
        .get('/api/v1/journal-entries')
        .set('X-Tenant-ID', tenant1Slug);

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Unauthorized');
    });

    it('should return 400 Bad Request when tenant context header is missing', async () => {
      const res = await request(app)
        .get('/api/v1/journal-entries')
        .set('Authorization', `Bearer ${viewerToken1}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Missing Tenant Identifier');
    });

    it('should return 403 Forbidden when a Viewer user attempts write operations (POST)', async () => {
      const res = await request(app)
        .post('/api/v1/journal-entries')
        .set('Authorization', `Bearer ${viewerToken1}`)
        .set('X-Tenant-ID', tenant1Slug)
        .send({
          entryNumber: 'JE-TEST-001',
          lines: [
            { accountId: cashAccountId1, debit: 100, credit: 0 },
            { accountId: revenueAccountId1, debit: 0, credit: 100 },
          ],
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Forbidden');
    });
  });

  describe('2. POST /api/v1/journal-entries - Create Journal Entries', () => {
    it('should create a valid draft journal entry as Accountant', async () => {
      const res = await request(app)
        .post('/api/v1/journal-entries')
        .set('Authorization', `Bearer ${accountantToken1}`)
        .set('X-Tenant-ID', tenant1Slug)
        .send({
          entryNumber: 'JE-2026-001',
          entryDate: '2026-07-21',
          description: 'Sales Invoice #1001',
          status: 'DRAFT',
          lines: [
            { accountId: cashAccountId1, debit: 1500.0, credit: 0.0, description: 'Cash received' },
            { accountId: revenueAccountId1, debit: 0.0, credit: 1500.0, description: 'Sales revenue' },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.journalEntry).toBeDefined();
      expect(res.body.data.journalEntry.entryNumber).toBe('JE-2026-001');
      expect(res.body.data.journalEntry.status).toBe('DRAFT');
      expect(res.body.data.journalEntry.lines.length).toBe(2);

      draftEntryId = res.body.data.journalEntry.id;
    });

    it('should create a valid POSTED journal entry directly and post to general ledger', async () => {
      const res = await request(app)
        .post('/api/v1/journal-entries')
        .set('Authorization', `Bearer ${accountantToken1}`)
        .set('X-Tenant-ID', tenant1Slug)
        .send({
          entryNumber: 'JE-2026-002',
          entryDate: '2026-07-21',
          description: 'Direct Posted Expense',
          status: 'POSTED',
          lines: [
            { accountId: expenseAccountId1, debit: 350.0, credit: 0.0, description: 'Office supplies' },
            { accountId: cashAccountId1, debit: 0.0, credit: 350.0, description: 'Cash paid' },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.journalEntry.status).toBe('POSTED');

      postedEntryId = res.body.data.journalEntry.id;
    });

    it('should return 400 Bad Request when double-entry amounts are unbalanced', async () => {
      const res = await request(app)
        .post('/api/v1/journal-entries')
        .set('Authorization', `Bearer ${accountantToken1}`)
        .set('X-Tenant-ID', tenant1Slug)
        .send({
          entryNumber: 'JE-2026-UNBALANCED',
          lines: [
            { accountId: cashAccountId1, debit: 1000.0, credit: 0.0 },
            { accountId: revenueAccountId1, debit: 0.0, credit: 800.0 },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('not balanced');
    });

    it('should return 400 Bad Request when fewer than 2 lines are provided', async () => {
      const res = await request(app)
        .post('/api/v1/journal-entries')
        .set('Authorization', `Bearer ${accountantToken1}`)
        .set('X-Tenant-ID', tenant1Slug)
        .send({
          entryNumber: 'JE-2026-ONE-LINE',
          lines: [{ accountId: cashAccountId1, debit: 1000.0, credit: 0.0 }],
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('at least 2 lines');
    });

    it('should return 400 Bad Request when accountId does not exist in tenant schema', async () => {
      const fakeAccountId = '00000000-0000-0000-0000-000000000000';
      const res = await request(app)
        .post('/api/v1/journal-entries')
        .set('Authorization', `Bearer ${accountantToken1}`)
        .set('X-Tenant-ID', tenant1Slug)
        .send({
          entryNumber: 'JE-2026-BAD-ACC',
          lines: [
            { accountId: cashAccountId1, debit: 500.0, credit: 0.0 },
            { accountId: fakeAccountId, debit: 0.0, credit: 500.0 },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('does not exist');
    });

    it('should return 409 Conflict when entryNumber already exists', async () => {
      const res = await request(app)
        .post('/api/v1/journal-entries')
        .set('Authorization', `Bearer ${accountantToken1}`)
        .set('X-Tenant-ID', tenant1Slug)
        .send({
          entryNumber: 'JE-2026-001',
          lines: [
            { accountId: cashAccountId1, debit: 100.0, credit: 0.0 },
            { accountId: revenueAccountId1, debit: 0.0, credit: 100.0 },
          ],
        });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('already exists');
    });
  });

  describe('3. GET /api/v1/journal-entries - List & Filter Journal Entries', () => {
    it('should return all journal entries for Viewer user', async () => {
      const res = await request(app)
        .get('/api/v1/journal-entries')
        .set('Authorization', `Bearer ${viewerToken1}`)
        .set('X-Tenant-ID', tenant1Slug);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.journalEntries)).toBe(true);
      expect(res.body.data.journalEntries.length).toBeGreaterThanOrEqual(2);
    });

    it('should filter journal entries by status=DRAFT', async () => {
      const res = await request(app)
        .get('/api/v1/journal-entries?status=DRAFT')
        .set('Authorization', `Bearer ${viewerToken1}`)
        .set('X-Tenant-ID', tenant1Slug);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const entries = res.body.data.journalEntries;
      expect(entries.every((e: any) => e.status === 'DRAFT')).toBe(true);
    });

    it('should filter journal entries by status=POSTED', async () => {
      const res = await request(app)
        .get('/api/v1/journal-entries?status=POSTED')
        .set('Authorization', `Bearer ${viewerToken1}`)
        .set('X-Tenant-ID', tenant1Slug);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const entries = res.body.data.journalEntries;
      expect(entries.every((e: any) => e.status === 'POSTED')).toBe(true);
    });

    it('should search journal entries by entryNumber query parameter', async () => {
      const res = await request(app)
        .get('/api/v1/journal-entries?search=JE-2026-001')
        .set('Authorization', `Bearer ${viewerToken1}`)
        .set('X-Tenant-ID', tenant1Slug);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.journalEntries.length).toBe(1);
      expect(res.body.data.journalEntries[0].entryNumber).toBe('JE-2026-001');
    });
  });

  describe('4. GET /api/v1/journal-entries/:id - Get Single Journal Entry', () => {
    it('should return journal entry details with lines for a valid ID', async () => {
      const res = await request(app)
        .get(`/api/v1/journal-entries/${draftEntryId}`)
        .set('Authorization', `Bearer ${viewerToken1}`)
        .set('X-Tenant-ID', tenant1Slug);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.journalEntry.id).toBe(draftEntryId);
      expect(res.body.data.journalEntry.lines).toBeDefined();
      expect(res.body.data.journalEntry.lines.length).toBe(2);
    });

    it('should return 404 Not Found for non-existent journal entry ID', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000099';
      const res = await request(app)
        .get(`/api/v1/journal-entries/${fakeId}`)
        .set('Authorization', `Bearer ${viewerToken1}`)
        .set('X-Tenant-ID', tenant1Slug);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('not found');
    });
  });

  describe('5. POST /api/v1/journal-entries/:id/post - Post Entry to General Ledger', () => {
    it('should post a draft entry to general ledger as Accountant', async () => {
      const res = await request(app)
        .post(`/api/v1/journal-entries/${draftEntryId}/post`)
        .set('Authorization', `Bearer ${accountantToken1}`)
        .set('X-Tenant-ID', tenant1Slug);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('posted successfully');
      expect(res.body.data.journalEntry.status).toBe('POSTED');
    });

    it('should return 400 Bad Request when attempting to post an already posted entry', async () => {
      const res = await request(app)
        .post(`/api/v1/journal-entries/${draftEntryId}/post`)
        .set('Authorization', `Bearer ${accountantToken1}`)
        .set('X-Tenant-ID', tenant1Slug);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('already posted');
    });
  });

  describe('6. POST /api/v1/journal-entries/:id/void - Void Entry', () => {
    it('should void a journal entry as Accountant', async () => {
      // First create a new draft entry to void
      const createRes = await request(app)
        .post('/api/v1/journal-entries')
        .set('Authorization', `Bearer ${accountantToken1}`)
        .set('X-Tenant-ID', tenant1Slug)
        .send({
          entryNumber: 'JE-2026-TO-VOID',
          lines: [
            { accountId: cashAccountId1, debit: 200.0, credit: 0.0 },
            { accountId: revenueAccountId1, debit: 0.0, credit: 200.0 },
          ],
        });

      voidedEntryId = createRes.body.data.journalEntry.id;

      const voidRes = await request(app)
        .post(`/api/v1/journal-entries/${voidedEntryId}/void`)
        .set('Authorization', `Bearer ${accountantToken1}`)
        .set('X-Tenant-ID', tenant1Slug);

      expect(voidRes.status).toBe(200);
      expect(voidRes.body.success).toBe(true);
      expect(voidRes.body.message).toContain('voided successfully');
      expect(voidRes.body.data.journalEntry.status).toBe('VOID');
    });

    it('should return 400 Bad Request when attempting to void an already voided entry', async () => {
      const res = await request(app)
        .post(`/api/v1/journal-entries/${voidedEntryId}/void`)
        .set('Authorization', `Bearer ${accountantToken1}`)
        .set('X-Tenant-ID', tenant1Slug);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('already voided');
    });

    it('should return 400 Bad Request when attempting to post a voided entry', async () => {
      const res = await request(app)
        .post(`/api/v1/journal-entries/${voidedEntryId}/post`)
        .set('Authorization', `Bearer ${accountantToken1}`)
        .set('X-Tenant-ID', tenant1Slug);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('voided');
    });
  });

  describe('7. Multi-Tenant Schema Data Isolation', () => {
    it('should isolate journal entries between different tenant schemas', async () => {
      // Create Account in Tenant 2
      const t2Acc1 = await request(app)
        .post('/api/v1/accounts')
        .set('Authorization', `Bearer ${adminToken2}`)
        .set('X-Tenant-ID', tenant2Slug)
        .send({ code: '1010', name: 'Tenant 2 Cash', type: 'ASSET' });

      const t2Acc2 = await request(app)
        .post('/api/v1/accounts')
        .set('Authorization', `Bearer ${adminToken2}`)
        .set('X-Tenant-ID', tenant2Slug)
        .send({ code: '4010', name: 'Tenant 2 Sales', type: 'REVENUE' });

      // Create Entry in Tenant 2
      const t2Entry = await request(app)
        .post('/api/v1/journal-entries')
        .set('Authorization', `Bearer ${adminToken2}`)
        .set('X-Tenant-ID', tenant2Slug)
        .send({
          entryNumber: 'JE-T2-001',
          lines: [
            { accountId: t2Acc1.body.data.account.id, debit: 5000.0, credit: 0.0 },
            { accountId: t2Acc2.body.data.account.id, debit: 0.0, credit: 5000.0 },
          ],
        });

      expect(t2Entry.status).toBe(201);

      // Tenant 1 list should not include Tenant 2 entry
      const listT1 = await request(app)
        .get('/api/v1/journal-entries')
        .set('Authorization', `Bearer ${adminToken1}`)
        .set('X-Tenant-ID', tenant1Slug);

      expect(listT1.status).toBe(200);
      const numbersT1 = listT1.body.data.journalEntries.map((e: any) => e.entryNumber);
      expect(numbersT1).not.toContain('JE-T2-001');

      // Tenant 1 querying Tenant 2 entry ID directly should return 404
      const getT2IdFromT1 = await request(app)
        .get(`/api/v1/journal-entries/${t2Entry.body.data.journalEntry.id}`)
        .set('Authorization', `Bearer ${adminToken1}`)
        .set('X-Tenant-ID', tenant1Slug);

      expect(getT2IdFromT1.status).toBe(404);
    });
  });
});
