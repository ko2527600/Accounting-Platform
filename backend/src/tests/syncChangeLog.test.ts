import request from 'supertest';
import { randomUUID } from 'node:crypto';
import app from '../app';
import { prisma } from '../config/db';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';

describe('Local-first sync pilot: transactional outbox + bootstrap/changes endpoints', () => {
  const runId = Date.now();
  const tenantSlug = `sync-corp-1-${runId}`;
  const tenantSchema = `tenant_sync_corp_1_${runId}`;
  const adminEmail = `admin_sync_${runId}@corp1.com`;

  const otherSlug = `sync-corp-2-${runId}`;
  const otherSchema = `tenant_sync_corp_2_${runId}`;
  const otherEmail = `admin_sync_other_${runId}@corp2.com`;

  let tenantId: string;
  let adminToken: string;
  let customerId: string;

  let otherTenantId: string;
  let otherToken: string;

  async function cleanupTestData() {
    await prisma.syncChangeLog.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId].filter(Boolean) } } }).catch(() => {});
    await prisma.syncSequenceCounter.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId].filter(Boolean) } } }).catch(() => {});
    await deleteTenantBySlug(prisma, tenantSlug).catch(() => {});
    await deleteTenantBySlug(prisma, otherSlug).catch(() => {});
    await deleteUserByEmail(prisma, adminEmail).catch(() => {});
    await deleteUserByEmail(prisma, otherEmail).catch(() => {});
    await dropTenantSchema(prisma, tenantSchema).catch(() => {});
    await dropTenantSchema(prisma, otherSchema).catch(() => {});
  }

  beforeAll(async () => {
    await prisma.$connect();
    await ensureTenantTableExists(prisma);
    await ensureUserTableExists(prisma);

    const onboard = await onboardTenant(prisma, {
      companyName: 'Sync Corp 1',
      slug: tenantSlug,
      adminEmail,
      adminPassword: 'Password123!',
      adminName: 'Sync Corp 1 Admin',
    });
    adminToken = onboard.token;
    tenantId = onboard.tenant.id;

    const customer = await request(app)
      .post('/api/v1/invoices/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ name: 'Acme Customer', email: 'customer@acme.test' });
    customerId = customer.body.data.customer.id;

    const otherOnboard = await onboardTenant(prisma, {
      companyName: 'Sync Corp 2',
      slug: otherSlug,
      adminEmail: otherEmail,
      adminPassword: 'Password123!',
      adminName: 'Sync Corp 2 Admin',
    });
    otherToken = otherOnboard.token;
    otherTenantId = otherOnboard.tenant.id;
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it('logs an Account CREATE with the correct payload and an increasing sequence', async () => {
    const res = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ code: `SYNC-A-${runId}`, name: 'Sync Test Cash', type: 'ASSET' });
    expect(res.status).toBe(201);
    const accountId = res.body.data.account.id;

    const rows = await prisma.syncChangeLog.findMany({ where: { tenantId, entityType: 'Account', entityId: accountId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].operation).toBe('CREATE');
    expect((rows[0].payload as any).code).toBe(`SYNC-A-${runId}`);
    expect(BigInt(rows[0].sequence)).toBeGreaterThan(0n);
  });

  it('logs an Account UPDATE and DELETE, with DELETE carrying no payload', async () => {
    const create = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ code: `SYNC-B-${runId}`, name: 'Sync Test Update Me', type: 'EXPENSE' });
    const accountId = create.body.data.account.id;

    const update = await request(app)
      .put(`/api/v1/accounts/${accountId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ name: 'Sync Test Renamed' });
    expect(update.status).toBe(200);

    const del = await request(app)
      .delete(`/api/v1/accounts/${accountId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);
    expect(del.status).toBe(200);

    const rows = await prisma.syncChangeLog.findMany({
      where: { tenantId, entityType: 'Account', entityId: accountId },
      orderBy: { sequence: 'asc' },
    });
    expect(rows.map((r) => r.operation)).toEqual(['CREATE', 'UPDATE', 'DELETE']);
    expect((rows[1].payload as any).name).toBe('Sync Test Renamed');
    expect(rows[2].payload).toBeNull();
  });

  it('deduplicates two concurrent account creates sharing the same clientTxnId - exactly one account, one CREATE log entry', async () => {
    const clientTxnId = randomUUID();

    const [resA, resB] = await Promise.all([
      request(app)
        .post('/api/v1/accounts')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({ code: `SYNC-DEDUP-${runId}`, name: 'Sync Dedup Account', type: 'ASSET', clientTxnId }),
      request(app)
        .post('/api/v1/accounts')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({ code: `SYNC-DEDUP-${runId}`, name: 'Sync Dedup Account', type: 'ASSET', clientTxnId }),
    ]);

    const accountIds = new Set([resA.body.data.account.id, resB.body.data.account.id]);
    expect(accountIds.size).toBe(1);
    const accountId = [...accountIds][0];

    const rows = await prisma.syncChangeLog.findMany({ where: { tenantId, entityType: 'Account', entityId: accountId, operation: 'CREATE' } });
    expect(rows).toHaveLength(1);
  });

  it('logs an Invoice CREATE and a subsequent payment as a CREATE then UPDATE', async () => {
    const create = await request(app)
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ customerId, items: [{ description: 'Sync Widget', quantity: 1, unitPrice: 25 }] });
    expect(create.status).toBe(201);
    const invoiceId = create.body.data.invoice.id;

    const pay = await request(app)
      .post(`/api/v1/invoices/${invoiceId}/pay`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({});
    expect(pay.status).toBe(200);

    const rows = await prisma.syncChangeLog.findMany({
      where: { tenantId, entityType: 'Invoice', entityId: invoiceId },
      orderBy: { sequence: 'asc' },
    });
    expect(rows.map((r) => r.operation)).toEqual(['CREATE', 'UPDATE']);
    expect((rows[0].payload as any).status).toBe('SENT');
    expect((rows[1].payload as any).status).toBe('PAID');
  });

  it('deduplicates two concurrent invoice creates sharing the same clientTxnId - exactly one invoice, one CREATE log entry', async () => {
    const clientTxnId = `${runId}-0000-4000-8000-000000000002`;

    const [resA, resB] = await Promise.all([
      request(app)
        .post('/api/v1/invoices')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({ customerId, items: [{ description: 'Dedup Widget', quantity: 1, unitPrice: 5 }], clientTxnId }),
      request(app)
        .post('/api/v1/invoices')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantSlug)
        .send({ customerId, items: [{ description: 'Dedup Widget', quantity: 1, unitPrice: 5 }], clientTxnId }),
    ]);

    const statuses = [resA.status, resB.status].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 201]);

    const invoiceIds = new Set([resA.body.data.invoice.id, resB.body.data.invoice.id]);
    expect(invoiceIds.size).toBe(1);

    const dbInvoices = await prisma.invoice.findMany({ where: { tenantId, clientTxnId } });
    expect(dbInvoices).toHaveLength(1);

    const rows = await prisma.syncChangeLog.findMany({
      where: { tenantId, entityType: 'Invoice', entityId: dbInvoices[0].id, operation: 'CREATE' },
    });
    expect(rows).toHaveLength(1);
  });

  it('GET /sync/bootstrap returns this tenant\'s accounts/invoices and current sequence, never another tenant\'s data', async () => {
    const bootstrap = await request(app)
      .get('/api/v1/sync/bootstrap')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);
    expect(bootstrap.status).toBe(200);
    expect(Array.isArray(bootstrap.body.data.accounts)).toBe(true);
    expect(Array.isArray(bootstrap.body.data.invoices)).toBe(true);
    expect(bootstrap.body.data.accounts.some((a: any) => a.code === `SYNC-A-${runId}`)).toBe(true);
    expect(BigInt(bootstrap.body.data.sequence)).toBeGreaterThan(0n);

    // The other tenant has made no syncable writes at all - its bootstrap
    // must be empty, and critically must never include tenant 1's data.
    const otherBootstrap = await request(app)
      .get('/api/v1/sync/bootstrap')
      .set('Authorization', `Bearer ${otherToken}`)
      .set('X-Tenant-ID', otherSlug);
    expect(otherBootstrap.status).toBe(200);
    expect(otherBootstrap.body.data.accounts).toEqual([]);
    expect(otherBootstrap.body.data.invoices).toEqual([]);
    expect(otherBootstrap.body.data.sequence).toBe('0');
  });

  it('GET /sync/changes?since=X returns only entries after X, and is tenant-isolated', async () => {
    const before = await request(app)
      .get('/api/v1/sync/bootstrap')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);
    const sinceSeq = before.body.data.sequence;

    const created = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ code: `SYNC-CHANGES-${runId}`, name: 'Sync Changes Account', type: 'LIABILITY' });
    const accountId = created.body.data.account.id;

    const changes = await request(app)
      .get('/api/v1/sync/changes')
      .query({ since: sinceSeq })
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);
    expect(changes.status).toBe(200);
    expect(changes.body.data.changes.length).toBeGreaterThanOrEqual(1);
    expect(changes.body.data.changes.every((c: any) => BigInt(c.sequence) > BigInt(sinceSeq))).toBe(true);
    expect(changes.body.data.changes.some((c: any) => c.entityType === 'Account' && c.entityId === accountId)).toBe(true);

    // Same cursor, other tenant's session - must never see tenant 1's new account.
    const otherChanges = await request(app)
      .get('/api/v1/sync/changes')
      .query({ since: '0' })
      .set('Authorization', `Bearer ${otherToken}`)
      .set('X-Tenant-ID', otherSlug);
    expect(otherChanges.status).toBe(200);
    expect(otherChanges.body.data.changes.some((c: any) => c.entityId === accountId)).toBe(false);
  });

  it('rejects a non-numeric "since" cursor with a 400 instead of a raw parse error', async () => {
    const res = await request(app)
      .get('/api/v1/sync/changes')
      .query({ since: 'not-a-number' })
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);
    expect(res.status).toBe(400);
  });
});
