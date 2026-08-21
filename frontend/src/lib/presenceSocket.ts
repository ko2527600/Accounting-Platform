import { api, API_BASE_URL } from './api';

export interface OnlineUser {
  userId: string;
  name: string;
  email: string;
  role: string;
  lastSeenAt: string;
}

type RosterListener = (online: OnlineUser[]) => void;

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelayMs = 1000;
const MAX_RECONNECT_DELAY_MS = 30000;

let latestRoster: OnlineUser[] = [];
const listeners = new Set<RosterListener>();

function notifyListeners(): void {
  for (const listener of listeners) listener(latestRoster);
}

function wsUrl(ticket: string): string {
  const httpUrl = new URL(API_BASE_URL);
  const wsProtocol = httpUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProtocol}//${httpUrl.host}/ws/presence?ticket=${encodeURIComponent(ticket)}`;
}

/**
 * Opens (or re-opens) the live presence connection - call on login and
 * whenever the token changes; disconnectPresenceSocket() tears it down on
 * logout. Mirrors syncEngine.ts's connectSyncSocket/disconnectSyncSocket
 * lifecycle shape, but this is a much simpler always-current-snapshot
 * protocol (no offline queue, no catch-up endpoint needed) - the server
 * rebroadcasts the full online roster on every connect/disconnect, so a
 * client that missed a message just gets the next one.
 * Fetches a short-lived single-use ticket first so the bearer token never
 * appears in the WS URL (and therefore never in server/proxy logs).
 */
export function connectPresenceSocket(token: string): void {
  disconnectPresenceSocket();

  api.post('/sync/ticket')
    .then((res) => {
      const ticket = res.data?.data?.ticket as string | undefined;
      if (!ticket) { scheduleReconnect(token); return; }

      try {
        socket = new WebSocket(wsUrl(ticket));
      } catch {
        scheduleReconnect(token);
        return;
      }

      socket.onopen = () => {
        reconnectDelayMs = 1000;
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (Array.isArray(data.online)) {
            latestRoster = data.online;
            notifyListeners();
          }
        } catch {
          // Malformed push - ignore it, the next broadcast will self-correct.
        }
      };

      socket.onclose = () => {
        socket = null;
        latestRoster = [];
        notifyListeners();
        scheduleReconnect(token);
      };

      socket.onerror = () => {
        socket?.close();
      };
    })
    .catch(() => scheduleReconnect(token));
}

function scheduleReconnect(token: string): void {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectPresenceSocket(token);
  }, reconnectDelayMs);
  reconnectDelayMs = Math.min(reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
}

export function disconnectPresenceSocket(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (socket) {
    socket.onclose = null;
    socket.close();
    socket = null;
  }
  reconnectDelayMs = 1000;
  latestRoster = [];
  notifyListeners();
}

/** Subscribes to roster updates; returns an unsubscribe function. Fires immediately with the current roster so a late-mounting subscriber doesn't wait for the next push. */
export function subscribeToPresence(listener: RosterListener): () => void {
  listeners.add(listener);
  listener(latestRoster);
  return () => {
    listeners.delete(listener);
  };
}
