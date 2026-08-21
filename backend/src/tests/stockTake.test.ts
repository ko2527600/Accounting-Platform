import { deleteAuditLogs } from './testHelpers';
import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';

/**
 * Same hex-token extraction as pdfGenerationService.test.ts - reconstructs the
 * literal text pdfkit drew via TJ show-text operators well enough to search
 * for known phrases (and, critically here, to prove a number is absent).
 */
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

describe('Stock Take: printable blind-count sheets + reconciliation', () => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tenantSlug = `stock-take-corp-${runId}`;
  const tenantSchema = `tenant_stock_take_corp_${runId}`;
  const adminEmail = `admin_stocktake_${runId}@corp.com`;
  const managerEmail = `manager_stocktake_${runId}@corp.com`;
  const skuA = `STA-${runId}`;
  const skuB = `STB-${runId}`;

  let adminToken: string;
  let tenantId: string;
  let managerToken: string;
  let warehouseAId: string;
  let warehouseBId: string;
  let itemAId: string;
  let itemBId: string;

  async function cleanupTestData() {
    if (tenantId) {
      await deleteAuditLogs(prisma, { tenantId });
    }
    await deleteTenantBySlug(prisma, tenantSlug).catch(() => {});
    await deleteUserByEmail(prisma, adminEmail).catch(() => {});
    await deleteUserByEmail(prisma, managerEmail).catch(() => {});
    await dropTenantSchema(prisma, tenantSchema).catch(() => {});
  }

  beforeAll(async () => {
    await prisma.$connect();
    await ensureTenantTableExists(prisma);
    await ensureUserTableExists(prisma);
    await cleanupTestData();

    const onboard = await onboardTenant(prisma, {
      companyName: 'Stock Take Corp',
      slug: tenantSlug,
      adminEmail,
      adminPassword: 'Password123!',
      adminName: 'Stock Take Admin',
    });
    adminToken = onboard.token;
    tenantId = onboard.tenant.id;

    const whA = await request(app)
      .post('/api/v1/inventory/warehouses')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ name: 'Shop A' });
    warehouseAId = whA.body.data.warehouse.id;

    const whB = await request(app)
      .post('/api/v1/inventory/warehouses')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ name: 'Shop B' });
    warehouseBId = whB.body.data.warehouse.id;

    const itemA = await request(app)
      .post('/api/v1/inventory/items')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ name: 'Stock Take Widget A', sku: skuA, costPrice: 1, sellingPrice: 2, initialWarehouseId: warehouseAId, initialQty: 42 });
    itemAId = itemA.body.data.item.id;

    const itemB = await request(app)
      .post('/api/v1/inventory/items')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ name: 'Stock Take Widget B', sku: skuB, costPrice: 1, sellingPrice: 2, initialWarehouseId: warehouseAId, initialQty: 17 });
    itemBId = itemB.body.data.item.id;

    // Shop Manager scoped only to Shop B - proves the new routes are access-scoped
    // the same way every other warehouse route already is.
    const invite = await request(app)
      .post('/api/v1/tenants/invite')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ email: managerEmail, role: 'Shop Manager', warehouseIds: [warehouseBId] });
    expect(invite.status).toBe(201);

    const accept = await request(app)
      .post('/api/v1/auth/accept-invitation')
      .send({ token: invite.body.data.invitation.token, name: 'Shop B Manager', password: 'Password123!' });
    expect(accept.status).toBe(200);
    managerToken = accept.body.data.token;
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  describe('GET /inventory/warehouses/:id/stock-sheet.pdf', () => {
    it('returns a real blind-count PDF listing SKUs but never a system quantity', async () => {
      const res = await binary(
        request(app)
          .get(`/api/v1/inventory/warehouses/${warehouseAId}/stock-sheet.pdf`)
          .set('Authorization', `Bearer ${adminToken}`)
          .set('X-Tenant-ID', tenantSlug)
      );

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/pdf');

      const buffer = res.body as Buffer;
      expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');

      const text = extractDrawnText(buffer);
      expect(text).toContain('Blind Stock Count Sheet');
      expect(text).toContain(skuA);
      expect(text).toContain(skuB);
      expect(text).toContain('Stock Take Widget A');
      expect(text).toContain('Stock Take Widget B');

      // The actual blind-count regression check: the real system quantities
      // (42 and 17) must never be rendered anywhere on the sheet. Strip out the
      // SKU text first, since the SKUs are timestamp-derived and can otherwise
      // coincidentally contain "42"/"17" as a substring of the run id itself.
      // Also strip the sheet's own "Date: <day> <month> <year>" line (see
      // pdfGenerationService.ts) - legitimate content, not a leaked quantity,
      // but the day-of-month can itself coincidentally equal 17 or 42 (any
      // month has a 17th), which would otherwise fail this assertion on
      // whatever date the suite happens to run.
      const dateLabel = new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });
      const textWithoutSkus = text.split(skuA).join('').split(skuB).join('').split(dateLabel).join('');
      expect(textWithoutSkus).not.toContain('42');
      expect(textWithoutSkus).not.toContain('17');
    });

    it('blocks a Shop Manager without access to the target warehouse', async () => {
      const res = await request(app)
        .get(`/api/v1/inventory/warehouses/${warehouseAId}/stock-sheet.pdf`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Tenant-ID', tenantSlug);

      expect(res.status).toBe(403);
    });
  });

  describe('POST /inventory/stock-take', () => {
    it('adjusts only variant items and leaves matching items untouched', async () => {
      const res = await request(app)
        .post('/api/v1/inventory/stock-take')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({
          warehouseId: warehouseAId,
          counts: [
            { itemId: itemAId, countedQty: 42 }, // matches system quantity -> unchanged
            { itemId: itemBId, countedQty: 20 }, // differs from 17 -> applied
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.data.applied).toHaveLength(1);
      expect(res.body.data.applied[0].itemId).toBe(itemBId);
      expect(res.body.data.applied[0].previousQty).toBe(17);
      expect(res.body.data.applied[0].newQty).toBe(20);
      expect(res.body.data.unchanged).toHaveLength(1);
      expect(res.body.data.unchanged[0].itemId).toBe(itemAId);
      expect(res.body.data.notFound).toHaveLength(0);
      expect(res.body.data.stockTakeRef).toBeTruthy();

      const adjustmentsForB = await request(app)
        .get('/api/v1/inventory/adjustments')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug)
        .query({ itemId: itemBId });
      expect(adjustmentsForB.body.data.adjustments).toHaveLength(1);
      expect(adjustmentsForB.body.data.adjustments[0].mode).toBe('set');
      expect(adjustmentsForB.body.data.adjustments[0].reason).toContain(res.body.data.stockTakeRef.slice(0, 8));

      const adjustmentsForA = await request(app)
        .get('/api/v1/inventory/adjustments')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug)
        .query({ itemId: itemAId });
      expect(adjustmentsForA.body.data.adjustments).toHaveLength(0);

      const auditRows = await prisma.auditLog.findMany({
        where: { tenantId, action: 'STOCK_TAKE.RECONCILED', entityId: res.body.data.stockTakeRef },
      });
      expect(auditRows).toHaveLength(1);
    });

    it('rejects the whole batch when a counted quantity is malformed', async () => {
      const res = await request(app)
        .post('/api/v1/inventory/stock-take')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({ warehouseId: warehouseAId, counts: [{ itemId: itemAId, countedQty: -5 }] });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('blocks a Shop Manager without access to the target warehouse', async () => {
      const res = await request(app)
        .post('/api/v1/inventory/stock-take')
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({ warehouseId: warehouseAId, counts: [{ itemId: itemAId, countedQty: 42 }] });

      expect(res.status).toBe(403);
    });
  });
});
