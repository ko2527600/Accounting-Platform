import { withTenantDb, withCurrentTenantDb } from '../database/tenantClient';
import { runWithTenantContext } from '../context/tenantContext';

describe('Tenant Schema Data Isolation', () => {
  const mockPrisma: any = {
    $executeRawUnsafe: jest.fn().mockResolvedValue(1),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should set search_path to tenant schema during execution and reset to public', async () => {
    let capturedSearchPathDuringQuery = false;

    await withTenantDb(mockPrisma, 'acme_corp', async (client) => {
      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith('SET search_path TO "tenant_acme_corp", public;');
      capturedSearchPathDuringQuery = true;
      return 'query_result';
    });

    expect(capturedSearchPathDuringQuery).toBe(true);
    expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith('SET search_path TO public;');
  });

  it('should reset search_path even if query function throws an error', async () => {
    await expect(
      withTenantDb(mockPrisma, 'acme_corp', async () => {
        throw new Error('Database query failure');
      })
    ).rejects.toThrow('Database query failure');

    expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith('SET search_path TO public;');
  });

  it('should execute with tenant schema from active AsyncLocalStorage context', async () => {
    const context = {
      tenantId: 'tenant-123',
      tenantSchema: 'tenant_stark_ind',
    };

    await runWithTenantContext(context, async () => {
      await withCurrentTenantDb(mockPrisma, async (client) => {
        expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith('SET search_path TO "tenant_stark_ind", public;');
      });
    });

    expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith('SET search_path TO public;');
  });

  it('should throw error when withCurrentTenantDb is called without tenant context', async () => {
    await expect(
      withCurrentTenantDb(mockPrisma, async () => {})
    ).rejects.toThrow('No tenant context available to execute tenant database operation.');
  });
});
