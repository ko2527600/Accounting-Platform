import request from 'supertest';
import app from '../app';

jest.setTimeout(180000);

describe('Encrypted Admin Broadcast Engine Suite', () => {
  it('POST /api/v1/admin/broadcast/verify-passcode - should reject invalid passcode', async () => {
    const res = await request(app)
      .post('/api/v1/admin/broadcast/verify-passcode')
      .send({ passcode: 'invalid_passcode_123' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('POST /api/v1/admin/broadcast/verify-passcode - should reject a same-length but wrong passcode', async () => {
    const validPasscode = process.env.BROADCAST_MASTER_SECRET;
    if (!validPasscode) {
      throw new Error('BROADCAST_MASTER_SECRET must be set in the test environment to run this suite.');
    }
    // Same length as the real passcode (crypto.timingSafeEqual requires equal-length
    // buffers) but wrong content - exercises the actual byte comparison, not just
    // the length-mismatch short-circuit covered by the "invalid passcode" test above.
    const wrongPasscode = validPasscode
      .split('')
      .map((c) => (c === 'x' ? 'y' : 'x'))
      .join('');

    const res = await request(app)
      .post('/api/v1/admin/broadcast/verify-passcode')
      .send({ passcode: wrongPasscode });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('POST /api/v1/admin/broadcast/verify-passcode - should verify valid master passcode', async () => {
    const validPasscode = process.env.BROADCAST_MASTER_SECRET;
    if (!validPasscode) {
      throw new Error('BROADCAST_MASTER_SECRET must be set in the test environment to run this suite.');
    }

    const res = await request(app)
      .post('/api/v1/admin/broadcast/verify-passcode')
      .send({ passcode: validPasscode });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('POST /api/v1/admin/broadcast/send - should execute batch broadcast to tenant business owners', async () => {
    const validPasscode = process.env.BROADCAST_MASTER_SECRET;
    if (!validPasscode) {
      throw new Error('BROADCAST_MASTER_SECRET must be set in the test environment to run this suite.');
    }

    const res = await request(app)
      .post('/api/v1/admin/broadcast/send')
      .send({
        passcode: validPasscode,
        subject: 'System Maintenance Notice v2.5',
        message: 'Ledgio will undergo routine database maintenance on Sunday at 2:00 AM UTC.',
        channel: 'BOTH',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.totalTargeted).toBeGreaterThanOrEqual(0);
  });
});
