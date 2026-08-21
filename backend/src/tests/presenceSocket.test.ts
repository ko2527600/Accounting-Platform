import { deleteAuditLogs } from './testHelpers';
import http from 'http';
import type { AddressInfo } from 'net';
import { WebSocket } from 'ws';
import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { onboardTenant } from '../services/tenantService';
import { deleteTenantBySlug, ensureTenantTableExists } from '../repository/tenantRepository';
import { deleteUserByEmail, ensureUserTableExists } from '../repository/userRepository';
import { dropTenantSchema } from '../database/tenantSchemaManager';
import { initPresenceSocketServer } from '../websocket/presenceSocketServer';

// Every client socket opened by a test is tracked here so afterAll can
// force-close them before tearing down the HTTP server - an upgraded
// WebSocket connection is handed off from Express's normal request
// tracking to the `ws` library, so server.close() alone can hang
// indefinitely waiting for connections it no longer has visibility into.
const openSockets = new Set<WebSocket>();

function openSocket(url: string): WebSocket {
  const socket = new WebSocket(url);
  openSockets.add(socket);
  socket.once('close', () => openSockets.delete(socket));
  return socket;
}

function waitForMessage(socket: WebSocket): Promise<any> {
  return new Promise((resolve, reject) => {
    socket.once('message', (data) => {
      try {
        resolve(JSON.parse(data.toString()));
      } catch (e) {
        reject(e);
      }
    });
    socket.once('error', reject);
  });
}

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
}

function waitForClose(socket: WebSocket): Promise<{ code: number }> {
  return new Promise((resolve) => {
    socket.once('close', (code) => resolve({ code }));
  });
}

/**
 * Opens a socket and waits for it to actually connect, retrying a couple
 * of times on a bounded per-attempt timeout. This sandboxed container's
 * loopback networking occasionally takes far longer than normal (or the
 * connection attempt silently stalls with neither 'open' nor 'error'
 * firing) to establish a fresh local socket - the same class of transient
 * failure the production client (presenceSocket.ts) already has
 * reconnect-with-backoff for, so this mirrors that resilience rather than
 * assuming every attempt succeeds instantly.
 */
async function openSocketReady(url: string, attempts = 3): Promise<WebSocket> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const socket = openSocket(url);
    const perAttemptTimeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 3000));
    const result = await Promise.race([waitForOpen(socket).then(() => 'open' as const), perAttemptTimeout]).catch(
      () => 'error' as const
    );
    if (result === 'open') return socket;
    socket.terminate();
    openSockets.delete(socket);
    if (attempt === attempts) throw new Error(`Failed to open ${url} after ${attempts} attempts`);
  }
  throw new Error('unreachable');
}

