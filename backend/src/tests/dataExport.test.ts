import request from 'supertest';
import JSZip from 'jszip';
import app from '../app';
import { prisma } from '../config/db';
import { generateJwtToken } from '../utils/jwt';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists, createUser } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';
import { EXPORT_TABLES } from '../services/dataExportService';

/** Buffers a supertest response as raw binary instead of letting superagent guess a text parser. */
function binary(req: request.Test): request.Test {
  return req.buffer(true).parse((res: any, callback: any) => {
    const chunks: Buffer[] = [];
    res.on('data', (chunk: Buffer) => chunks.push(chunk));
    res.on('end', () => callback(null, Buffer.concat(chunks)));
  });
}

describe('Full tenant data export (Phase 2 trust feature - no paywall, no cooldown)', () => {
  const runId = Date.now();
  const tenantSlug = `data-export-corp-${runId}`;
  const tenantSchema = `tenant_data_export_corp_${runId}`;
  const adminEmail = `admin_dataexport_${runId}@corp.com`;
  const viewerEmail = `viewer_dataexport_${runId}@corp.com`;

  let adminToken: string;
  let viewerToken: string;
  let tenantId: string;
  let accountId: string;

  async function cleanupTestData() {
    if (tenantId) {
      await prisma.auditLog.deleteMany({ where: { tenantId } }).catch(() => {});
    }
    await deleteTenantBySlug(prisma, tenantSlug).catch(() => {});
    await deleteUserByEmail(prisma, adminEmail).catch(() => {});
    await deleteUserByEmail(prisma, viewerEmail).catch(() => {});
    await dropTenantSchema(prisma, tenantSchema).catch(() => {});
  }

  beforeAll(async () => {
    await prisma.$connect();
    await ensureTenantTableExists(prisma);
    await ensureUserTableExists(prisma);
    await cleanupTestData();

    const onboard = await onboardTenant(prisma, {
      companyName: 'Data Export Corp',
      slug: tenantSlug,
      adminEmail,
      adminPassword: 'Password123!',
      adminName: 'Data Export Admin',
    });
    adminToken = onboard.token;
    tenantId = onboard.tenant.id;

    const acc = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ code: '1010', name: 'Export Test Cash', type: 'ASSET' });
    accountId = acc.body.data.account.id;

    const viewer = await createUser(prisma, {
      email: viewerEmail,
      password: 'Password123!',
      name: 'Export Test Viewer',
      role: 'Viewer',
      tenantId,
    });
    viewerToken = generateJwtToken({ id: viewer.id, email: viewer.email, role: viewer.role, tenantId });
  }, 120000);

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  describe('GET /api/v1/data-export/manifest', () => {
    it('lists every exported table with a label and description, requiring no special query params', async () => {
      const res = await request(app)
        .get('/api/v1/data-export/manifest')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(EXPORT_TABLES.length);
      const accountsEntry = res.body.data.find((t: any) => t.key === 'accounts');
      expect(accountsEntry.label).toBe('Chart of Accounts');
      expect(accountsEntry.description).toBeTruthy();
    });

    it('rejects a non-Admin role', async () => {
      const res = await request(app)
        .get('/api/v1/data-export/manifest')
        .set('Authorization', `Bearer ${viewerToken}`)
        .set('X-Tenant-ID', tenantSlug);

      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/v1/data-export/json', () => {
    it('returns every table for this tenant, including the seeded account, with no pricing-tier gate', async () => {
      const res = await request(app)
        .get('/api/v1/data-export/json')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug);

      expect(res.status).toBe(200);
      expect(res.body.tenant.id).toBe(tenantId);
      for (const table of EXPORT_TABLES) {
        expect(Array.isArray(res.body.tables[table.key])).toBe(true);
      }
      const accountRow = res.body.tables.accounts.find((a: any) => a.id === accountId);
      expect(accountRow).toBeTruthy();
      expect(accountRow.code).toBe('1010');

      // Also writes its own audit trail entry - exporting your own data is
      // still an auditable event, same as any other access to it.
      const auditRows = await prisma.auditLog.findMany({ where: { tenantId, action: 'DATA_EXPORT.DOWNLOADED' } });
      expect(auditRows.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('GET /api/v1/data-export/csv', () => {
    it('returns a real ZIP with a README and one CSV per table, including the seeded account row', async () => {
      const res = await binary(
        request(app)
          .get('/api/v1/data-export/csv')
          .set('Authorization', `Bearer ${adminToken}`)
          .set('X-Tenant-ID', tenantSlug)
      );

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/zip');

      const zip = await JSZip.loadAsync(res.body as Buffer);
      expect(Object.keys(zip.files)).toContain('README.txt');
      const readme = await zip.files['README.txt'].async('string');
      expect(readme).toContain('Ledgio full data export');
      expect(readme).toContain('accounts.csv');

      for (const table of EXPORT_TABLES) {
        expect(Object.keys(zip.files)).toContain(`${table.key}.csv`);
      }

      const accountsCsv = await zip.files['accounts.csv'].async('string');
      expect(accountsCsv).toContain('1010');
      expect(accountsCsv).toContain('Export Test Cash');

      const teamCsv = await zip.files['team_members.csv'].async('string');
      expect(teamCsv).not.toContain('password');
      expect(teamCsv.toLowerCase()).not.toMatch(/\bpassword123/);
    });
  });
});
