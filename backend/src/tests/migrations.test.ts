import request from 'supertest';
import app from '../app';
import { runMigrationsForSchema, runAllTenantMigrations } from '../database/tenantMigrationRunner';

jest.mock('../database/tenantMigrationRunner', () => ({
  runMigrationsForSchema: jest.fn().mockResolvedValue({
    tenantId: 'tenant-1',
    schemaName: 'tenant_acme',
    appliedMigrations: ['001_initial_tenant_core_schema'],
    skippedCount: 0,
  }),
  runAllTenantMigrations: jest.fn().mockResolvedValue([
    {
      tenantId: 'tenant-1',
      schemaName: 'tenant_acme',
      appliedMigrations: ['001_initial_tenant_core_schema'],
      skippedCount: 0,
    },
  ]),
}));

describe('POST /api/v1/admin/migrations/run', () => {
  it('should run migrations for a specific tenant schema when tenantSchema is provided', async () => {
    const response = await request(app)
      .post('/api/v1/admin/migrations/run')
      .send({ tenantSchema: 'acme' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.schemaName).toBe('tenant_acme');
    expect(runMigrationsForSchema).toHaveBeenCalledWith(expect.anything(), 'acme');
  });

  it('should run migrations across all tenant schemas when allTenants is true or body is empty', async () => {
    const response = await request(app)
      .post('/api/v1/admin/migrations/run')
      .send({ allTenants: true });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.length).toBe(1);
    expect(runAllTenantMigrations).toHaveBeenCalled();
  });
});
