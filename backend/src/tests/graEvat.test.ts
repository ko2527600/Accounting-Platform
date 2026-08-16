import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';

/**
 * GRA E-VAT / VSDC scaffolding. graEvatService.requestClearance() throws
 * unconditionally today (see that file's own doc comment) because GRA only
 * hands out its real API specification during a taxpayer's own bespoke
 * onboarding - there is no public wire format to build the real call
 * against yet. These tests verify the honest-failure path end to end
 * (real 501, real error persisted on the invoice, no fabricated success)
 * rather than a fake clearance, plus the graTin/vatRegistered settings
 * that gate a tenant into GRA's onboarding process.
 */
describe('GRA E-VAT clearance scaffolding', () => {
  const runId = Date.now();
  const tenantSlug = `gra-evat-corp-${runId}`;
  const tenantSchema = `tenant_gra_evat_corp_${runId}`;
  const adminEmail = `admin_gra_evat_${runId}@corp.com`;

  let adminToken: string;
  let customerId: string;

  async function cleanupTestData() {
    await deleteTenantBySlug(prisma, tenantSlug).catch(() => {});
    await deleteUserByEmail(prisma, adminEmail).catch(() => {});
    await dropTenantSchema(prisma, tenantSchema).catch(() => {});
  }

  function authed(req: request.Test): request.Test {
    return req.set('Authorization', `Bearer ${adminToken}`).set('X-Tenant-ID', tenantSlug);
  }

  async function createInvoice(amount: number) {
    const res = await authed(request(app).post('/api/v1/invoices')).send({
      customerId,
      items: [{ description: 'Consulting', quantity: 1, unitPrice: amount }],
    });
    expect(res.status).toBe(201);
    return res.body.data.invoice;
  }

  beforeAll(async () => {
    await prisma.$connect();
    await ensureTenantTableExists(prisma);
    await ensureUserTableExists(prisma);
    await cleanupTestData();

    const onboard = await onboardTenant(prisma, {
      companyName: 'Gra Evat Corp',
      slug: tenantSlug,
      adminEmail,
      adminPassword: 'Password123!',
      adminName: 'Gra Evat Admin',
    });
    adminToken = onboard.token;

    const customer = await authed(request(app).post('/api/v1/invoices/customers')).send({
      name: 'Evat Client', email: `evatclient_${runId}@client.com`,
    });
    customerId = customer.body.data.customer.id;
  }, 120000);

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it('never fakes a clearance: returns a real 501 and records the honest explanation on the invoice', async () => {
    const invoice = await createInvoice(500);

    const res = await authed(request(app).post(`/api/v1/invoices/${invoice.id}/gra-clearance`));

    expect(res.status).toBe(501);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('GRA only issues the API specification directly to a taxpayer');

    const invoicesRes = await authed(request(app).get('/api/v1/invoices'));
    const updated = invoicesRes.body.data.invoices.find((i: any) => i.id === invoice.id);
    expect(updated.graClearanceStatus).toBe('FAILED');
    expect(updated.graClearanceError).toContain('GRA only issues the API specification directly to a taxpayer');
  });

  it('rejects a clearance request for an invoice that does not exist', async () => {
    const res = await authed(request(app).post('/api/v1/invoices/00000000-0000-0000-0000-000000000000/gra-clearance'));
    expect(res.status).toBe(404);
  });

  it('refuses to re-request clearance for an invoice already marked CLEARED', async () => {
    const invoice = await createInvoice(750);

    // Nothing in this codebase can legitimately drive an invoice to CLEARED
    // yet (requestClearance() always throws) - seed the terminal state
    // directly, exactly as this feature's own real "already cleared" guard
    // would see it once GRA's real API is eventually wired up.
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { graClearanceStatus: 'CLEARED', graClearedAt: new Date() },
    });

    const res = await authed(request(app).post(`/api/v1/invoices/${invoice.id}/gra-clearance`));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('This invoice is already GRA-cleared.');
  });

  it('persists and returns graTin/vatRegistered via PUT /tenants/current', async () => {
    const putRes = await authed(request(app).put('/api/v1/tenants/current')).send({
      graTin: 'C0012345678',
      vatRegistered: true,
    });
    expect(putRes.status).toBe(200);
    expect(putRes.body.data.tenant.graTin).toBe('C0012345678');
    expect(putRes.body.data.tenant.vatRegistered).toBe(true);

    const getRes = await authed(request(app).get('/api/v1/tenants/current'));
    expect(getRes.body.data.tenant.graTin).toBe('C0012345678');
    expect(getRes.body.data.tenant.vatRegistered).toBe(true);
  });

  it('clears the TIN when PUT /tenants/current is sent an empty string', async () => {
    await authed(request(app).put('/api/v1/tenants/current')).send({ graTin: 'C0012345678', vatRegistered: true });

    const clearRes = await authed(request(app).put('/api/v1/tenants/current')).send({ graTin: '' });
    expect(clearRes.status).toBe(200);
    expect(clearRes.body.data.tenant.graTin).toBeNull();
  });
});
