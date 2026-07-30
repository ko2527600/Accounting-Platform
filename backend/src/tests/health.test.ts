import request from 'supertest';
import app from '../app';

describe('GET /health', () => {
  it('should return 200 OK with status ok and service info', async () => {
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('status', 'healthy');
    expect(response.body).toHaveProperty('service', 'backend-api');
    expect(response.body).toHaveProperty('timestamp');
  });

  it('should return 200 OK for /api/v1/health', async () => {
    const response = await request(app).get('/api/v1/health');
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('status', 'healthy');
  });

  it('should report email/sms integration configuration status without leaking credentials', async () => {
    const response = await request(app).get('/health');
    expect(response.body.integrations).toBeDefined();
    expect(['configured', 'not configured']).toContain(response.body.integrations.email);
    expect(['configured', 'not configured']).toContain(response.body.integrations.sms);
    const bodyString = JSON.stringify(response.body);
    if (process.env.SENDGRID_API_KEY) {
      expect(bodyString).not.toContain(process.env.SENDGRID_API_KEY);
    }
  });
});
