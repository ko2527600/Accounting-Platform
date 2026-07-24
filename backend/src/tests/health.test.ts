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
});
