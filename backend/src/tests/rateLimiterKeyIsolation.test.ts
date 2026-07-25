import { Request, Response } from 'express';
import { connectRedis } from '../config/redis';
import { apiRateLimiter, authRateLimiter } from '../middleware/rateLimiterMiddleware';

/**
 * Regression test for a bug found on 2026-07-25: apiRateLimiter,
 * authRateLimiter, and onboardingRateLimiter all keyed their Redis counter
 * identically (`rate_limit:${tenantOrIp}`), so ordinary API traffic under a
 * tenant inflated the same counter the much stricter auth/onboarding
 * limiters check against - a real user's first login-then-save on a
 * data-heavy page could get spuriously 429'd by their own unrelated
 * page-load traffic.
 *
 * The middleware itself always bypasses rate limiting when
 * NODE_ENV === 'test' (to avoid interfering with the rest of the suite),
 * so this test temporarily flips NODE_ENV to exercise the real Redis-backed
 * path, restoring it afterward.
 */
describe('Rate limiter key isolation between limiters', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const runId = Date.now();
  const tenantId = `rl-isolation-${runId}`;

  function buildReq(): Request {
    return {
      headers: { 'x-tenant-id': tenantId },
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' } as any,
      originalUrl: '/api/v1/test',
      method: 'GET',
    } as unknown as Request;
  }

  function buildRes(): { res: Response; statusCode: number | null; body: any } {
    const result: { res: Response; statusCode: number | null; body: any } = {
      res: null as any,
      statusCode: null,
      body: null,
    };
    result.res = {
      setHeader: () => result.res,
      status(code: number) {
        result.statusCode = code;
        return result.res;
      },
      json(body: any) {
        result.body = body;
        return result.res;
      },
    } as unknown as Response;
    return result;
  }

  beforeAll(async () => {
    await connectRedis();
    // Exercise the real (non-test-bypassed) rate-limiting code path.
    process.env.NODE_ENV = 'development';
  });

  afterAll(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('does not let general API traffic exhaust the stricter auth limiter\'s budget for the same tenant', async () => {
    // Fire well past authRateLimiter's 10-per-minute limit (but under
    // apiRateLimiter's own 100-per-minute limit) using apiRateLimiter alone.
    for (let i = 0; i < 15; i++) {
      const req = buildReq();
      const { res } = buildRes();
      let nextCalled = false;
      await apiRateLimiter(req, res, () => {
        nextCalled = true;
      });
      expect(nextCalled).toBe(true);
    }

    // A single authRateLimiter check for the same tenant must still pass -
    // its own budget (10/min) has not been touched by apiRateLimiter's key.
    const authReq = buildReq();
    const { res: authRes, statusCode } = buildRes();
    let authNextCalled = false;
    await authRateLimiter(authReq, authRes, () => {
      authNextCalled = true;
    });

    expect(authNextCalled).toBe(true);
    expect(statusCode).toBeNull();
  });
});
