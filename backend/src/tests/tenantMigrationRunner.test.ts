import { runMigrationsForSchema, runAllTenantMigrations } from '../database/tenantMigrationRunner';
import { TENANT_MIGRATIONS } from '../database/migrations/tenantMigrations';

describe('Tenant Migration Runner', () => {
  const mockPrisma: any = {
    $executeRawUnsafe: jest.fn(),
    $queryRawUnsafe: jest.fn(),
    tenant: {
      findMany: jest.fn(),
    },
  };

  beforeEach(() => {
    // Re-apply implementations after jest resetMocks:true clears them
    mockPrisma.$executeRawUnsafe.mockResolvedValue(1);
    mockPrisma.$queryRawUnsafe.mockResolvedValue([]);
    mockPrisma.tenant.findMany.mockResolvedValue([
      { id: 'tenant-1', name: 'Tenant 1', schema: 'tenant_1' },
      { id: 'tenant-2', name: 'Tenant 2', schema: 'tenant_2' },
    ]);
  });

  it('should run pending migrations for a tenant schema', async () => {
    const result = await runMigrationsForSchema(mockPrisma, 'demo_company', 'tenant-123');

    expect(result.schemaName).toBe('tenant_demo_company');
    expect(result.tenantId).toBe('tenant-123');
    expect(result.appliedMigrations).toContain(TENANT_MIGRATIONS[0].name);
    expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith('SET search_path TO "tenant_demo_company", public;');
    expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith('SET search_path TO public;');
  });

  it('should skip already applied migrations', async () => {
    // Mock all current migration versions as already applied (v1, v2, v3)
    mockPrisma.$queryRawUnsafe.mockResolvedValue(
      TENANT_MIGRATIONS.map((m) => ({ version: m.version }))
    );

    const result = await runMigrationsForSchema(mockPrisma, 'demo_company');

    expect(result.appliedMigrations.length).toBe(0);
    expect(result.skippedCount).toBe(TENANT_MIGRATIONS.length);
  });

  it('should run migrations across all provisioned tenants in database', async () => {
    const results = await runAllTenantMigrations(mockPrisma);

    expect(results.length).toBe(2);
    expect(results[0].schemaName).toBe('tenant_1');
    expect(results[1].schemaName).toBe('tenant_2');
    expect(mockPrisma.tenant.findMany).toHaveBeenCalled();
  });
});
