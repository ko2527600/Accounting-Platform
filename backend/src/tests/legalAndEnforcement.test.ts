import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug } from '../repository/tenantRepository';
import { deleteUserByEmail } from '../repository/userRepository';

describe('Legal Policy & Customization Enforcement API', () => {
  const testEmail = 'legal-admin@test.com';
  const testSlug = 'legal-corp';
  const testCompanyName = 'Legal Test Corporation';
  const testPassword = 'password123!';

  beforeAll(async () => {
    await prisma.$connect();
    await cleanupTestData();
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  async function cleanupTestData() {
    // Delete users first to satisfy foreign key constraints
    await prisma.user.deleteMany({
      where: {
        email: {
          in: [testEmail.toLowerCase().trim(), 'tier2-admin@test.com'],
        },
      },
    }).catch(() => {});

    // Delete tenants
    await prisma.tenant.deleteMany({
      where: {
        slug: {
          in: [testSlug.toLowerCase().trim(), 'tier2-corp'],
        },
      },
    }).catch(() => {});
  }

  describe('1. Onboarding Terms Validation', () => {
    it('should fail onboarding when termsAccepted is not checked (false/missing)', async () => {
      const res = await request(app)
        .post('/api/v1/tenants/onboard')
        .send({
          companyName: testCompanyName,
          slug: testSlug,
          adminEmail: testEmail,
          adminPassword: testPassword,
          acceptedTermsVersion: 'v1.0.0',
          // termsAccepted is missing
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('You must accept the Terms and Conditions and SLA');
    });

    it('should fail onboarding when acceptedTermsVersion is missing or empty', async () => {
      const res = await request(app)
        .post('/api/v1/tenants/onboard')
        .send({
          companyName: testCompanyName,
          slug: testSlug,
          adminEmail: testEmail,
          adminPassword: testPassword,
          termsAccepted: true,
          // acceptedTermsVersion is missing
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('Accepted terms version is required');
    });

    it('should succeed onboarding and persist terms acceptance details with correct defaults', async () => {
      const res = await request(app)
        .post('/api/v1/tenants/onboard')
        .send({
          companyName: testCompanyName,
          slug: testSlug,
          adminEmail: testEmail,
          adminPassword: testPassword,
          termsAccepted: true,
          acceptedTermsVersion: 'v1.0.0',
          tier: 1, // Default Tier 1
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.tenant.acceptedTermsVersion).toBe('v1.0.0');
      expect(res.body.data.tenant.termsAcceptedAt).toBeDefined();
      expect(res.body.data.tenant.tier).toBe(1);

      // Verify DB record directly
      const dbTenant = await prisma.tenant.findUnique({
        where: { slug: testSlug }
      });
      expect(dbTenant).toBeDefined();
      expect(dbTenant?.acceptedTermsVersion).toBe('v1.0.0');
      expect(dbTenant?.termsAcceptedAt).not.toBeNull();
      expect(dbTenant?.tier).toBe(1);
    });
  });

  describe('2. GET /api/legal/:policyName retrieve endpoints', () => {
    it('should fetch Terms and Conditions Markdown successfully', async () => {
      const res = await request(app).get('/api/legal/terms-and-conditions');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.policyName).toBe('terms-and-conditions');
      expect(res.body.title).toBe('Terms and Conditions');
      expect(res.body.content).toContain('# Terms and Conditions');
    });

    it('should fetch SLA Markdown successfully', async () => {
      const res = await request(app).get('/api/v1/legal/sla');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.policyName).toBe('sla');
      expect(res.body.title).toBe('Service Level Agreement (SLA)');
      expect(res.body.content).toContain('# Service Level Agreement');
    });

    it('should fetch Customization Policy Markdown successfully', async () => {
      const res = await request(app).get('/api/legal/customization-policy');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.policyName).toBe('customization-policy');
      expect(res.body.title).toBe('Customization Policy');
      expect(res.body.content).toContain('# Customization Policy');
    });

    it('should return 404 for an invalid policy name', async () => {
      const res = await request(app).get('/api/legal/invalid-policy-name');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Policy Not Found');
    });
  });

  describe('3. Customization Tier Enforcement Middleware', () => {
    let tier1Token: string;
    let tier2Token: string;

    beforeAll(async () => {
      // Login/Fetch token for Tier 1 admin created in first test block
      const loginRes1 = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: testEmail, password: testPassword });
      tier1Token = loginRes1.body.data.token;

      // Onboard a Tier 2 Tenant
      const onboard2 = await onboardTenant(prisma, {
        companyName: 'Tier 2 Corporation',
        slug: 'tier2-corp',
        adminEmail: 'tier2-admin@test.com',
        adminPassword: testPassword,
        termsAccepted: true,
        acceptedTermsVersion: 'v1.0.0',
        tier: 2, // Set tier to 2
      });
      tier2Token = onboard2.token;
    });

    it('should block Tier 1 tenant from creating custom fields (403 Forbidden)', async () => {
      const res = await request(app)
        .post('/api/v1/custom-fields')
        .set('Authorization', `Bearer ${tier1Token}`)
        .set('X-Tenant-Slug', testSlug)
        .send({
          entityType: 'Ledger',
          fieldName: 'CostCenter',
          fieldType: 'TEXT',
          label: 'Cost Center',
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Customization Tier Restriction');
      expect(res.body.message).toContain('requires Customization Tier 2 or higher');
      expect(res.body.currentTier).toBe(1);
      expect(res.body.requiredTier).toBe(2);
    });

    it('should allow Tier 2 tenant to create custom fields (201 Created)', async () => {
      const res = await request(app)
        .post('/api/v1/custom-fields')
        .set('Authorization', `Bearer ${tier2Token}`)
        .set('X-Tenant-Slug', 'tier2-corp')
        .send({
          entityType: 'Ledger',
          fieldName: 'CostCenter',
          fieldType: 'TEXT',
          label: 'Cost Center',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.fieldName).toBe('costcenter');
      expect(res.body.data.id).toBeDefined();
    });
  });
});
