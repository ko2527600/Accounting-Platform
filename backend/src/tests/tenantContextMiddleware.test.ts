import express, { Request, Response } from 'express';
import request from 'supertest';
import { tenantContextMiddleware, optionalTenantContextMiddleware } from '../middleware/tenantContextMiddleware';
import { getTenantContext } from '../context/tenantContext';

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

  it('should return 400 Bad Request if mandatory tenant headers are missing', async () => {
    const response = await request(app).get('/api/v1/protected');
    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty('error', 'Missing Tenant Identifier');
  });

  it('should resolve tenant context from X-Tenant-Schema header', async () => {
    const response = await request(app)
      .get('/api/v1/protected')
      .set('X-Tenant-Schema', 'acme_corp');

    expect(response.status).toBe(200);
    expect(response.body.reqTenant).toEqual({
      tenantId: 'tenant_acme_corp',
      tenantSchema: 'tenant_acme_corp',
    });
    expect(response.body.asyncContext).toEqual({
      tenantId: 'tenant_acme_corp',
      tenantSchema: 'tenant_acme_corp',
    });
  });

  it('should resolve tenant context from X-Tenant-ID header', async () => {
    const response = await request(app)
      .get('/api/v1/protected')
      .set('X-Tenant-ID', 'stark-industries');

    expect(response.status).toBe(200);
    expect(response.body.reqTenant.tenantSchema).toBe('tenant_stark_industries');
    expect(response.body.asyncContext.tenantId).toBe('stark-industries');
  });

  it('should allow optional endpoint access without tenant header', async () => {
    const response = await request(app).get('/api/v1/optional');
    expect(response.status).toBe(200);
    expect(response.body.reqTenant).toBeNull();
    expect(response.body.asyncContext).toBeNull();
  });
});
