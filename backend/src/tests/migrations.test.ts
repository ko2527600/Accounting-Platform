import request from 'supertest';
import app from '../app';
import { runMigrationsForSchema, runAllTenantMigrations } from '../database/tenantMigrationRunner';
import { generateJwtToken } from '../utils/jwt';

jest.mock('../database/tenantMigrationRunner', () => ({
  runMigrationsForSchema: jest.fn(),
  runAllTenantMigrations: jest.fn(),
}));

const mockRunMigrationsForSchema = runMigrationsForSchema as jest.MockedFunction<typeof runMigrationsForSchema>;
const mockRunAllTenantMigrations = runAllTenantMigrations as jest.MockedFunction<typeof runAllTenantMigrations>;

const adminToken = generateJwtToken({ id: 'platform-admin-1', email: 'platform-admin@example.com', role: 'Admin' });
const viewerToken = generateJwtToken({ id: 'viewer-1', email: 'viewer@example.com', role: 'Viewer' });

describe('POST /api/v1/admin/migrations/run', () => {
  beforeEach(() => {
    // Re-apply mock implementations after jest resetMocks:true clears them
    mockRunMigrationsForSchema.mockResolvedValue({
      tenantId: 'tenant-1',
      schemaName: 'tenant_acme',
      appliedMigrations: ['001_initial_tenant_core_schema'],
      skippedCount: 0,
    });
    mockRunAllTenantMigrations.mockResolvedValue([
      {
        tenantId: 'tenant-1',
        schemaName: 'tenant_acme',
        appliedMigrations: ['001_initial_tenant_core_schema'],
        skippedCount: 0,
      },
    ]);
  });

  it('should run migrations for a specific tenant schema when tenantSchema is provided', async () => {
    const response = await request(app)
      .post('/api/v1/admin/migrations/run')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ tenantSchema: 'acme' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.schemaName).toBe('tenant_acme');
    expect(mockRunMigrationsForSchema).toHaveBeenCalledWith(expect.anything(), 'acme');
  });

  it('should run migrations across all tenant schemas when allTenants is true or body is empty', async () => {
    const response = await request(app)
      .post('/api/v1/admin/migrations/run')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ allTenants: true });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.length).toBe(1);
    expect(mockRunAllTenantMigrations).toHaveBeenCalled();
  });

  it('should reject requests with no auth token', async () => {
    const response = await request(app)
      .post('/api/v1/admin/migrations/run')
      .send({ allTenants: true });

    expect(response.status).toBe(401);
  });

  it('should reject non-Admin roles', async () => {
    const response = await request(app)
      .post('/api/v1/admin/migrations/run')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ allTenants: true });

    expect(response.status).toBe(403);
  });
});

