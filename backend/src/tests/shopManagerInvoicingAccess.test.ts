import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';

/**
 * User request: "the shop manager should get access to the invoice and
 * vendor tabs so that when someone comes to buy they can create for them" -
 * a Shop Manager needed to be able to issue an invoice (and, for restocking,
 * a vendor bill) directly, instead of routing every walk-in credit sale
 * through an Accountant. Verifies both the new access itself and that it
 * stays properly scoped: warehouse-restricted (assertWarehouseAccess, same
 * as their existing Inventory/POS access), itemized-only for vendor bills
 * (a lump-sum bill has no stock to back it - see routes/bills.ts), and that
 * every other back-office invoice/bill action (email, GRA clearance, credit
 * notes, paying/scheduling a bill) is still Accountant-only. Cashier was
 * deliberately NOT granted this access - only Shop Manager asked for it.
 */
describe('Shop Manager: invoice and vendor bill access', () => {
  const runId = Date.now();
  const tenantSlug = `sm-invoicing-corp-${runId}`;
  const tenantSchema = `tenant_sm_invoicing_corp_${runId}`;
  const adminEmail = `admin_sminv_${runId}@corp.com`;
  const managerEmail = `manager_sminv_${runId}@corp.com`;
  const cashierEmail = `cashier_sminv_${runId}@corp.com`;

  let adminToken: string;
  let tenantId: string;
  let managerToken: string;
  let cashierToken: string;
  let warehouseAId: string; // manager's assigned shop
  let warehouseBId: string; // NOT assigned to the manager
  let itemId: string;
  let customerId: string;
  let vendorId: string;

  async function cleanupTestData() {
    if (tenantId) {
      await prisma.auditLog.deleteMany({ where: { tenantId } }).catch(() => {});
    }
    await deleteTenantBySlug(prisma, tenantSlug).catch(() => {});
    await deleteUserByEmail(prisma, adminEmail).catch(() => {});
    await deleteUserByEmail(prisma, managerEmail).catch(() => {});
    await deleteUserByEmail(prisma, cashierEmail).catch(() => {});
    await dropTenantSchema(prisma, tenantSchema).catch(() => {});
  }

  beforeAll(async () => {
    await prisma.$connect();
    await ensureTenantTableExists(prisma);
    await ensureUserTableExists(prisma);
    await cleanupTestData();

    const onboard = await onboardTenant(prisma, {
      companyName: 'Shop Manager Invoicing Corp',
      slug: tenantSlug,
      adminEmail,
      adminPassword: 'Password123!',
      adminName: 'Invoicing Admin',
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

    const item = await request(app)
      .post('/api/v1/inventory/items')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ name: 'Sellable Widget', costPrice: 5, sellingPrice: 10, initialWarehouseId: warehouseAId, initialQty: 20 });
    itemId = item.body.data.item.id;
    // Also stock Shop B so the cross-warehouse block below has real stock to touch.
    await request(app)
      .post('/api/v1/inventory/adjustments')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ warehouseId: warehouseBId, itemId, mode: 'add', quantity: 20, reason: 'Seed Shop B stock' });

    const customer = await request(app)
      .post('/api/v1/invoices/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ name: 'Walk-in Customer', email: `walkin_${runId}@example.com` });
    customerId = customer.body.data.customer.id;

    const vendor = await request(app)
      .post('/api/v1/bills/vendors')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ name: 'Restock Supplier', email: `supplier_${runId}@example.com` });
    vendorId = vendor.body.data.vendor.id;

    const inviteManager = await request(app)
      .post('/api/v1/tenants/invite')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ email: managerEmail, role: 'Shop Manager', warehouseIds: [warehouseAId] });
    const acceptManager = await request(app)
      .post('/api/v1/auth/accept-invitation')
      .send({ token: inviteManager.body.data.invitation.token, name: 'Shop A Manager', password: 'Password123!' });
    managerToken = acceptManager.body.data.token;

    const inviteCashier = await request(app)
      .post('/api/v1/tenants/invite')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ email: cashierEmail, role: 'Cashier', warehouseIds: [warehouseAId] });
    const acceptCashier = await request(app)
      .post('/api/v1/auth/accept-invitation')
      .send({ token: inviteCashier.body.data.invitation.token, name: 'Shop A Cashier', password: 'Password123!' });
    cashierToken = acceptCashier.body.data.token;
  }, 60000);

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it('lets the Shop Manager add a walk-in customer on the spot', async () => {
    const res = await request(app)
      .post('/api/v1/invoices/customers')
      .set('Authorization', `Bearer ${managerToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ name: 'Another Walk-in', email: `walkin2_${runId}@example.com` });
    expect(res.status).toBe(201);
  });

  it('lets the Shop Manager issue an itemized invoice tied to their own warehouse, deducting real stock', async () => {
    const before = await request(app)
      .get('/api/v1/inventory/items')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);
    const beforeQty = before.body.data.items
      .find((it: any) => it.id === itemId)
      .warehouseStocks.find((s: any) => s.warehouseId === warehouseAId).quantityOnHand;

    const res = await request(app)
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${managerToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({
        customerId,
        warehouseId: warehouseAId,
        items: [{ description: 'Sellable Widget', quantity: 2, unitPrice: 10, inventoryItemId: itemId }],
      });
    expect(res.status).toBe(201);
    expect(res.body.data.invoice.stockDeducted).toBe(true);

    const after = await request(app)
      .get('/api/v1/inventory/items')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);
    const afterQty = after.body.data.items
      .find((it: any) => it.id === itemId)
      .warehouseStocks.find((s: any) => s.warehouseId === warehouseAId).quantityOnHand;
    expect(afterQty).toBe(beforeQty - 2);
  });

  it('lets the Shop Manager issue a Simple (non-itemized) invoice too', async () => {
    const res = await request(app)
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${managerToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ customerId, items: [{ description: 'Ad-hoc service', quantity: 1, unitPrice: 15 }] });
    expect(res.status).toBe(201);
    expect(res.body.data.invoice.stockDeducted).toBe(false);
  });

  it('blocks the Shop Manager from issuing an itemized invoice against a warehouse they are not assigned to', async () => {
    const res = await request(app)
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${managerToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({
        customerId,
        warehouseId: warehouseBId,
        items: [{ description: 'Sellable Widget', quantity: 1, unitPrice: 10, inventoryItemId: itemId }],
      });
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('do not have access');
  });

  it('lets the Shop Manager record payment on an invoice they just created', async () => {
    const invoice = await request(app)
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${managerToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ customerId, items: [{ description: 'Cash sale item', quantity: 1, unitPrice: 20 }] });
    expect(invoice.status).toBe(201);

    const pay = await request(app)
      .post(`/api/v1/invoices/${invoice.body.data.invoice.id}/pay`)
      .set('Authorization', `Bearer ${managerToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({});
    expect(pay.status).toBe(200);
  });

  it('still blocks the Shop Manager from back-office invoice actions (email, GRA clearance, credit notes)', async () => {
    const invoice = await request(app)
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${managerToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ customerId, items: [{ description: 'Line', quantity: 1, unitPrice: 5 }] });
    const invoiceId = invoice.body.data.invoice.id;

    const send = await request(app)
      .post(`/api/v1/invoices/${invoiceId}/send`)
      .set('Authorization', `Bearer ${managerToken}`)
      .set('X-Tenant-ID', tenantSlug);
    expect(send.status).toBe(403);

    const clearance = await request(app)
      .post(`/api/v1/invoices/${invoiceId}/gra-clearance`)
      .set('Authorization', `Bearer ${managerToken}`)
      .set('X-Tenant-ID', tenantSlug);
    expect(clearance.status).toBe(403);

    const creditNote = await request(app)
      .post(`/api/v1/invoices/${invoiceId}/credit-notes`)
      .set('Authorization', `Bearer ${managerToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ amount: 1, reason: 'test' });
    expect(creditNote.status).toBe(403);
  });

  it('lets the Shop Manager add a vendor on the spot', async () => {
    const res = await request(app)
      .post('/api/v1/bills/vendors')
      .set('Authorization', `Bearer ${managerToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ name: 'Another Supplier', email: `supplier2_${runId}@example.com` });
    expect(res.status).toBe(201);
  });

  it('lets the Shop Manager record an itemized vendor bill into their own warehouse, receiving real stock', async () => {
    const before = await request(app)
      .get('/api/v1/inventory/items')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);
    const beforeQty = before.body.data.items
      .find((it: any) => it.id === itemId)
      .warehouseStocks.find((s: any) => s.warehouseId === warehouseAId).quantityOnHand;

    const res = await request(app)
      .post('/api/v1/bills')
      .set('Authorization', `Bearer ${managerToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ vendorId, warehouseId: warehouseAId, items: [{ itemId, quantity: 5, unitCost: 6 }] });
    expect(res.status).toBe(201);

    const after = await request(app)
      .get('/api/v1/inventory/items')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);
    const afterQty = after.body.data.items
      .find((it: any) => it.id === itemId)
      .warehouseStocks.find((s: any) => s.warehouseId === warehouseAId).quantityOnHand;
    expect(afterQty).toBe(beforeQty + 5);
  });

  it('blocks the Shop Manager from a lump-sum/simple vendor bill (no stock to back it)', async () => {
    const res = await request(app)
      .post('/api/v1/bills')
      .set('Authorization', `Bearer ${managerToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ vendorId, amount: 100 });
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('itemized');
  });

  it('blocks the Shop Manager from receiving an itemized vendor bill into a warehouse they are not assigned to', async () => {
    const res = await request(app)
      .post('/api/v1/bills')
      .set('Authorization', `Bearer ${managerToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ vendorId, warehouseId: warehouseBId, items: [{ itemId, quantity: 1, unitCost: 6 }] });
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('do not have access');
  });

  it('still blocks the Shop Manager from paying/scheduling a vendor bill (Accountant-only)', async () => {
    const bill = await request(app)
      .post('/api/v1/bills')
      .set('Authorization', `Bearer ${managerToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ vendorId, warehouseId: warehouseAId, items: [{ itemId, quantity: 1, unitCost: 6 }] });
    const billId = bill.body.data.bill.id;

    const pay = await request(app)
      .post(`/api/v1/bills/${billId}/pay`)
      .set('Authorization', `Bearer ${managerToken}`)
      .set('X-Tenant-ID', tenantSlug);
    expect(pay.status).toBe(403);

    const schedule = await request(app)
      .put(`/api/v1/bills/${billId}/schedule-payment`)
      .set('Authorization', `Bearer ${managerToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ scheduledDate: '2026-12-31' });
    expect(schedule.status).toBe(403);
  });

  it('does NOT extend this access to Cashier - invoices and vendor bills stay blocked', async () => {
    const invoice = await request(app)
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${cashierToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ customerId, items: [{ description: 'x', quantity: 1, unitPrice: 1 }] });
    expect(invoice.status).toBe(403);

    const bill = await request(app)
      .post('/api/v1/bills')
      .set('Authorization', `Bearer ${cashierToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ vendorId, warehouseId: warehouseAId, items: [{ itemId, quantity: 1, unitCost: 6 }] });
    expect(bill.status).toBe(403);

    const addCustomer = await request(app)
      .post('/api/v1/invoices/customers')
      .set('Authorization', `Bearer ${cashierToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ name: 'Should Not Be Created', email: `blocked_${runId}@example.com` });
    expect(addCustomer.status).toBe(403);
  });
});
