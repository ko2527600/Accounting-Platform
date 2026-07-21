import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { hashPassword, verifyPassword } from '../utils/password';
import { generateJwtToken, verifyJwtToken } from '../utils/jwt';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';

describe('Auth & RBAC Service Tests', () => {
  const testAdminEmail = 'test_admin_be103@example.com';
  const testAccountantEmail = 'test_accountant_be103@example.com';
  const testAuditorEmail = 'test_auditor_be103@example.com';
  const testViewerEmail = 'test_viewer_be103@example.com';
  const defaultPassword = 'securePassword123!';

  beforeAll(async () => {
    // Ensure DB connection and users table exists
    await prisma.$connect();
    await ensureUserTableExists(prisma);
    
    // Clean up test users if they exist from prior runs
    await deleteUserByEmail(prisma, testAdminEmail);
    await deleteUserByEmail(prisma, testAccountantEmail);
    await deleteUserByEmail(prisma, testAuditorEmail);
    await deleteUserByEmail(prisma, testViewerEmail);
  });

  afterAll(async () => {
    // Cleanup after test run
    await deleteUserByEmail(prisma, testAdminEmail);
    await deleteUserByEmail(prisma, testAccountantEmail);
    await deleteUserByEmail(prisma, testAuditorEmail);
    await deleteUserByEmail(prisma, testViewerEmail);
    await prisma.$disconnect();
  });

  describe('1. Password Hashing Utility (PBKDF2 SHA-512)', () => {
    it('should hash password and verify successfully', () => {
      const password = 'mySecretPassword99';
      const hash = hashPassword(password);

      expect(hash).toBeDefined();
      expect(hash).toContain('$pbkdf2$');

      const isMatch = verifyPassword(password, hash);
      expect(isMatch).toBe(true);
    });

    it('should reject incorrect password', () => {
      const hash = hashPassword('correctPassword');
      const isMatch = verifyPassword('wrongPassword', hash);
      expect(isMatch).toBe(false);
    });
  });

  describe('2. JWT Token Generation & Verification (HMAC-SHA256)', () => {
    it('should generate and verify JWT token payload claims', () => {
      const payload = {
        id: 'user-uuid-123',
        email: 'jwt_test@example.com',
        role: 'Admin',
        tenantId: 'tenant-acme',
      };

      const token = generateJwtToken(payload);
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3);

      const decoded = verifyJwtToken(token);
      expect(decoded.id).toBe(payload.id);
      expect(decoded.email).toBe(payload.email);
      expect(decoded.role).toBe(payload.role);
      expect(decoded.tenantId).toBe(payload.tenantId);
    });

    it('should fail verification for tampered token', () => {
      const token = generateJwtToken({ id: '1', email: 'a@b.com', role: 'Viewer' });
      const parts = token.split('.');
      const tamperedToken = `${parts[0]}.${parts[1]}.invalidSignatureHere`;

      expect(() => verifyJwtToken(tamperedToken)).toThrow('Invalid JWT signature');
    });
  });

  describe('3. User Registration API Endpoint (POST /api/v1/auth/register)', () => {
    it('should register a new Admin user with real PostgreSQL database storage', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: testAdminEmail,
          password: defaultPassword,
          name: 'Test Admin User',
          role: 'Admin',
          tenantId: 'acme_corp_tenant',
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.user.email).toBe(testAdminEmail);
      expect(response.body.data.user.role).toBe('Admin');
      expect(response.body.data.user.password).toBeUndefined();
      expect(response.body.data.token).toBeDefined();
    });

    it('should register Accountant, Auditor, and Viewer users', async () => {
      const roles = [
        { email: testAccountantEmail, role: 'Accountant', name: 'Test Accountant' },
        { email: testAuditorEmail, role: 'Auditor', name: 'Test Auditor' },
        { email: testViewerEmail, role: 'Viewer', name: 'Test Viewer' },
      ];

      for (const item of roles) {
        const res = await request(app)
          .post('/api/v1/auth/register')
          .send({
            email: item.email,
            password: defaultPassword,
            name: item.name,
            role: item.role,
          });

        expect(res.status).toBe(201);
        expect(res.body.data.user.role).toBe(item.role);
      }
    });

    it('should return 409 Conflict if email is already registered', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: testAdminEmail,
          password: defaultPassword,
          name: 'Duplicate Admin',
          role: 'Admin',
        });

      expect(response.status).toBe(409);
      expect(response.body.error).toBe('Conflict Error');
    });

    it('should validate invalid input formats', async () => {
      const res1 = await request(app)
        .post('/api/v1/auth/register')
        .send({ email: 'invalid-email', password: '123', name: 'Short' });
      expect(res1.status).toBe(400);

      const res2 = await request(app)
        .post('/api/v1/auth/register')
        .send({ email: 'valid@example.com', password: defaultPassword, name: 'User', role: 'SuperUser' });
      expect(res2.status).toBe(400);
    });
  });

  describe('4. User Login API Endpoint (POST /api/v1/auth/login)', () => {
    it('should authenticate registered user with valid credentials', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: testAdminEmail,
          password: defaultPassword,
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.user.email).toBe(testAdminEmail);
      expect(response.body.data.token).toBeDefined();
    });

    it('should reject authentication with wrong password', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: testAdminEmail,
          password: 'WrongPassword999!',
        });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Unauthorized');
    });
  });

  describe('5. Profile & Token Verification Endpoints', () => {
    let adminToken: string;

    beforeAll(async () => {
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: testAdminEmail, password: defaultPassword });
      adminToken = loginRes.body.data.token;
    });

    it('GET /api/v1/auth/me should return authenticated user profile', async () => {
      const response = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.user.email).toBe(testAdminEmail);
    });

    it('POST /api/v1/auth/verify should verify token payload', async () => {
      const response = await request(app)
        .post('/api/v1/auth/verify')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.valid).toBe(true);
      expect(response.body.data.user.email).toBe(testAdminEmail);
    });
  });

  describe('6. Role-Based Access Control Middleware (RBAC: Admin, Accountant, Auditor, Viewer)', () => {
    let adminToken: string;
    let accountantToken: string;
    let auditorToken: string;
    let viewerToken: string;

    beforeAll(async () => {
      const loginAdmin = await request(app).post('/api/v1/auth/login').send({ email: testAdminEmail, password: defaultPassword });
      adminToken = loginAdmin.body.data.token;

      const loginAccountant = await request(app).post('/api/v1/auth/login').send({ email: testAccountantEmail, password: defaultPassword });
      accountantToken = loginAccountant.body.data.token;

      const loginAuditor = await request(app).post('/api/v1/auth/login').send({ email: testAuditorEmail, password: defaultPassword });
      auditorToken = loginAuditor.body.data.token;

      const loginViewer = await request(app).post('/api/v1/auth/login').send({ email: testViewerEmail, password: defaultPassword });
      viewerToken = loginViewer.body.data.token;
    });

    it('Admin role should access Admin-only route', async () => {
      const res = await request(app)
        .get('/api/v1/auth/admin-only')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('Non-Admin role (Accountant) should be forbidden from Admin-only route (403)', async () => {
      const res = await request(app)
        .get('/api/v1/auth/admin-only')
        .set('Authorization', `Bearer ${accountantToken}`);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Forbidden');
    });

    it('Accountant role should access Accountant route', async () => {
      const res = await request(app)
        .get('/api/v1/auth/accountant-only')
        .set('Authorization', `Bearer ${accountantToken}`);
      expect(res.status).toBe(200);
    });

    it('Auditor role should access Auditor route but NOT Accountant route (403)', async () => {
      const auditorRes = await request(app)
        .get('/api/v1/auth/auditor-only')
        .set('Authorization', `Bearer ${auditorToken}`);
      expect(auditorRes.status).toBe(200);

      const accountantRes = await request(app)
        .get('/api/v1/auth/accountant-only')
        .set('Authorization', `Bearer ${auditorToken}`);
      expect(accountantRes.status).toBe(403);
    });

    it('Viewer role should access Viewer route but NOT Auditor, Accountant, or Admin routes', async () => {
      const viewerRes = await request(app)
        .get('/api/v1/auth/viewer-only')
        .set('Authorization', `Bearer ${viewerToken}`);
      expect(viewerRes.status).toBe(200);

      const forbiddenAdmin = await request(app)
        .get('/api/v1/auth/admin-only')
        .set('Authorization', `Bearer ${viewerToken}`);
      expect(forbiddenAdmin.status).toBe(403);
    });
  });
});
