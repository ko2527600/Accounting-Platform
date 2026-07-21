import { sanitizeSchemaName, createTenantSchema, dropTenantSchema, checkSchemaExists } from '../database/tenantSchemaManager';

describe('Tenant Schema Manager', () => {
  describe('sanitizeSchemaName', () => {
    it('should prefix raw name with tenant_', () => {
      expect(sanitizeSchemaName('acme')).toBe('tenant_acme');
    });

    it('should keep existing tenant_ prefix', () => {
      expect(sanitizeSchemaName('tenant_stark')).toBe('tenant_stark');
    });

    it('should convert uppercase to lowercase', () => {
      expect(sanitizeSchemaName('AcmeCorp')).toBe('tenant_acmecorp');
    });

    it('should replace invalid special characters with underscores', () => {
      expect(sanitizeSchemaName('acme-corp!123')).toBe('tenant_acme_corp_123');
    });

    it('should truncate schema name if longer than 63 characters', () => {
      const longName = 'a'.repeat(80);
      const sanitized = sanitizeSchemaName(longName);
      expect(sanitized.length).toBeLessThanOrEqual(63);
      expect(sanitized.startsWith('tenant_')).toBe(true);
    });

    it('should throw error for empty or invalid input', () => {
      expect(() => sanitizeSchemaName('')).toThrow('Schema name must be a non-empty string');
    });
  });

  describe('Database Operations (Mock / Integration Fallback)', () => {
    const mockPrisma: any = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ exists: true }]),
    };

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should execute CREATE SCHEMA IF NOT EXISTS with sanitized name', async () => {
      const result = await createTenantSchema(mockPrisma, 'acme_test');
      expect(result).toBe('tenant_acme_test');
      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith('CREATE SCHEMA IF NOT EXISTS "tenant_acme_test";');
    });

    it('should execute DROP SCHEMA IF EXISTS with CASCADE', async () => {
      const result = await dropTenantSchema(mockPrisma, 'acme_test');
      expect(result).toBe('tenant_acme_test');
      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith('DROP SCHEMA IF EXISTS "tenant_acme_test" CASCADE;');
    });

    it('should query information_schema to check schema existence', async () => {
      const exists = await checkSchemaExists(mockPrisma, 'acme_test');
      expect(exists).toBe(true);
      expect(mockPrisma.$queryRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('information_schema.schemata'),
        'tenant_acme_test'
      );
    });
  });
});
