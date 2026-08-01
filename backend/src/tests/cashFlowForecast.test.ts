import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';

describe('Cash Flow Forecast (recurring-transaction + AR/AP-aware, event-grounded)', () => {
  const runId = Date.now();
  const tenantSlug = `forecast-corp-${runId}`;
  const tenantSchema = `tenant_forecast_corp_${runId}`;
  const adminEmail = `admin_forecast_${runId}@corp.com`;

  let adminToken: string;
  let tenantId: string;
  let cashAccountId: string;
  let expenseAccountId: string;
  let customerId: string;
  let vendorId: string;

  function addDays(days: number): string {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString();
  }

  async function cleanupTestData() {
    if (tenantId) {
      await prisma.recurringTransaction.deleteMany({ where: { tenantId } }).catch(() => {});
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
      companyName: 'Forecast Corp',
      slug: tenantSlug,
      adminEmail,
      adminPassword: 'Password123!',
      adminName: 'Forecast Admin',
    });
    adminToken = onboard.token;
    tenantId = onboard.tenant.id;

    const cashAcc = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ code: '1010', name: 'Cash & Bank', type: 'ASSET' });
    cashAccountId = cashAcc.body.data.account.id;

    const expAcc = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ code: '5010', name: 'Rent Expense', type: 'EXPENSE' });
    expenseAccountId = expAcc.body.data.account.id;

    const revAcc = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ code: '4010', name: 'Sales Revenue', type: 'REVENUE' });

    const eqAcc = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ code: '3010', name: 'Owner Capital', type: 'EQUITY' });

    // Real starting cash balance: $5000 owner capital injection.
    await request(app)
      .post('/api/v1/journal-entries')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({
        entryNumber: `JE-FC-${runId}-001`,
        entryDate: new Date().toISOString().split('T')[0],
        description: 'Initial Capital Injection',
        status: 'POSTED',
        lines: [
          { accountId: cashAccountId, debit: 5000, credit: 0 },
          { accountId: eqAcc.body.data.account.id, debit: 0, credit: 5000 },
        ],
      });

    const customer = await request(app)
      .post('/api/v1/invoices/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ name: 'Forecast Client', email: `forecast_${runId}@client.com` });
    customerId = customer.body.data.customer.id;

    const vendor = await request(app)
      .post('/api/v1/bills/vendors')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ name: 'Forecast Supplier', email: `forecastsupplier_${runId}@vendor.com` });
    vendorId = vendor.body.data.vendor.id;

    // Real recurring transaction: $100/week rent, starting today - 5
    // occurrences fall inside a 30-day window (days 0, 7, 14, 21, 28).
    await request(app)
      .post('/api/v1/recurring-transactions')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({
        name: 'Weekly Rent',
        frequency: 'WEEKLY',
        startDate: addDays(0),
        templateData: {
          description: 'Weekly Rent',
          lines: [
            { accountId: expenseAccountId, debit: 100, credit: 0 },
            { accountId: cashAccountId, debit: 0, credit: 100 },
          ],
        },
      });

    // Real outstanding invoice due in 5 days - $1200 expected inflow.
    const invoice = await request(app)
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ customerId, items: [{ description: 'Consulting', quantity: 1, unitPrice: 1200 }] });
    await prisma.invoice.update({ where: { id: invoice.body.data.invoice.id }, data: { dueDate: new Date(addDays(5)) } });

    // Real outstanding bill due in 10 days - $300 expected outflow.
    const bill = await request(app)
      .post('/api/v1/bills')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug)
      .send({ vendorId, amount: 300, dueDate: addDays(10) });
    expect(bill.status).toBe(201);
  }, 120000);

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it('rejects an out-of-range days parameter', async () => {
    const tooShort = await request(app)
      .get('/api/v1/reports/cash-flow-forecast?days=3')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);
    expect(tooShort.status).toBe(400);

    const tooLong = await request(app)
      .get('/api/v1/reports/cash-flow-forecast?days=400')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);
    expect(tooLong.status).toBe(400);
  });

  it('produces a real, event-grounded 30-day forecast matching hand-calculated totals', async () => {
    const res = await request(app)
      .get('/api/v1/reports/cash-flow-forecast?days=30')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);

    expect(res.status).toBe(200);
    const forecast = res.body.data;

    expect(forecast.startingCashBalance).toBe(5000);

    const recurringEvents = forecast.events.filter((e: any) => e.source === 'RECURRING_TRANSACTION');
    expect(recurringEvents.length).toBe(5);
    expect(recurringEvents.every((e: any) => e.amount === -100)).toBe(true);

    const invoiceEvents = forecast.events.filter((e: any) => e.source === 'INVOICE_DUE');
    expect(invoiceEvents.length).toBe(1);
    expect(invoiceEvents[0].amount).toBe(1200);

    const billEvents = forecast.events.filter((e: any) => e.source === 'BILL_DUE');
    expect(billEvents.length).toBe(1);
    expect(billEvents[0].amount).toBe(-300);

    // 5 x $100 recurring outflow + $300 bill outflow = $800; $1200 invoice inflow.
    expect(forecast.totalProjectedInflow).toBe(1200);
    expect(forecast.totalProjectedOutflow).toBe(800);
    expect(forecast.endingProjectedBalance).toBe(5000 + 1200 - 800);

    // Every weekly bucket's netChange sums to the same ending balance -
    // proves the bucketing didn't drop or double-count any event.
    const sumOfWeeklyNetChanges = forecast.weeks.reduce((acc: number, w: any) => acc + w.netChange, 0);
    expect(Math.round((5000 + sumOfWeeklyNetChanges) * 100) / 100).toBe(forecast.endingProjectedBalance);
    expect(forecast.weeks[forecast.weeks.length - 1].projectedBalance).toBe(forecast.endingProjectedBalance);
  });

  it('applies the window bound correctly - a shorter window excludes the bill (due day 10) but still includes the invoice (due day 5)', async () => {
    const res = await request(app)
      .get('/api/v1/reports/cash-flow-forecast?days=7')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenantSlug);
    expect(res.status).toBe(200);

    // Weekly recurring starting today: occurrences at day 0 and day 7 both
    // fall inside/at the boundary of a 7-day window.
    const recurringEvents = res.body.data.events.filter((e: any) => e.source === 'RECURRING_TRANSACTION');
    expect(recurringEvents.length).toBe(2);

    const invoiceEvents = res.body.data.events.filter((e: any) => e.source === 'INVOICE_DUE');
    expect(invoiceEvents.length).toBe(1);

    // The bill (due day 10) is genuinely outside a 7-day window - the
    // actual regression check that the window bound is applied, not just
    // returning every outstanding record regardless of days.
    const billEvents = res.body.data.events.filter((e: any) => e.source === 'BILL_DUE');
    expect(billEvents.length).toBe(0);
  });
});
