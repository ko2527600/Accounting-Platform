import request from 'supertest';
import axios from 'axios';
import app from '../app';
import { prisma } from '../config/db';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

/**
 * Mocking the Anthropic API itself (the external service) is legitimate per
 * CLAUDE.md's "mocking external services is allowed for unit testing" -
 * this proves our own tool-execution/response-handling logic, not
 * Anthropic's API. Mirrors momo.test.ts's mockMomoToken pattern.
 */
describe('Help Assistant (in-app AI help widget)', () => {
  const runId = Date.now();
  const tenantSlug = `help-assistant-corp-${runId}`;
  const tenantSchema = `tenant_help_assistant_corp_${runId}`;
  const adminEmail = `admin_helpassistant_${runId}@corp.com`;

  let adminToken: string;

  async function cleanupTestData() {
    await deleteTenantBySlug(prisma, tenantSlug).catch(() => {});
    await deleteUserByEmail(prisma, adminEmail).catch(() => {});
    await dropTenantSchema(prisma, tenantSchema).catch(() => {});
  }

  function authed(req: request.Test): request.Test {
    return req.set('Authorization', `Bearer ${adminToken}`).set('X-Tenant-ID', tenantSlug);
  }

  beforeAll(async () => {
    await prisma.$connect();
    await ensureTenantTableExists(prisma);
    await ensureUserTableExists(prisma);
    await cleanupTestData();

    const onboard = await onboardTenant(prisma, {
      companyName: 'Help Assistant Corp',
      slug: tenantSlug,
      adminEmail,
      adminPassword: 'Password123!',
      adminName: 'Help Assistant Admin',
    });
    adminToken = onboard.token;
  }, 60000);

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete process.env.ANTHROPIC_API_KEY;
  });

  describe('Unconfigured (no ANTHROPIC_API_KEY - the real state of this test environment)', () => {
    it('GET /status reports configured: false', async () => {
      const res = await authed(request(app).get('/api/v1/help-assistant/status'));
      expect(res.status).toBe(200);
      expect(res.body.data.configured).toBe(false);
    });

    it('POST /chat returns 503 and never calls any external API', async () => {
      const res = await authed(request(app).post('/api/v1/help-assistant/chat')).send({ message: 'How do invoices work?' });
      expect(res.status).toBe(503);
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });
  });

  describe('Configured', () => {
    beforeEach(() => {
      process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    });

    it('GET /status reports configured: true', async () => {
      const res = await authed(request(app).get('/api/v1/help-assistant/status'));
      expect(res.body.data.configured).toBe(true);
    });

    it('rejects an empty message', async () => {
      const res = await authed(request(app).post('/api/v1/help-assistant/chat')).send({ message: '   ' });
      expect(res.status).toBe(400);
    });

    it('answers directly from the knowledge base with no tool calls', async () => {
      mockedAxios.post.mockImplementation((url: string) => {
        if (url === 'https://api.anthropic.com/v1/messages') {
          return Promise.resolve({
            data: {
              stop_reason: 'end_turn',
              content: [{ type: 'text', text: 'Invoices post revenue only once actually paid.' }],
            },
          });
        }
        return Promise.reject(new Error(`Unexpected POST ${url}`));
      });

      const res = await authed(request(app).post('/api/v1/help-assistant/chat')).send({
        message: 'When does an invoice post revenue?',
      });
      expect(res.status).toBe(200);
      expect(res.body.data.reply).toContain('actually paid');
      expect(res.body.data.history).toHaveLength(2);
      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    });

    it("runs a tool call against this tenant's real internal API, forwarding the caller's own credentials, and folds the result into its final answer", async () => {
      let callCount = 0;
      mockedAxios.post.mockImplementation((url: string) => {
        if (url !== 'https://api.anthropic.com/v1/messages') return Promise.reject(new Error(`Unexpected POST ${url}`));
        callCount += 1;
        if (callCount === 1) {
          return Promise.resolve({
            data: {
              stop_reason: 'tool_use',
              content: [{ type: 'tool_use', id: 'tool_1', name: 'list_invoices', input: {} }],
            },
          });
        }
        return Promise.resolve({
          data: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'You have no invoices yet.' }] },
        });
      });

      const internalRequest = jest.fn().mockResolvedValue({ status: 200, data: { success: true, data: { invoices: [] } } });
      mockedAxios.create.mockReturnValue({ request: internalRequest } as any);

      const res = await authed(request(app).post('/api/v1/help-assistant/chat')).send({
        message: 'Do I have any unpaid invoices?',
      });
      expect(res.status).toBe(200);
      expect(res.body.data.reply).toContain('no invoices');
      expect(internalRequest).toHaveBeenCalledWith(expect.objectContaining({ method: 'GET', url: '/invoices' }));
      expect(mockedAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: `Bearer ${adminToken}`, 'X-Tenant-Id': tenantSlug }) })
      );
    });

    it('surfaces a role-denied tool result to the assistant instead of crashing', async () => {
      let callCount = 0;
      mockedAxios.post.mockImplementation((url: string) => {
        if (url !== 'https://api.anthropic.com/v1/messages') return Promise.reject(new Error(`Unexpected POST ${url}`));
        callCount += 1;
        if (callCount === 1) {
          return Promise.resolve({
            data: { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tool_1', name: 'get_ledger_summary', input: {} }] },
          });
        }
        return Promise.resolve({
          data: { stop_reason: 'end_turn', content: [{ type: 'text', text: "Your role doesn't have access to the ledger." }] },
        });
      });

      const internalRequest = jest.fn().mockResolvedValue({ status: 403, data: { success: false, error: 'Forbidden' } });
      mockedAxios.create.mockReturnValue({ request: internalRequest } as any);

      const res = await authed(request(app).post('/api/v1/help-assistant/chat')).send({ message: 'What is my cash balance?' });
      expect(res.status).toBe(200);
      expect(res.body.data.reply).toContain("doesn't have access");
    });

    it('gives up cleanly after too many tool-call iterations instead of looping forever', async () => {
      mockedAxios.post.mockImplementation((url: string) => {
        if (url !== 'https://api.anthropic.com/v1/messages') return Promise.reject(new Error(`Unexpected POST ${url}`));
        return Promise.resolve({
          data: { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tool_x', name: 'list_invoices', input: {} }] },
        });
      });
      const internalRequest = jest.fn().mockResolvedValue({ status: 200, data: { success: true, data: { invoices: [] } } });
      mockedAxios.create.mockReturnValue({ request: internalRequest } as any);

      const res = await authed(request(app).post('/api/v1/help-assistant/chat')).send({ message: 'loop forever' });
      expect(res.status).toBe(502);
    });

    it('unknown role does not exist, unknown tool name is reported as a tool error rather than crashing', async () => {
      let callCount = 0;
      mockedAxios.post.mockImplementation((url: string) => {
        if (url !== 'https://api.anthropic.com/v1/messages') return Promise.reject(new Error(`Unexpected POST ${url}`));
        callCount += 1;
        if (callCount === 1) {
          return Promise.resolve({
            data: { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tool_1', name: 'delete_everything', input: {} }] },
          });
        }
        return Promise.resolve({ data: { stop_reason: 'end_turn', content: [{ type: 'text', text: "I can't do that." }] } });
      });

      const res = await authed(request(app).post('/api/v1/help-assistant/chat')).send({ message: 'delete all my data' });
      expect(res.status).toBe(200);
      expect(res.body.data.reply).toContain("can't do that");
    });
  });
});
