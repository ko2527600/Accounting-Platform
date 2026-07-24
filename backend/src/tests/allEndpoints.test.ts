import request from 'supertest';
import app from '../app';

describe('AccountGo System-Wide End-to-End API Integration Suite', () => {
  let adminToken: string;
  let tenantId: string;
  let warehouseAId: string;
  let warehouseBId: string;
  let itemId: string;
  let tillId: string;

  const timestamp = Date.now();
  const testEmail = `test.admin.${timestamp}@example.com`;
  const testCompany = `Test Enterprise ${timestamp}`;
  const testSlug = `test-ent-${timestamp}`;

  jest.setTimeout(120000);

  beforeAll(async () => {
    // 1. Onboard Tenant and provision admin user & token
    const res = await request(app)
      .post('/api/v1/tenants/onboard')
      .send({
        companyName: testCompany,
        slug: testSlug,
        email: testEmail,
        password: 'Password123!',
        adminName: 'Test Admin',
        termsAccepted: true,
        acceptedTermsVersion: 'v1.0.0',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);

    adminToken = res.body.data.token;
    tenantId = res.body.data.tenant.id;
  });

  // 1. Health & Core Public Endpoints
  describe('System Health & Infrastructure Endpoints', () => {
    it('GET /health - should return 200 OK with healthy status', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('healthy');
    });

    it('GET /api/v1/legal/terms-and-conditions - should serve legal terms document', async () => {
      const res = await request(app).get('/api/v1/legal/terms-and-conditions');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.title).toContain('Terms');
    });

    it('GET /api/v1/currency/rates - should return multi-currency exchange rates', async () => {
      const res = await request(app)
        .get('/api/v1/currency/rates')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantId);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.rates.GHS).toBeDefined();
    });
  });

  // 2. Auth Flow
  describe('Authentication Flow', () => {
    it('POST /api/v1/auth/login - should authenticate admin user & return JWT', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: testEmail,
          password: 'Password123!',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.token).toBeDefined();
    });
  });

  // 3. Workspace Settings & Staff Onboarding
  describe('Workspace Profile & Custom Role Staff Onboarding', () => {
    it('GET /api/v1/tenants/current - should fetch current active workspace profile', async () => {
      const res = await request(app)
        .get('/api/v1/tenants/current')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantId);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.tenant.id).toBe(tenantId);
    });

    it('PUT /api/v1/tenants/current - should update workspace settings', async () => {
      const res = await request(app)
        .put('/api/v1/tenants/current')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantId)
        .send({
          companyName: `${testCompany} Updated`,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.tenant.name).toBe(`${testCompany} Updated`);
    });

    it('POST /api/v1/tenants/invite - should accept custom worker job titles', async () => {
      const res = await request(app)
        .post('/api/v1/tenants/invite')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantId)
        .send({
          email: `worker.${Date.now()}@example.com`,
          role: 'Shop Manager',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.invitation.role).toBe('Shop Manager');
    });
  });

  // 4. Multi-Warehouse & Inventory Logistics ("Godowns")
  describe('Multi-Warehouse & Stock Logistics Endpoints', () => {
    it('POST /api/v1/inventory/warehouses - should create Shop A & Shop B warehouses', async () => {
      const resA = await request(app)
        .post('/api/v1/inventory/warehouses')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantId)
        .send({ name: 'Central Depot Warehouse', location: 'Accra Industrial Zone' });

      expect(resA.status).toBe(201);
      warehouseAId = resA.body.data.warehouse.id;

      const resB = await request(app)
        .post('/api/v1/inventory/warehouses')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantId)
        .send({ name: 'Osu Downtown Shop', location: 'Osu Oxford Street' });

      expect(resB.status).toBe(201);
      warehouseBId = resB.body.data.warehouse.id;
    });

    it('POST /api/v1/inventory/items - should create inventory product with initial stock', async () => {
      const res = await request(app)
        .post('/api/v1/inventory/items')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantId)
        .send({
          name: 'Samsung 24 Inch Monitor',
          sku: `SKU-${Date.now()}`,
          category: 'Electronics',
          unitOfMeasure: 'pcs',
          costPrice: 500,
          sellingPrice: 850,
          initialWarehouseId: warehouseAId,
          initialQty: 40,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      itemId = res.body.data.item.id;
    });

    it('POST /api/v1/inventory/transfers - should execute inter-shop stock transfer', async () => {
      const res = await request(app)
        .post('/api/v1/inventory/transfers')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantId)
        .send({
          fromWarehouseId: warehouseAId,
          toWarehouseId: warehouseBId,
          itemId,
          quantity: 15,
          notes: 'Restocking Osu shop for weekend sales',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });
  });

  // 5. Cash Till & Daily Closeout Engine
  describe('Cash Till & Daily Physical Cash Closeout Suite', () => {
    it('POST /api/v1/tills/open - should open cash till for Osu shop', async () => {
      const res = await request(app)
        .post('/api/v1/tills/open')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantId)
        .send({
          warehouseId: warehouseBId,
          openingCash: 100,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      tillId = res.body.data.till.id;
    });

    it('POST /api/v1/tills/sales - should record cash sale & update inventory stock', async () => {
      const res = await request(app)
        .post('/api/v1/tills/sales')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantId)
        .send({
          tillId,
          itemId,
          quantity: 1,
          cashGiven: 1000,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.changeGiven).toBe(150); // 1000 - 850
    });

    it('POST /api/v1/tills/close - should close till & generate DailyCloseoutReport with over/short calculation', async () => {
      const res = await request(app)
        .post('/api/v1/tills/close')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantId)
        .send({
          tillId,
          actualEndingCash: 950, // Opening 100 + Sales 850 = Expected 950 -> 0 discrepancy
          notes: 'Day closed smoothly',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Number(res.body.data.report.discrepancy)).toBe(0);
    });
  });

  // 6. Intelligent Analytics, Notifications & Executive Reports
  describe('Intelligent Analytics & Notifications Endpoints', () => {
    it('GET /api/v1/analytics/stock-intelligence - should return fast vs dead stock analysis', async () => {
      const res = await request(app)
        .get('/api/v1/analytics/stock-intelligence')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantId);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.fastSellers).toBeDefined();
    });

    it('GET /api/v1/analytics/executive-summary - should return daily/monthly/yearly breakdowns & leaderboard', async () => {
      const res = await request(app)
        .get('/api/v1/analytics/executive-summary')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantId);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.shopLeaderboard).toBeDefined();
    });

    it('GET /api/v1/notifications - should fetch live notifications including automated till closeout alert', async () => {
      const res = await request(app)
        .get('/api/v1/notifications')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', tenantId);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.notifications.length).toBeGreaterThan(0);
    });
  });
});
