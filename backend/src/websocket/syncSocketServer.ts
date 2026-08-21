import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { verifyJwtToken } from '../utils/jwt';
import { redis } from '../config/redis';
import { logger } from '../utils/logger';
import { syncChannelForTenant } from '../services/syncChangeLogService';

const HEARTBEAT_INTERVAL_MS = 30000;

// Per-tenant fan-out set - every connected client for a tenant gets every
// change pushed to that tenant's Redis channel. Local-only map (each server
// instance keeps its own connections); cross-instance delivery is Redis's
// job via psubscribe below, not this map.
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

/**
 * Real-time push for the local-first sync pilot (see STATUS.md): connected
 * clients get new sync_change_log entries relayed the instant they're
 * published, instead of having to poll. A client that's offline or drops
 * the connection isn't relying on this for correctness - GET
 * /sync/changes?since=<lastSequence> covers full catch-up on reconnect, so
 * every failure mode here (Redis unavailable, socket drops, this whole
 * function never getting called) degrades to "a bit less instant," never
 * to a missed update.
 */
export function initSyncSocketServer(httpServer: HttpServer): void {
  // noServer + a manually path-checked 'upgrade' listener, not the
  // {server, path} shorthand: `ws`'s own path-mismatch handling
  // (WebSocketServer.shouldHandle -> abortHandshake) actively sends a 400
  // and destroys the socket for any upgrade whose path isn't this
  // instance's, rather than deferring to other 'upgrade' listeners -
  // fatal once a second WebSocketServer (presenceSocketServer.ts) shares
  // this same httpServer, since Node calls every 'upgrade' listener for
  // every request and this one would kill the other's connections first.
  const wss = new WebSocketServer({ noServer: true });
  httpServer.on('upgrade', (request, socket, head) => {
    const { pathname } = new URL(request.url || '', 'http://localhost');
    if (pathname !== '/ws/sync') return;
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  // A dedicated connection is required for Redis subscribe mode - once a
  // connection issues (P)SUBSCRIBE it can't run ordinary commands, so this
  // must never be the same client instance `redis` (used elsewhere for
  // ordinary GET/SET/publish) uses.
  const subscriber = redis.duplicate();
  subscriber.on('error', (err: Error) => {
    logger.warn('[SyncSocketServer] Redis subscriber error (live push degraded, clients still catch up via /sync/changes)', {
      error: err.message,
    });
  });

  // The duplicated client inherits the main client's `lazyConnect: true` +
  // `enableOfflineQueue: false` config - without an explicit, awaited
  // connect() first, an immediate psubscribe() races the not-yet-open
  // socket and gets rejected outright ("Stream isn't writeable and
  // enableOfflineQueue options is false") instead of queuing, since offline
  // queueing is deliberately disabled tenant-wide for fail-fast behavior.
  subscriber
    .connect()
    .then(() => subscriber.psubscribe('sync:tenant:*'))
    .catch((err: any) => {
      logger.warn('[SyncSocketServer] Failed to subscribe to sync channels (live push disabled, clients still catch up via /sync/changes)', {
        error: err?.message,
      });
    });

  subscriber.on('pmessage', (_pattern: string, channel: string, message: string) => {
    const tenantId = channel.slice('sync:tenant:'.length);
    const set = socketsByTenant.get(tenantId);
    if (!set || set.size === 0) return;
    for (const socket of set) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(message);
      }
    }
  });

  wss.on('connection', async (socket: WebSocket, request) => {
    const url = new URL(request.url || '', 'http://localhost');
    const ticket = url.searchParams.get('ticket');
    const tokenParam = url.searchParams.get('token');

    if (!ticket && !tokenParam) {
      socket.close(4001, 'Missing credentials');
      return;
    }

    let tenantId: string;
    try {
      if (ticket) {
        // One-time ticket: atomically fetch+delete so each ticket works once.
        const pipeline = redis.pipeline();
        pipeline.get(`ws-ticket:${ticket}`);
        pipeline.del(`ws-ticket:${ticket}`);
        const results = await pipeline.exec();
        const raw = results?.[0]?.[1] as string | null;
        if (!raw) {
          socket.close(4001, 'Invalid or expired ticket');
          return;
        }
        const data = JSON.parse(raw);
        if (!data.tenantId) {
          socket.close(4003, 'Ticket has no tenant');
          return;
        }
        tenantId = data.tenantId;
      } else {
        const payload = await verifyJwtToken(tokenParam!);
        if (!payload.tenantId) {
          socket.close(4003, 'Token has no tenant');
          return;
        }
        tenantId = payload.tenantId;
      }
    } catch {
      socket.close(4001, 'Invalid or expired credentials');
      return;
    }

    addSocket(tenantId, socket);

    let alive = true;
    socket.on('pong', () => {
      alive = true;
    });

    socket.on('close', () => {
      removeSocket(tenantId, socket);
    });

    socket.on('error', () => {
      removeSocket(tenantId, socket);
    });

    const heartbeat = setInterval(() => {
      if (!alive) {
        socket.terminate();
        clearInterval(heartbeat);
        return;
      }
      alive = false;
      socket.ping();
    }, HEARTBEAT_INTERVAL_MS);

    socket.on('close', () => clearInterval(heartbeat));
  });

  logger.info('[SyncSocketServer] WebSocket sync push initialized at /ws/sync');
}
