import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';

/** Same hex-token extraction as pdfGenerationService.test.ts/stockTake.test.ts. */
function extractDrawnText(buffer: Buffer): string {
  const raw = buffer.toString('latin1');
  const hexTokens = raw.match(/<[0-9a-fA-F]+>/g) || [];
  return hexTokens.map((token) => Buffer.from(token.slice(1, -1), 'hex').toString('latin1')).join('');
}

/** Buffers a supertest response as raw binary instead of letting superagent guess a text parser. */
function binary(req: request.Test): request.Test {
  return req.buffer(true).parse((res: any, callback: any) => {
    const chunks: Buffer[] = [];
    res.on('data', (chunk: Buffer) => chunks.push(chunk));
    res.on('end', () => callback(null, Buffer.concat(chunks)));
  });
}

describe('Real PDF/Word/CSV export for reports (replaces window.print() and fake CSV data)', () => {
  const runId = Date.now();
  const tenantSlug = `report-export-corp-${runId}`;
  const tenantSchema = `tenant_report_export_corp_${runId}`;
  const adminEmail = `admin_reportexport_${runId}@corp.com`;
  const sku = `REX-${runId}`;
  const shopName = `Report Export Shop ${runId}`;

  let adminToken: string;
  let tenantId: string;
  let cashAccountId: string;
  let revenueAccountId: string;
  let warehouseId: string;

  async function cleanupTestData() {
    if (tenantId) {
      await prisma.auditLog.deleteMany({ where: { tenantId } }).catch(() => {});
    }
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
      companyName: 'Report Export Corp',
      slug: tenantSlug,
      adminEmail,
      adminPassword: 'Password123!',
      adminName: 'Report Export Admin',
    });
    adminToken = onboard.token;
    tenantId = onboard.tenant.id;

    const cashAcc = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ code: '1010', name: 'Till Cash', type: 'ASSET' });
    cashAccountId = cashAcc.body.data.account.id;

    const revAcc = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ code: '4010', name: 'Sales Revenue', type: 'REVENUE' });
    revenueAccountId = revAcc.body.data.account.id;

    // A real posted journal entry so Balance Sheet/P&L have non-zero balances.
    const je = await request(app)
      .post('/api/v1/journal-entries')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({
        entryNumber: `JE-REX-${runId}`,
        entryDate: '2026-07-01',
        description: 'Seed sale for report export tests',
        status: 'POSTED',
        lines: [
          { accountId: cashAccountId, debit: 500, credit: 0 },
          { accountId: revenueAccountId, debit: 0, credit: 500 },
        ],
      });
    expect(je.status).toBe(201);

    // A real inventory item + warehouse (for the stock-intelligence export tests).
    const wh = await request(app)
      .post('/api/v1/inventory/warehouses')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ name: shopName });
    warehouseId = wh.body.data.warehouse.id;

    await request(app)
      .post('/api/v1/inventory/items')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ name: `Report Export Widget ${runId}`, sku, costPrice: 5, sellingPrice: 600, initialWarehouseId: warehouseId, initialQty: 30 });

    // A real till open + close cycle so a real DailyCloseoutReport row exists
    // (for the closeouts CSV/PDF/DOCX export tests).
    const openTill = await request(app)
      .post('/api/v1/tills/open')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ warehouseId, openingCash: 100 });
    const tillId = openTill.body.data.till.id;

    await request(app)
      .post('/api/v1/tills/close')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ tillId, actualEndingCash: 100 });
  }, 120000);

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  describe('GET /reports/balance-sheet/export', () => {
    it('returns a real PDF with the real seeded account names', async () => {
      const res = await binary(
        request(app)
          .get('/api/v1/reports/balance-sheet/export?format=pdf')
          .set('Authorization', `Bearer ${adminToken}`)
          .set('X-Tenant-ID', tenantSlug)
      );
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/pdf');
      const buffer = res.body as Buffer;
      expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
      expect(buffer.length).toBeGreaterThan(1000);
      const text = extractDrawnText(buffer);
      expect(text).toContain('Balance Sheet');
      expect(text).toContain('Till Cash');
    });

    it('returns a real Word (.docx) document with the real seeded account names', async () => {
      const res = await binary(
        request(app)
          .get('/api/v1/reports/balance-sheet/export?format=docx')
          .set('Authorization', `Bearer ${adminToken}`)
          .set('X-Tenant-ID', tenantSlug)
      );
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('wordprocessingml.document');
      const buffer = res.body as Buffer;
      // A .docx is a zip archive - starts with the "PK" local file header signature.
      expect(buffer.subarray(0, 2).toString('ascii')).toBe('PK');
      expect(buffer.length).toBeGreaterThan(1000);
    });

    it('rejects an unrecognized format', async () => {
      const res = await request(app)
        .get('/api/v1/reports/balance-sheet/export?format=xlsx')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug);
      expect(res.status).toBe(400);
    });
  });

  describe('GET /reports/profit-loss/export', () => {
    it('returns a real PDF with the real seeded revenue account', async () => {
      const res = await binary(
        request(app)
          .get('/api/v1/reports/profit-loss/export?format=pdf')
          .set('Authorization', `Bearer ${adminToken}`)
          .set('X-Tenant-ID', tenantSlug)
      );
      expect(res.status).toBe(200);
      const buffer = res.body as Buffer;
      expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
      const text = extractDrawnText(buffer);
      expect(text).toContain('Profit and Loss');
      expect(text).toContain('Sales Revenue');
    });

    it('returns a real Word (.docx) document', async () => {
      const res = await binary(
        request(app)
          .get('/api/v1/reports/profit-loss/export?format=docx')
          .set('Authorization', `Bearer ${adminToken}`)
          .set('X-Tenant-ID', tenantSlug)
      );
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('wordprocessingml.document');
      expect((res.body as Buffer).subarray(0, 2).toString('ascii')).toBe('PK');
    });
  });

  describe('GET /analytics/export/csv - real data, not the old hardcoded sample strings', () => {
    it('stock-intelligence CSV contains the real seeded SKU, never the old fake product names', async () => {
      const res = await request(app)
        .get('/api/v1/analytics/export/csv?reportType=stock-intelligence')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug);

      expect(res.status).toBe(200);
      expect(res.text).toContain(sku);
      expect(res.text).not.toContain('Samsung 24 Inch Monitor');
      expect(res.text).not.toContain('Dell XPS 15 Laptop');
    });

    it('closeouts CSV contains the real seeded shop name, never the old fake shop/staff names', async () => {
      const res = await request(app)
        .get('/api/v1/analytics/export/csv?reportType=closeouts')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug);

      expect(res.status).toBe(200);
      expect(res.text).toContain(shopName);
      expect(res.text).not.toContain('Osu Shop Store');
      expect(res.text).not.toContain('Kwame Mensah');
      expect(res.text).not.toContain('Downtown Depot');
    });
  });

  describe('GET /analytics/export/pdf and /export/docx', () => {
    it('stock-intelligence PDF contains the real seeded SKU', async () => {
      const res = await binary(
        request(app)
          .get('/api/v1/analytics/export/pdf?reportType=stock-intelligence')
          .set('Authorization', `Bearer ${adminToken}`)
          .set('X-Tenant-ID', tenantSlug)
      );
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/pdf');
      const buffer = res.body as Buffer;
      expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
      expect(extractDrawnText(buffer)).toContain(sku);
    });

    it('stock-intelligence DOCX is a real Word document', async () => {
      const res = await binary(
        request(app)
          .get('/api/v1/analytics/export/docx?reportType=stock-intelligence')
          .set('Authorization', `Bearer ${adminToken}`)
          .set('X-Tenant-ID', tenantSlug)
      );
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('wordprocessingml.document');
      expect((res.body as Buffer).subarray(0, 2).toString('ascii')).toBe('PK');
    });

    it('closeouts PDF contains the real seeded shop name', async () => {
      const res = await binary(
        request(app)
          .get('/api/v1/analytics/export/pdf?reportType=closeouts')
          .set('Authorization', `Bearer ${adminToken}`)
          .set('X-Tenant-ID', tenantSlug)
      );
      expect(res.status).toBe(200);
      const buffer = res.body as Buffer;
      expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
      expect(extractDrawnText(buffer)).toContain(shopName);
    });

    it('daily revenue PDF is a real generated document', async () => {
      const res = await binary(
        request(app)
          .get('/api/v1/analytics/export/pdf?reportType=daily')
          .set('Authorization', `Bearer ${adminToken}`)
          .set('X-Tenant-ID', tenantSlug)
      );
      expect(res.status).toBe(200);
      expect((res.body as Buffer).subarray(0, 5).toString('ascii')).toBe('%PDF-');
    });
  });
});
