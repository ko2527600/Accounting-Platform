import request from 'supertest';
import app from '../app';
import { getTenantFromCache, setTenantInCache, clearTenantCache, invalidateTenantCache } from '../cache/tenantCache';
import { TENANT_MIGRATIONS } from '../database/migrations/tenantMigrations';

// ─── 1. Tenant Metadata Cache Unit Tests ────────────────────────────────────────

describe('TenantCache', () => {
  beforeEach(() => {
    clearTenantCache();
  });

  it('returns null for uncached identifiers', () => {
    expect(getTenantFromCache('unknown-slug')).toBeNull();
  });

  it('stores and retrieves a tenant by slug', () => {
    const tenant = {
      id: 'test-id-001',
      name: 'Test Corp',
      slug: 'test-corp',
      schema: 'tenant_test_corp',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    setTenantInCache('test-corp', tenant);

    expect(getTenantFromCache('test-corp')).not.toBeNull();
    expect(getTenantFromCache('test-corp')?.id).toBe('test-id-001');
    expect(getTenantFromCache('tenant_test_corp')?.slug).toBe('test-corp');
    expect(getTenantFromCache('test-id-001')?.name).toBe('Test Corp');
  });

  it('returns null for expired cache entries', async () => {
    const tenant = {
      id: 'exp-id-001',
      name: 'Expiry Corp',
      slug: 'expiry-corp',
      schema: 'tenant_expiry_corp',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    setTenantInCache('expiry-corp', tenant, 50); // 50ms TTL

    // Should hit immediately
    expect(getTenantFromCache('expiry-corp')).not.toBeNull();

    // Wait for TTL to expire
    await new Promise((r) => setTimeout(r, 100));

    expect(getTenantFromCache('expiry-corp')).toBeNull();
  });

  it('invalidates specific tenant cache entries', () => {
    const tenant = {
      id: 'inv-id-001',
      name: 'Invalid Corp',
      slug: 'invalid-corp',
      schema: 'tenant_invalid_corp',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    setTenantInCache('invalid-corp', tenant);
    expect(getTenantFromCache('invalid-corp')).not.toBeNull();

    invalidateTenantCache('invalid-corp');
    expect(getTenantFromCache('invalid-corp')).toBeNull();
  });
});

// ─── 2. Rate Limiter Integration Tests ──────────────────────────────────────────

describe('Rate Limiter Middleware', () => {
  it('allows requests in test environment (rate limiting is bypassed in test env)', async () => {
    // In NODE_ENV=test the rate limiter is bypassed so all requests should pass through.
    // This test just verifies a non-429 response; auth may return 400/401/500 depending on DB state.
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'test@test.com', password: 'password' });

    // Should NOT be a 429 (rate limited) response regardless of request volume
    expect(res.status).not.toBe(429);
  }, 15000); // 15s timeout to account for DB connection latency

  it('returns X-Request-ID header on every response', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-request-id']).toBeDefined();
    expect(res.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });

  it('echoes back a provided X-Request-ID header', async () => {
    const customId = '00000000-aaaa-bbbb-cccc-000000000001';
    const res = await request(app)
      .get('/health')
      .set('X-Request-ID', customId);

    expect(res.headers['x-request-id']).toBe(customId);
  });

  it('rate limiter module exports all three limiter variants', () => {
    // Verify all three specialized rate limiters are exported and are functions
    const { apiRateLimiter, authRateLimiter, onboardingRateLimiter } = require('../middleware/rateLimiterMiddleware');
    expect(typeof apiRateLimiter).toBe('function');
    expect(typeof authRateLimiter).toBe('function');
    expect(typeof onboardingRateLimiter).toBe('function');
  });
});

// ─── 3. Database Migration v3 Validation ────────────────────────────────────────

describe('TenantMigrations', () => {
  it('includes all 3 migration versions in sequential order', () => {
    expect(TENANT_MIGRATIONS.length).toBeGreaterThanOrEqual(3);
    expect(TENANT_MIGRATIONS[0].version).toBe(1);
    expect(TENANT_MIGRATIONS[1].version).toBe(2);
    expect(TENANT_MIGRATIONS[2].version).toBe(3);
  });

  it('migration v3 adds all required composite indexes', () => {
    const migrationV3 = TENANT_MIGRATIONS.find((m) => m.version === 3);
    expect(migrationV3).toBeDefined();
    expect(migrationV3?.sql).toContain('idx_ledgers_account_date');
    expect(migrationV3?.sql).toContain('idx_journal_entries_status_date');
    expect(migrationV3?.sql).toContain('idx_journal_entry_lines_account');
    expect(migrationV3?.sql).toContain('idx_accounts_parent');
  });

  it('migration v3 uses IF NOT EXISTS guards for safe re-execution', () => {
    const migrationV3 = TENANT_MIGRATIONS.find((m) => m.version === 3);
    expect(migrationV3?.sql.match(/CREATE INDEX IF NOT EXISTS/g)?.length).toBeGreaterThanOrEqual(4);
  });
});
