import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';

describe('Bulk Import API (POST /api/v1/import/accounts, /journals)', () => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tenantSlug = `import-corp-${runId}`;
  const tenantSchema = `tenant_import_corp_${runId}`;
  const adminEmail = `admin_import_${runId}@corp.com`;

  let adminToken: string;

  async function cleanupTestData() {
    await deleteTenantBySlug(prisma, tenantSlug).catch(() => {});
    await deleteUserByEmail(prisma, adminEmail).catch(() => {});
    await dropTenantSchema(prisma, tenantSchema).catch(() => {});
  }

  beforeAll(async () => {
    await prisma.$connect();
    await ensureTenantTableExists(prisma);
    await ensureUserTableExists(prisma);
    await cleanupTestData();

    const onboard = await onboardTenant(prisma, {
      companyName: 'Import Corp',
      slug: tenantSlug,
      adminEmail,
      adminPassword: 'Password123!',
      adminName: 'Import Corp Admin',
    });
    adminToken = onboard.token;
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it('imports valid accounts and reports per-row errors for invalid ones', async () => {
    const res = await request(app)
      .post('/api/v1/import/accounts')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({
        accounts: [
          { code: '1010', name: 'Cash on Hand', type: 'ASSET' },
          { code: '4010', name: 'Consulting Revenue', type: 'REVENUE' },
          { code: '', name: 'Invalid Row', type: 'ASSET' }, // missing code -> should error
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.data.importedCount).toBe(2);
    expect(res.body.data.errorCount).toBe(1);
    expect(res.body.data.errors[0].row).toBe(3);

    const listRes = await request(app)
      .get('/api/v1/accounts')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);

    const codes = listRes.body.data.accounts.map((a: any) => a.code);
    expect(codes).toContain('1010');
    expect(codes).toContain('4010');
  });

  it('imports valid journal entries and reports per-row errors for bad account references', async () => {
    const cashAcc = await request(app)
      .get('/api/v1/accounts')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);
    const cash = cashAcc.body.data.accounts.find((a: any) => a.code === '1010');
    const revenue = cashAcc.body.data.accounts.find((a: any) => a.code === '4010');

    const res = await request(app)
      .post('/api/v1/import/journals')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({
        entries: [
          {
            description: 'Imported opening balance',
            lines: [
              { accountId: cash.id, debit: 200, credit: 0 },
              { accountId: revenue.id, debit: 0, credit: 200 },
            ],
          },
          {
            description: 'Bad reference row',
            lines: [
              { accountId: '00000000-0000-0000-0000-000000000000', debit: 50, credit: 0 },
              { accountId: revenue.id, debit: 0, credit: 50 },
            ],
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.data.importedCount).toBe(1);
    expect(res.body.data.errorCount).toBe(1);
    expect(res.body.data.errors[0].row).toBe(2);

    const entriesRes = await request(app)
      .get('/api/v1/journal-entries')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);

    const descriptions = entriesRes.body.data.journalEntries.map((e: any) => e.description);
    expect(descriptions).toContain('Imported opening balance');
  });
});
