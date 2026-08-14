import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { verifyJwtToken } from '../utils/jwt';
import { logger } from '../utils/logger';

const HEARTBEAT_INTERVAL_MS = 30000;

interface PresenceEntry {
  userId: string;
  name: string;
  email: string;
  role: string;
  connectionCount: number;
  lastSeenAt: string;
}

// Per-tenant online roster - in-memory only, matching syncSocketServer.ts's
// socketsByTenant pattern. No Redis/cross-instance fan-out is needed here
// (unlike sync change push): this deployment runs a single backend
// instance (see render.yaml), and presence is inherently ephemeral - a
// restart just means every client reconnects and re-registers itself, no
// state to actually lose. connectionCount (not a boolean) handles a user
// having the app open in more than one tab/device at once, so closing one
// tab doesn't wrongly mark them offline while another tab is still open.
const onlineByTenant = new Map<string, Map<string, PresenceEntry>>();
const socketsByTenant = new Map<string, Set<WebSocket>>();

function addSocket(tenantId: string, socket: WebSocket): void {
  let set = socketsByTenant.get(tenantId);
  if (!set) {
    set = new Set();
    socketsByTenant.set(tenantId, set);
  }
  set.add(socket);
}

function removeSocket(tenantId: string, socket: WebSocket): void {
  const set = socketsByTenant.get(tenantId);
  if (!set) return;
  set.delete(socket);
  if (set.size === 0) socketsByTenant.delete(tenantId);
}

function broadcastRoster(tenantId: string): void {
  const roster = onlineByTenant.get(tenantId);
  const online = roster ? Array.from(roster.values()) : [];
  const message = JSON.stringify({ online });

  const sockets = socketsByTenant.get(tenantId);
  if (!sockets) return;
  for (const socket of sockets) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(message);
    }
  }
}

function markOnline(tenantId: string, payload: { id: string; name?: string; email: string; role: string }): void {
  let roster = onlineByTenant.get(tenantId);
  if (!roster) {
    roster = new Map();
    onlineByTenant.set(tenantId, roster);
  }

  const existing = roster.get(payload.id);
  if (existing) {
    existing.connectionCount += 1;
    existing.lastSeenAt = new Date().toISOString();
  } else {
    roster.set(payload.id, {
      userId: payload.id,
      name: payload.name || payload.email,
      email: payload.email,
      role: payload.role,
      connectionCount: 1,
      lastSeenAt: new Date().toISOString(),
    });
  }
}

function markOffline(tenantId: string, userId: string): void {
  const roster = onlineByTenant.get(tenantId);
  if (!roster) return;

  const entry = roster.get(userId);
  if (!entry) return;

  entry.connectionCount -= 1;
  if (entry.connectionCount <= 0) {
    roster.delete(userId);
  }
  if (roster.size === 0) {
    onlineByTenant.delete(tenantId);
  }
}

/**
 * Real-time "who's online" presence, mirroring syncSocketServer.ts's
 * connection-handling shape. Every authenticated user connects here
 * (mounted globally on the frontend, same lifecycle as the sync socket -
 * not gated to Admin), so the roster reflects everyone actually using the
 * app; only the Team Management UI (Admin-only route) actually displays
 * it. On every connect/disconnect, the full current roster for that
 * tenant is rebroadcast to all of that tenant's connected sockets - self-
 * healing by construction (a client that missed an update just gets the
 * next one, never drifts permanently out of sync).
 */
export function initPresenceSocketServer(httpServer: HttpServer): void {
  // noServer + a manually path-checked 'upgrade' listener - see
  // syncSocketServer.ts's initSyncSocketServer for why the {server, path}
  // shorthand can't be used here: it actively aborts (400 + destroys the
  // socket) any upgrade whose path isn't its own rather than deferring to
  // other 'upgrade' listeners, which broke this server's connections
  // entirely once syncSocketServer.ts's WebSocketServer was already
  // registered on the same httpServer first.
  const wss = new WebSocketServer({ noServer: true });
  httpServer.on('upgrade', (request, socket, head) => {
    const { pathname } = new URL(request.url || '', 'http://localhost');
    if (pathname !== '/ws/presence') return;
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', async (socket: WebSocket, request) => {
    const url = new URL(request.url || '', 'http://localhost');
    const token = url.searchParams.get('token');

    if (!token) {
      socket.close(4001, 'Missing token');
      return;
    }

    let tenantId: string;
    let userId: string;
    try {
      const payload = await verifyJwtToken(token);
      if (!payload.tenantId) {
        socket.close(4003, 'Token has no tenant');
        return;
      }
      tenantId = payload.tenantId;
      userId = payload.id;
      markOnline(tenantId, { id: payload.id, name: payload.name, email: payload.email, role: payload.role });
    } catch {
      socket.close(4001, 'Invalid or expired token');
      return;
    }

    addSocket(tenantId, socket);
    broadcastRoster(tenantId);

    let alive = true;
    socket.on('pong', () => {
      alive = true;
    });

    const cleanup = () => {
      removeSocket(tenantId, socket);
      markOffline(tenantId, userId);
      broadcastRoster(tenantId);
      clearInterval(heartbeat);
    };

    socket.on('close', cleanup);
    socket.on('error', cleanup);

    const heartbeat = setInterval(() => {
      if (!alive) {
        socket.terminate();
        return;
      }
      alive = false;
      socket.ping();
    }, HEARTBEAT_INTERVAL_MS);
  });

  logger.info('[PresenceSocketServer] WebSocket presence tracking initialized at /ws/presence');
}
