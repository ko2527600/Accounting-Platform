import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { redis } from '../config/redis';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';

describe('Token revocation (logout)', () => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const password = 'Password123!';
  const emails: string[] = [];

  beforeAll(async () => {
    await prisma.$connect();
    // Redis uses lazyConnect - without an explicit ping here, this test file's
    // very first Redis command (the revocation write in the first `logout`
    // call below) can race the connection handshake and be dropped, since
    // enableOfflineQueue is false. Matches the existing prisma.$connect()
    // precedent other test files already use for the DB connection.
    await redis.ping().catch(() => {});
    await ensureUserTableExists(prisma);
  });

  afterAll(async () => {
    await Promise.all(emails.map((e) => deleteUserByEmail(prisma, e).catch(() => {})));
    await prisma.$disconnect();
  });

  // Each test registers its own user rather than sharing one, so tokens are
  // guaranteed distinct without relying on generateJwtToken's 1-second-
  // resolution `iat` (it has no per-session nonce, so two logins for the same
  // user within the same second produce a byte-identical token string).
  async function registerAndLogin(label: string): Promise<string> {
    const email = `revoke_test_${label}_${runId}@example.com`;
    emails.push(email);
    const registerRes = await request(app)
      .post('/api/v1/auth/register')
      .send({ email, password, name: `Revoke Test ${label}` });
    expect(registerRes.status).toBe(201);

    const loginRes = await request(app).post('/api/v1/auth/login').send({ email, password });
    expect(loginRes.status).toBe(200);
    return loginRes.body.data.token;
  }

  it('rejects a token after logout', async () => {
    const token = await registerAndLogin('single');

    const beforeLogout = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
    expect(beforeLogout.status).toBe(200);

    const logoutRes = await request(app).post('/api/v1/auth/logout').set('Authorization', `Bearer ${token}`);
    expect(logoutRes.status).toBe(200);
    expect(logoutRes.body.success).toBe(true);

    const afterLogout = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
    expect(afterLogout.status).toBe(401);
  });

  it('does not invalidate a different token belonging to a different user (not a blunt logout-everyone)', async () => {
    const tokenA = await registerAndLogin('userA');
    const tokenB = await registerAndLogin('userB');
    expect(tokenA).not.toBe(tokenB);

    const logoutRes = await request(app).post('/api/v1/auth/logout').set('Authorization', `Bearer ${tokenA}`);
    expect(logoutRes.status).toBe(200);

    const withRevokedToken = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${tokenA}`);
    expect(withRevokedToken.status).toBe(401);

    const withStillValidToken = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${tokenB}`);
    expect(withStillValidToken.status).toBe(200);
  });

  it('rejects a revoked token even when it was already served from the in-memory verified-token cache', async () => {
    const token = await registerAndLogin('cachewarm');

    // Warm the LRU cache with a successful verification before revoking.
    const warm = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
    expect(warm.status).toBe(200);

    await request(app).post('/api/v1/auth/logout').set('Authorization', `Bearer ${token}`);

    const afterRevocation = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
    expect(afterRevocation.status).toBe(401);
  });
});
