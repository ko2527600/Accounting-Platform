import express, { Request, Response } from 'express';
import request from 'supertest';
import { tenantContextMiddleware, optionalTenantContextMiddleware } from '../middleware/tenantContextMiddleware';
import { getTenantContext } from '../context/tenantContext';
import { prisma } from '../config/db';
import { createTenant, deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';

describe('Tenant Context Middleware', () => {
  const app = express();
  app.use(express.json());

  app.get('/api/v1/protected', tenantContextMiddleware, (req: Request, res: Response) => {
    const context = getTenantContext();
    res.json({
      reqTenant: req.tenantContext,
      asyncContext: context,
    });
  });

  app.get('/api/v1/optional', optionalTenantContextMiddleware, (req: Request, res: Response) => {
    const context = getTenantContext();
    res.json({
      reqTenant: req.tenantContext || null,
      asyncContext: context || null,
    });
  });

  let tenant1Id: string;
  let tenant2Id: string;

  beforeAll(async () => {
    await prisma.$connect();
    await ensureTenantTableExists(prisma);

    await deleteTenantBySlug(prisma, 'acme-corp').catch(() => {});
    await deleteTenantBySlug(prisma, 'stark-industries').catch(() => {});
    await dropTenantSchema(prisma, 'tenant_acme_corp').catch(() => {});
    await dropTenantSchema(prisma, 'tenant_stark_industries').catch(() => {});

    const t1 = await createTenant(prisma, {
      name: 'Acme Corp',
      slug: 'acme-corp',
      schema: 'tenant_acme_corp',
    });
    tenant1Id = t1.id;

    const t2 = await createTenant(prisma, {
      name: 'Stark Industries',
      slug: 'stark-industries',
      schema: 'tenant_stark_industries',
    });
    tenant2Id = t2.id;
  }, 30000);

  afterAll(async () => {
    await deleteTenantBySlug(prisma, 'acme-corp').catch(() => {});
    await deleteTenantBySlug(prisma, 'stark-industries').catch(() => {});
    await dropTenantSchema(prisma, 'tenant_acme_corp').catch(() => {});
    await dropTenantSchema(prisma, 'tenant_stark_industries').catch(() => {});
    await prisma.$disconnect();
  }, 30000);

  it('should return 400 Bad Request if mandatory tenant headers are missing', async () => {
    const response = await request(app).get('/api/v1/protected');
    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty('error', 'Missing Tenant Identifier');
  });

  it('should return 404 Not Found if tenant is not registered in public.tenants', async () => {
    const response = await request(app)
      .get('/api/v1/protected')
      .set('X-Tenant-ID', 'unregistered-company-xyz');

    expect(response.status).toBe(404);
    expect(response.body).toHaveProperty('error', 'Tenant Not Found');
    expect(response.body.message).toContain('unregistered-company-xyz');
  });

  it('should resolve tenant context from X-Tenant-Schema header for registered tenant', async () => {
    const response = await request(app)
      .get('/api/v1/protected')
      .set('X-Tenant-Schema', 'tenant_acme_corp');

    expect(response.status).toBe(200);
    expect(response.body.reqTenant).toEqual({
      tenantId: tenant1Id,
      tenantSchema: 'tenant_acme_corp',
      tenantName: 'Acme Corp',
      tenantSlug: 'acme-corp',
      tenantTier: 1,
    });
    expect(response.body.asyncContext).toEqual({
      tenantId: tenant1Id,
      tenantSchema: 'tenant_acme_corp',
      tenantName: 'Acme Corp',
      tenantSlug: 'acme-corp',
      tenantTier: 1,
    });
  });

  it('should resolve tenant context from X-Tenant-ID header', async () => {
    const response = await request(app)
      .get('/api/v1/protected')
      .set('X-Tenant-ID', 'stark-industries');

    expect(response.status).toBe(200);
    expect(response.body.reqTenant.tenantSchema).toBe('tenant_stark_industries');
    expect(response.body.asyncContext.tenantId).toBe(tenant2Id);
  });

  it('should allow optional endpoint access without tenant header', async () => {
    const response = await request(app).get('/api/v1/optional');
    expect(response.status).toBe(200);
    expect(response.body.reqTenant).toBeNull();
    expect(response.body.asyncContext).toBeNull();
  });
});

