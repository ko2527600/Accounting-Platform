import { withTenantDb, withCurrentTenantDb } from '../database/tenantClient';
import { runWithTenantContext } from '../context/tenantContext';

describe('Tenant Schema Data Isolation', () => {
  const mockPrisma: any = {
    $executeRawUnsafe: jest.fn().mockResolvedValue(1),
    $transaction: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.$executeRawUnsafe.mockResolvedValue(1);
    // $transaction pins the connection and passes a tx client to the callback
    mockPrisma.$transaction.mockImplementation(async (callback: any) => {
      return await callback(mockPrisma);
    });
  });

  it('should SET LOCAL search_path to tenant schema inside $transaction and call queryFn', async () => {
    let capturedSearchPathDuringQuery = false;

    await withTenantDb(mockPrisma, 'acme_corp', async (client) => {
      const calls = mockPrisma.$executeRawUnsafe.mock.calls.map((c: any[]) => c[0]);
      expect(calls.some((c: string) => c.includes('SET LOCAL search_path') && c.includes('"tenant_acme_corp"'))).toBe(true);
      capturedSearchPathDuringQuery = true;
      return 'query_result';
    });

    expect(capturedSearchPathDuringQuery).toBe(true);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('should propagate errors thrown by the query function (Prisma rolls back automatically)', async () => {
    await expect(
      withTenantDb(mockPrisma, 'acme_corp', async () => {
        throw new Error('Database query failure');
      })
    ).rejects.toThrow('Database query failure');
  });

  it('should execute with tenant schema from active AsyncLocalStorage context', async () => {
    const context = {
      tenantId: 'tenant-123',
      tenantSchema: 'tenant_stark_ind',
    };

    await runWithTenantContext(context, async () => {
      await withCurrentTenantDb(mockPrisma, async (client) => {
        const calls = mockPrisma.$executeRawUnsafe.mock.calls.map((c: any[]) => c[0]);
        expect(calls.some((c: string) => c.includes('"tenant_stark_ind"'))).toBe(true);
      });
    });

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('should throw error when withCurrentTenantDb is called without tenant context', async () => {
    await expect(
      withCurrentTenantDb(mockPrisma, async () => {})
    ).rejects.toThrow('No tenant context available to execute tenant database operation.');
  });
});
