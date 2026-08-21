import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';
import { VendorPaymentSchedulingCronService } from '../services/vendorPaymentSchedulingCronService';

describe('Automated vendor payment scheduling', () => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tenantSlug = `vps-corp-${runId}`;
  const tenantSchema = `tenant_vps_corp_${runId}`;
  const adminEmail = `admin_vps_${runId}@corp.com`;

  let adminToken: string;
  let vendorId: string;

  async function cleanupTestData() {
    await deleteTenantBySlug(prisma, tenantSlug).catch(() => {});
    await deleteUserByEmail(prisma, adminEmail).catch(() => {});
    await dropTenantSchema(prisma, tenantSchema).catch(() => {});
  }

  function authed(req: request.Test): request.Test {
    return req.set('Authorization', `Bearer ${adminToken}`).set('X-Tenant-ID', tenantSlug);
  }

  async function createBill(amount: number) {
    const res = await authed(request(app).post('/api/v1/bills')).send({ vendorId, amount });
    return res.body.data.bill;
  }

  beforeAll(async () => {
    await prisma.$connect();
    await ensureTenantTableExists(prisma);
    await ensureUserTableExists(prisma);
    await cleanupTestData();

    const onboard = await onboardTenant(prisma, {
      companyName: 'VPS Corp',
      slug: tenantSlug,
      adminEmail,
      adminPassword: 'Password123!',
      adminName: 'VPS Admin',
    });
    adminToken = onboard.token;

    const vendor = await authed(request(app).post('/api/v1/bills/vendors')).send({ name: 'VPS Vendor', email: `vps_${runId}@vendor.com` });
    vendorId = vendor.body.data.vendor.id;

    await authed(request(app).post('/api/v1/accounts')).send({ code: '5030', name: 'Vendor Expense', type: 'EXPENSE' });
    await authed(request(app).post('/api/v1/accounts')).send({ code: '1030', name: 'Operating Cash', type: 'ASSET' });
  }, 60000);

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it('sets and clears a scheduled payment date on an unpaid bill', async () => {
    const bill = await createBill(100);
    const setRes = await authed(request(app).put(`/api/v1/bills/${bill.id}/schedule-payment`)).send({ scheduledPaymentDate: '2026-09-01' });
    expect(setRes.status).toBe(200);
    expect(setRes.body.data.bill.scheduledPaymentDate).toBeTruthy();

    const clearRes = await authed(request(app).put(`/api/v1/bills/${bill.id}/schedule-payment`)).send({ scheduledPaymentDate: null });
    expect(clearRes.status).toBe(200);
    expect(clearRes.body.data.bill.scheduledPaymentDate).toBeNull();
  });

  it('refuses to schedule a payment on an already-paid bill', async () => {
    const bill = await createBill(50);
    await authed(request(app).post(`/api/v1/bills/${bill.id}/pay`));

    const res = await authed(request(app).put(`/api/v1/bills/${bill.id}/schedule-payment`)).send({ scheduledPaymentDate: '2026-09-01' });
    expect(res.status).toBe(400);
  });

  it('the daily cron auto-pays a bill whose scheduled date has arrived, and leaves a future-scheduled bill alone', async () => {
    const dueBill = await createBill(200);
    await authed(request(app).put(`/api/v1/bills/${dueBill.id}/schedule-payment`)).send({ scheduledPaymentDate: '2020-01-01' });

    const futureBill = await createBill(300);
    await authed(request(app).put(`/api/v1/bills/${futureBill.id}/schedule-payment`)).send({ scheduledPaymentDate: '2099-01-01' });

    await VendorPaymentSchedulingCronService.runScheduledPaymentsJob();

    const dueAfter = await authed(request(app).get('/api/v1/bills'));
    const dueBillAfter = dueAfter.body.data.bills.find((b: any) => b.id === dueBill.id);
    const futureBillAfter = dueAfter.body.data.bills.find((b: any) => b.id === futureBill.id);

    expect(dueBillAfter.status).toBe('PAID');
    expect(dueBillAfter.journalId).toBeTruthy();
    expect(futureBillAfter.status).toBe('UNPAID');
  });

  it('does not re-pay a bill with no scheduled date', async () => {
    const bill = await createBill(75);
    await VendorPaymentSchedulingCronService.runScheduledPaymentsJob();

    const res = await authed(request(app).get('/api/v1/bills'));
    const billAfter = res.body.data.bills.find((b: any) => b.id === bill.id);
    expect(billAfter.status).toBe('UNPAID');
  });
});