describe('Presence WebSocket (GET /ws/presence)', () => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tenant1Slug = `presence-corp-1-${runId}`;
  const tenant1Schema = `tenant_presence_corp_1_${runId}`;
  const admin1Email = `presence_admin1_${runId}@corp1.com`;
  const manager1Email = `presence_manager1_${runId}@corp1.com`;

  const tenant2Slug = `presence-corp-2-${runId}`;
  const tenant2Schema = `tenant_presence_corp_2_${runId}`;
  const admin2Email = `presence_admin2_${runId}@corp2.com`;

  let server: http.Server;
  let port: number;
  let admin1Token: string;
  let manager1Token: string;
  let admin2Token: string;
  let tenant1Id: string;
  let tenant2Id: string;

  beforeAll(async () => {
    await prisma.$connect();
    await ensureTenantTableExists(prisma);
    await ensureUserTableExists(prisma);
    await deleteTenantBySlug(prisma, tenant1Slug).catch(() => {});
    await deleteTenantBySlug(prisma, tenant2Slug).catch(() => {});
    await deleteUserByEmail(prisma, admin1Email).catch(() => {});
    await deleteUserByEmail(prisma, manager1Email).catch(() => {});
    await deleteUserByEmail(prisma, admin2Email).catch(() => {});
    await dropTenantSchema(prisma, tenant1Schema).catch(() => {});
    await dropTenantSchema(prisma, tenant2Schema).catch(() => {});

    const onboard1 = await onboardTenant(prisma, {
      companyName: 'Presence Corp 1',
      slug: tenant1Slug,
      adminEmail: admin1Email,
      adminPassword: 'Password123!',
      adminName: 'Presence Admin 1',
    });
    admin1Token = onboard1.token;
    tenant1Id = onboard1.tenant.id;

    const invite = await request(app)
      .post('/api/v1/tenants/invite')
      .set('Authorization', `Bearer ${admin1Token}`)
      .set('X-Tenant-ID', tenant1Slug)
      .send({ email: manager1Email, role: 'Accountant' });
    const accept = await request(app)
      .post('/api/v1/auth/accept-invitation')
      .send({ token: invite.body.data.invitation.token, name: 'Presence Manager 1', password: 'Password123!' });
    manager1Token = accept.body.data.token;

    const onboard2 = await onboardTenant(prisma, {
      companyName: 'Presence Corp 2',
      slug: tenant2Slug,
      adminEmail: admin2Email,
      adminPassword: 'Password123!',
      adminName: 'Presence Admin 2',
    });
    admin2Token = onboard2.token;
    tenant2Id = onboard2.tenant.id;

    server = http.createServer(app);
    initPresenceSocketServer(server);
    // Bind and connect via the literal IPv4 loopback address, not
    // "localhost" - resolving "localhost" can nondeterministically pick
    // ::1 (IPv6) vs 127.0.0.1 (IPv4) depending on the environment's
    // resolver, and a client that resolves the opposite family from what
    // the server bound to just hangs on connect with no error event,
    // which was intermittently timing out this suite.
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  }, 60000);

  afterAll(async () => {
    for (const socket of openSockets) {
      socket.terminate();
    }
    openSockets.clear();

    // Bounded, not indefinite - an upgraded WS connection can leave
    // server.close()'s callback hanging even after every client socket
    // above has been terminated, so this must never block final cleanup.
    await Promise.race([
      new Promise<void>((resolve) => server.close(() => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 3000)),
    ]);

    if (tenant1Id) await deleteAuditLogs(prisma, { tenantId: tenant1Id });
    if (tenant2Id) await deleteAuditLogs(prisma, { tenantId: tenant2Id });
    await deleteTenantBySlug(prisma, tenant1Slug).catch(() => {});
    await deleteTenantBySlug(prisma, tenant2Slug).catch(() => {});
    await deleteUserByEmail(prisma, admin1Email).catch(() => {});
    await deleteUserByEmail(prisma, manager1Email).catch(() => {});
    await deleteUserByEmail(prisma, admin2Email).catch(() => {});
    await dropTenantSchema(prisma, tenant1Schema).catch(() => {});
    await dropTenantSchema(prisma, tenant2Schema).catch(() => {});
    await prisma.$disconnect();
  }, 20000);

  it('rejects a connection with no token', async () => {
    const socket = openSocket(`ws://127.0.0.1:${port}/ws/presence`);
    const closed = await waitForClose(socket);
    expect(closed.code).toBe(4001);
  });

  it('rejects a connection with an invalid token', async () => {
    const socket = openSocket(`ws://127.0.0.1:${port}/ws/presence?token=not-a-real-token`);
    const closed = await waitForClose(socket);
    expect(closed.code).toBe(4001);
  });

  it('sends the current roster on connect, then rebroadcasts as teammates join and leave', async () => {
    const adminSocket = await openSocketReady(`ws://127.0.0.1:${port}/ws/presence?token=${admin1Token}`);

    const firstMessage = await waitForMessage(adminSocket);
    expect(firstMessage.online.map((u: any) => u.email)).toEqual([admin1Email]);

    const nextForAdmin = waitForMessage(adminSocket);
    const managerSocket = await openSocketReady(`ws://127.0.0.1:${port}/ws/presence?token=${manager1Token}`);

    const updated = await nextForAdmin;
    const emails = updated.online.map((u: any) => u.email).sort();
    expect(emails).toEqual([admin1Email, manager1Email].sort());

    const managerFirstMessage = await waitForMessage(managerSocket);
    expect(managerFirstMessage.online.map((u: any) => u.email).sort()).toEqual([admin1Email, manager1Email].sort());
    const managerEntry = managerFirstMessage.online.find((u: any) => u.email === manager1Email);
    expect(managerEntry.name).toBe('Presence Manager 1');
    expect(managerEntry.role).toBe('Accountant');

    const nextAfterDisconnect = waitForMessage(adminSocket);
    managerSocket.close();
    const afterDisconnect = await nextAfterDisconnect;
    expect(afterDisconnect.online.map((u: any) => u.email)).toEqual([admin1Email]);

    adminSocket.close();
  }, 15000);

  it('does not leak presence across tenants', async () => {
    const admin1Socket = await openSocketReady(`ws://127.0.0.1:${port}/ws/presence?token=${admin1Token}`);
    await waitForMessage(admin1Socket);

    const admin2Socket = await openSocketReady(`ws://127.0.0.1:${port}/ws/presence?token=${admin2Token}`);
    const admin2FirstMessage = await waitForMessage(admin2Socket);

    expect(admin2FirstMessage.online.map((u: any) => u.email)).toEqual([admin2Email]);
    expect(admin2FirstMessage.online.map((u: any) => u.email)).not.toContain(admin1Email);

    admin1Socket.close();
    admin2Socket.close();
  }, 15000);
});
