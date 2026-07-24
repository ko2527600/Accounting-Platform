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

  it('POST /api/v1/admin/broadcast/verify-passcode - should verify valid master passcode', async () => {
    const validPasscode = process.env.BROADCAST_MASTER_SECRET || 'secret_admin_broadcast_passcode';

    const res = await request(app)
      .post('/api/v1/admin/broadcast/verify-passcode')
      .send({ passcode: validPasscode });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('POST /api/v1/admin/broadcast/send - should execute batch broadcast to tenant business owners', async () => {
    const validPasscode = process.env.BROADCAST_MASTER_SECRET || 'secret_admin_broadcast_passcode';

    const res = await request(app)
      .post('/api/v1/admin/broadcast/send')
      .send({
        passcode: validPasscode,
        subject: 'System Maintenance Notice v2.5',
        message: 'AccountGo will undergo routine database maintenance on Sunday at 2:00 AM UTC.',
        channel: 'BOTH',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.totalTargeted).toBeGreaterThanOrEqual(0);
  });
});
