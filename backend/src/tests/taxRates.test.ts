import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';

describe('Tax Rates API (CRUD, tenant isolation, real invoice tax calculation)', () => {
  const runId = Date.now();
  const tenant1Slug = `tax-corp-1-${runId}`;
  const tenant1Schema = `tenant_tax_corp_1_${runId}`;
  const admin1Email = `admin_tax1_${runId}@corp1.com`;

  const tenant2Slug = `tax-corp-2-${runId}`;
  const tenant2Schema = `tenant_tax_corp_2_${runId}`;
  const admin2Email = `admin_tax2_${runId}@corp2.com`;

  let token1: string;
  let token2: string;
  let tenant1Id: string | undefined;
  let tenant2Id: string | undefined;
  let customerId: string;

  async function cleanupTestData() {
    const ids = [tenant1Id, tenant2Id].filter((id): id is string => Boolean(id));
    if (ids.length > 0) {
      await prisma.taxRate.deleteMany({ where: { tenantId: { in: ids } } }).catch(() => {});
    }
    await deleteTenantBySlug(prisma, tenant1Slug).catch(() => {});
    await deleteTenantBySlug(prisma, tenant2Slug).catch(() => {});
    await deleteUserByEmail(prisma, admin1Email).catch(() => {});
    await deleteUserByEmail(prisma, admin2Email).catch(() => {});
    await dropTenantSchema(prisma, tenant1Schema).catch(() => {});
    await dropTenantSchema(prisma, tenant2Schema).catch(() => {});
  }

  beforeAll(async () => {
    await prisma.$connect();
    await ensureTenantTableExists(prisma);
    await ensureUserTableExists(prisma);
    await cleanupTestData();

    const onboard1 = await onboardTenant(prisma, {
      companyName: 'Tax Isolation Corp 1',
      slug: tenant1Slug,
      adminEmail: admin1Email,
      adminPassword: 'Password123!',
      adminName: 'Tax Corp 1 Admin',
    });
    token1 = onboard1.token;
    tenant1Id = onboard1.tenant.id;

    const onboard2 = await onboardTenant(prisma, {
      companyName: 'Tax Isolation Corp 2',
      slug: tenant2Slug,
      adminEmail: admin2Email,
      adminPassword: 'Password123!',
      adminName: 'Tax Corp 2 Admin',
    });
    token2 = onboard2.token;
    tenant2Id = onboard2.tenant.id;

    const customer = await request(app)
      .post('/api/v1/invoices/customers')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ name: 'Tax Test Customer', email: 'customer@taxtest.test' });
    customerId = customer.body.data.customer.id;
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it('creates a tax rate with validation on rate bounds and required fields', async () => {
    const badRate = await request(app)
      .post('/api/v1/tax-rates')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ name: 'Bad Rate', code: 'BAD1', rate: 1.5, effectiveFrom: '2020-01-01' });
    expect(badRate.status).toBe(400);

    const missingName = await request(app)
      .post('/api/v1/tax-rates')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ code: 'NONAME', rate: 0.1, effectiveFrom: '2020-01-01' });
    expect(missingName.status).toBe(400);
  });

  it('rejects duplicate codes within the same tenant, but allows the same code in a different tenant', async () => {
    const first = await request(app)
      .post('/api/v1/tax-rates')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ name: 'Standard VAT', code: 'VAT-STD', rate: 0.15, effectiveFrom: '2020-01-01' });
    expect(first.status).toBe(201);

    const duplicate = await request(app)
      .post('/api/v1/tax-rates')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ name: 'Standard VAT Again', code: 'VAT-STD', rate: 0.2, effectiveFrom: '2020-01-01' });
    expect(duplicate.status).toBe(409);

    const otherTenantSameCode = await request(app)
      .post('/api/v1/tax-rates')
      .set('Authorization', `Bearer ${token2}`)
      .set('X-Tenant-ID', tenant2Slug)
      .send({ name: 'Standard VAT (Tenant 2)', code: 'VAT-STD', rate: 0.2, effectiveFrom: '2020-01-01' });
    expect(otherTenantSameCode.status).toBe(201);
  });

  it('does not let one tenant see or use another tenant\'s tax rates', async () => {
    const tenant1List = await request(app)
      .get('/api/v1/tax-rates')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug);
    const tenant2List = await request(app)
      .get('/api/v1/tax-rates')
      .set('Authorization', `Bearer ${token2}`)
      .set('X-Tenant-ID', tenant2Slug);

    const tenant1Codes = tenant1List.body.data.taxRates.map((t: any) => t.code);
    const tenant2Codes = tenant2List.body.data.taxRates.map((t: any) => t.code);
    expect(tenant1Codes).toContain('VAT-STD');
    expect(tenant2Codes).toContain('VAT-STD');

    const tenant2RateId = tenant2List.body.data.taxRates[0].id;
    const crossTenantFetch = await request(app)
      .get(`/api/v1/tax-rates/${tenant2RateId}`)
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug);
    expect(crossTenantFetch.status).toBe(404);
  });

  it('applies the real active tax rate to a new invoice instead of a hardcoded percentage', async () => {
    const invoiceRes = await request(app)
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ customerId, items: [{ description: 'Consulting', quantity: 1, unitPrice: 1000 }] });

    expect(invoiceRes.status).toBe(201);
    const invoice = invoiceRes.body.data.invoice;
    expect(Number(invoice.subtotal)).toBeCloseTo(1000, 2);
    // VAT-STD is 0.15 (15%), not the old hardcoded 0.10
    expect(Number(invoice.tax)).toBeCloseTo(150, 2);
    expect(Number(invoice.total)).toBeCloseTo(1150, 2);
    expect(invoice.taxRate?.code).toBe('VAT-STD');
  });

  it('requires an explicit taxRateId when more than one active rate covers the invoice date', async () => {
    const secondRate = await request(app)
      .post('/api/v1/tax-rates')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ name: 'Reduced Rate', code: 'VAT-RED', rate: 0.05, effectiveFrom: '2020-01-01' });
    expect(secondRate.status).toBe(201);

    const ambiguousInvoice = await request(app)
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ customerId, items: [{ description: 'Consulting 2', quantity: 1, unitPrice: 500 }] });
    expect(ambiguousInvoice.status).toBe(400);

    const explicitInvoice = await request(app)
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({
        customerId,
        taxRateId: secondRate.body.data.taxRate.id,
        items: [{ description: 'Consulting 3', quantity: 1, unitPrice: 500 }],
      });
    expect(explicitInvoice.status).toBe(201);
    expect(Number(explicitInvoice.body.data.invoice.tax)).toBeCloseTo(25, 2);
  });

  it('blocks deleting a tax rate that is referenced by an invoice', async () => {
    const list = await request(app)
      .get('/api/v1/tax-rates')
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug);
    const vatStd = list.body.data.taxRates.find((t: any) => t.code === 'VAT-STD');

    const deleteRes = await request(app)
      .delete(`/api/v1/tax-rates/${vatStd.id}`)
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-ID', tenant1Slug);
    expect(deleteRes.status).toBe(400);
  });

  describe('Layered tax rate breakdown (Ghana VAT + NHIL + GETFund)', () => {
    it('creates a layered tax rate whose components sum to the total rate', async () => {
      const res = await request(app)
        .post('/api/v1/tax-rates')
        .set('Authorization', `Bearer ${token1}`)
        .set('X-Tenant-ID', tenant1Slug)
        .send({
          name: 'Ghana Standard VAT',
          code: 'GH-VAT-STD',
          rate: 0.20,
          effectiveFrom: '2026-01-01',
          components: [
            { name: 'VAT', rate: 0.15 },
            { name: 'NHIL', rate: 0.025 },
            { name: 'GETFund Levy', rate: 0.025 },
          ],
        });
      expect(res.status).toBe(201);
      expect(res.body.data.taxRate.components).toHaveLength(3);
      expect(res.body.data.taxRate.components[0]).toEqual({ name: 'VAT', rate: 0.15 });
    });

    it('rejects a components breakdown that does not sum to the parent rate', async () => {
      const res = await request(app)
        .post('/api/v1/tax-rates')
        .set('Authorization', `Bearer ${token1}`)
        .set('X-Tenant-ID', tenant1Slug)
        .send({
          name: 'Mismatched Levy',
          code: 'GH-BAD-1',
          rate: 0.20,
          effectiveFrom: '2026-01-01',
          components: [{ name: 'VAT', rate: 0.15 }, { name: 'NHIL', rate: 0.02 }],
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('must sum to');
    });

    it('rejects a component with a missing name or an invalid rate', async () => {
      const missingName = await request(app)
        .post('/api/v1/tax-rates')
        .set('Authorization', `Bearer ${token1}`)
        .set('X-Tenant-ID', tenant1Slug)
        .send({
          name: 'Bad Component',
          code: 'GH-BAD-2',
          rate: 0.20,
          effectiveFrom: '2026-01-01',
          components: [{ rate: 0.2 }],
        });
      expect(missingName.status).toBe(400);

      const badRate = await request(app)
        .post('/api/v1/tax-rates')
        .set('Authorization', `Bearer ${token1}`)
        .set('X-Tenant-ID', tenant1Slug)
        .send({
          name: 'Bad Component Rate',
          code: 'GH-BAD-3',
          rate: 0.20,
          effectiveFrom: '2026-01-01',
          components: [{ name: 'VAT', rate: 1.5 }],
        });
      expect(badRate.status).toBe(400);
    });

    it('computes a real per-levy breakdown on an invoice using an explicit layered tax rate', async () => {
      const list = await request(app)
        .get('/api/v1/tax-rates')
        .set('Authorization', `Bearer ${token1}`)
        .set('X-Tenant-ID', tenant1Slug);
      const ghanaVat = list.body.data.taxRates.find((t: any) => t.code === 'GH-VAT-STD');

      const invoiceRes = await request(app)
        .post('/api/v1/invoices')
        .set('Authorization', `Bearer ${token1}`)
        .set('X-Tenant-ID', tenant1Slug)
        .send({
          customerId,
          taxRateId: ghanaVat.id,
          items: [{ description: 'Layered tax test', quantity: 1, unitPrice: 1000 }],
        });

      expect(invoiceRes.status).toBe(201);
      const invoice = invoiceRes.body.data.invoice;
      expect(Number(invoice.tax)).toBeCloseTo(200, 2);
      expect(Number(invoice.total)).toBeCloseTo(1200, 2);
      expect(invoice.taxBreakdown).toHaveLength(3);
      const vatLine = invoice.taxBreakdown.find((c: any) => c.name === 'VAT');
      const nhilLine = invoice.taxBreakdown.find((c: any) => c.name === 'NHIL');
      const getfundLine = invoice.taxBreakdown.find((c: any) => c.name === 'GETFund Levy');
      expect(vatLine.amount).toBeCloseTo(150, 2);
      expect(nhilLine.amount).toBeCloseTo(25, 2);
      expect(getfundLine.amount).toBeCloseTo(25, 2);
    });

    it('rejects changing the rate on a layered tax rate without also updating its components', async () => {
      const list = await request(app)
        .get('/api/v1/tax-rates')
        .set('Authorization', `Bearer ${token1}`)
        .set('X-Tenant-ID', tenant1Slug);
      const ghanaVat = list.body.data.taxRates.find((t: any) => t.code === 'GH-VAT-STD');

      const res = await request(app)
        .put(`/api/v1/tax-rates/${ghanaVat.id}`)
        .set('Authorization', `Bearer ${token1}`)
        .set('X-Tenant-ID', tenant1Slug)
        .send({ rate: 0.25 });
      expect(res.status).toBe(400);
    });

    it('allows clearing a components breakdown by setting components to null', async () => {
      const list = await request(app)
        .get('/api/v1/tax-rates')
        .set('Authorization', `Bearer ${token1}`)
        .set('X-Tenant-ID', tenant1Slug);
      const ghanaVat = list.body.data.taxRates.find((t: any) => t.code === 'GH-VAT-STD');

      const cleared = await request(app)
        .put(`/api/v1/tax-rates/${ghanaVat.id}`)
        .set('Authorization', `Bearer ${token1}`)
        .set('X-Tenant-ID', tenant1Slug)
        .send({ components: null });
      expect(cleared.status).toBe(200);
      expect(cleared.body.data.taxRate.components).toBeNull();

      const rateChange = await request(app)
        .put(`/api/v1/tax-rates/${ghanaVat.id}`)
        .set('Authorization', `Bearer ${token1}`)
        .set('X-Tenant-ID', tenant1Slug)
        .send({ rate: 0.25 });
      expect(rateChange.status).toBe(200);
      expect(Number(rateChange.body.data.taxRate.rate)).toBeCloseTo(0.25, 4);
    });
  });
});
