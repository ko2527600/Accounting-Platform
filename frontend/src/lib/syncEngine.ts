import Dexie, { type Table } from 'dexie';
import { api, API_BASE_URL } from './api';

// Local-first sync pilot (Chart of Accounts + Invoices - see STATUS.md).
// Two entities only, on purpose: this proves the pattern (local IndexedDB
// mirror, instant reads, optimistic writes with server reconciliation,
// event-driven push) against both of the backend's tenant-data storage
// models before it's rolled out module by module. Everything else (journal
// entries, inventory, bills, reports, ...) still works exactly as before -
// ordinary network fetches - and is unaffected by any of this.

export interface LocalAccount {
  id: string;
  code: string;
  name: string;
  type: string;
  parentId: string | null;
  currency: string;
  isActive: boolean;
  isCashEquivalent: boolean;
  isFixedAsset: boolean;
  defaultRole: 'CASH' | 'REVENUE' | 'EXPENSE' | 'DEPRECIATION_EXPENSE' | 'ACCUMULATED_DEPRECIATION' | null;
  createdAt: string;
  updatedAt: string;
  // Present only on a record still in flight through the outbox - never
  // sent to the server, purely a local UI hint ("saving...", "needs
  // attention"). Absent (not false) once a record is fully synced, so a
  // plain `row._pending` check works without an extra `!== undefined`.
  _pending?: boolean;
  _failed?: boolean;
  _failureReason?: string;
}

export interface LocalInvoiceItem {
  id?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

export interface LocalInvoice {
  id: string;
  tenantId: string;
  invoiceNumber: string;
  customerId: string;
  customer?: { id: string; name: string; email: string };
  items?: LocalInvoiceItem[];
  issueDate: string;
  dueDate: string;
  currency: string;
  exchangeRate: number;
  subtotal: number;
  tax: number;
  taxRateId: string | null;
  taxBreakdown: unknown;
  total: number;
  baseCurrencyAmount: number | null;
  amountPaid: number;
  warehouseId?: string | null;
  stockDeducted?: boolean;
  status: string;
  emailedAt?: string | null;
  lastReminderSentAt?: string | null;
  journalId?: string | null;
  fundId: string | null;
  createdAt: string;
  _pending?: boolean;
  _failed?: boolean;
  _failureReason?: string;
}

type OutboxEntry =
  | {
      localId?: number;
      kind: 'CREATE_ACCOUNT';
      clientTxnId: string;
      tempId: string;
      body: Record<string, unknown>;
      status: 'pending' | 'failed';
      failureReason?: string;
      createdAt: string;
    }
  | {
      localId?: number;
      kind: 'UPDATE_ACCOUNT';
      clientTxnId: string;
      accountId: string;
      body: Record<string, unknown>;
      status: 'pending' | 'failed';
      failureReason?: string;
      createdAt: string;
    }
  | {
      localId?: number;
      kind: 'CREATE_INVOICE';
      clientTxnId: string;
      tempId: string;
      body: Record<string, unknown>;
      status: 'pending' | 'failed';
      failureReason?: string;
      createdAt: string;
    }
  | {
      localId?: number;
      kind: 'PAY_INVOICE';
      clientTxnId: string;
      invoiceId: string;
      // Omitted means "pay off whatever remains" - same default the
      // backend applies (see invoicePaymentService.recordInvoicePayment).
      amount?: number;
      status: 'pending' | 'failed';
      failureReason?: string;
      createdAt: string;
    };

interface MetaEntry {
  key: string;
  value: string;
}

class SyncDatabase extends Dexie {
  accounts!: Table<LocalAccount, string>;
  invoices!: Table<LocalInvoice, string>;
  outbox!: Table<OutboxEntry, number>;
  meta!: Table<MetaEntry, string>;

  constructor() {
    super('ledgio-sync');
    this.version(1).stores({
      accounts: 'id, code',
      invoices: 'id, invoiceNumber, status, customerId',
      outbox: '++localId, clientTxnId, status',
      meta: 'key',
    });
  }
}

export const syncDb = new SyncDatabase();

const META_LAST_SEQUENCE = 'lastSequence';
const META_TENANT_ID = 'tenantId';
const OUTBOX_RETRY_INTERVAL_MS = 15000; // fallback poll, matching saleSyncQueue.ts's established interval

async function getMeta(key: string): Promise<string | null> {
  const row = await syncDb.meta.get(key);
  return row?.value ?? null;
}

async function setMeta(key: string, value: string): Promise<void> {
  await syncDb.meta.put({ key, value });
}

/** Wipes every locally-synced table - called on logout, or when the bootstrapped tenant doesn't match the current one (shared-device safety, same reasoning as TenantSettingsContext resetting on logout). */
export async function resetLocalSyncData(): Promise<void> {
  await syncDb.transaction('rw', syncDb.accounts, syncDb.invoices, syncDb.outbox, syncDb.meta, async () => {
    await syncDb.accounts.clear();
    await syncDb.invoices.clear();
    await syncDb.outbox.clear();
    await syncDb.meta.clear();
  });
}

/**
 * Full current-state snapshot, for first login on a device or a stale/
 * missing local cursor. Idempotent - safe to call every login, cheap when
 * the local tenant already matches (still re-syncs, but that's correct:
 * catches anything missed while this device was fully offline).
 */
export async function bootstrapSync(tenantId: string): Promise<void> {
  const knownTenant = await getMeta(META_TENANT_ID);
  if (knownTenant && knownTenant !== tenantId) {
    await resetLocalSyncData();
  }

  const res = await api.get('/sync/bootstrap');
  if (!res.data.success) return;

  const { accounts, invoices, sequence } = res.data.data;

  await syncDb.transaction('rw', syncDb.accounts, syncDb.invoices, syncDb.meta, async () => {
    await syncDb.accounts.clear();
    await syncDb.accounts.bulkPut(accounts);
    await syncDb.invoices.clear();
    await syncDb.invoices.bulkPut(invoices);
    await setMeta(META_LAST_SEQUENCE, sequence);
    await setMeta(META_TENANT_ID, tenantId);
  });
}

/** Applies one change_log entry (from a WS push or a /sync/changes catch-up page) to the local mirror. */
async function applyChangeEntry(entry: {
  entityType: string;
  entityId: string;
  operation: 'CREATE' | 'UPDATE' | 'DELETE';
  payload: unknown;
  sequence: string;
}): Promise<void> {
  if (entry.entityType === 'Account') {
    if (entry.operation === 'DELETE') {
      await syncDb.accounts.delete(entry.entityId);
    } else {
      await syncDb.accounts.put(entry.payload as LocalAccount);
    }
  } else if (entry.entityType === 'Invoice') {
    if (entry.operation === 'DELETE') {
      await syncDb.invoices.delete(entry.entityId);
    } else {
      await syncDb.invoices.put(entry.payload as LocalInvoice);
    }
  }
  await setMeta(META_LAST_SEQUENCE, entry.sequence);
}

/** Fetches and applies everything since the local cursor - covers the gap between a bootstrap and the socket actually connecting, and any messages missed while disconnected/backgrounded. */
export async function catchUpSync(): Promise<void> {
  const since = (await getMeta(META_LAST_SEQUENCE)) ?? '0';
  const res = await api.get('/sync/changes', { params: { since } });
  if (!res.data.success) return;
  for (const change of res.data.data.changes) {
    await applyChangeEntry(change);
  }
}

// --- Real-time push ---------------------------------------------------

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelayMs = 1000;
const MAX_RECONNECT_DELAY_MS = 30000;

function wsUrl(token: string): string {
  const httpUrl = new URL(API_BASE_URL);
  const wsProtocol = httpUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProtocol}//${httpUrl.host}/ws/sync?token=${encodeURIComponent(token)}`;
}

/** Opens (or re-opens) the live push connection for the given session - call on login and whenever the token changes; disconnectSyncSocket() tears it down on logout. */
export function connectSyncSocket(token: string): void {
  disconnectSyncSocket();

  try {
    socket = new WebSocket(wsUrl(token));
  } catch {
    scheduleReconnect(token);
    return;
  }

  socket.onopen = () => {
    reconnectDelayMs = 1000;
    // A message could have been missed between the last known sequence and
    // this connection actually establishing - always catch up on connect,
    // not just on the very first bootstrap.
    catchUpSync().catch(() => {});
    flushOutbox().catch(() => {});
  };

  socket.onmessage = (event) => {
    try {
      const entry = JSON.parse(event.data);
      applyChangeEntry(entry).catch(() => {});
    } catch {
      // Malformed push - ignore it, the next /sync/changes catch-up will
      // still pick up the real state.
    }
  };

  socket.onclose = () => {
    socket = null;
    scheduleReconnect(token);
  };

  socket.onerror = () => {
    socket?.close();
  };
}

function scheduleReconnect(token: string): void {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectSyncSocket(token);
  }, reconnectDelayMs);
  reconnectDelayMs = Math.min(reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
}

export function disconnectSyncSocket(): void {
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
}

/**
 * Reconciles the local invoice mirror with the server for write paths this
 * pilot doesn't route through the outbox yet (credit notes, Paystack
 * payment confirmation - see Invoices.tsx). Those mutate an
 * invoice's status server-side without going through recordChange, so
 * there's no change-log entry for the sync engine to pick up on its own;
 * call this right after one of those actions succeeds to pull the real
 * current state back in. A full-list re-fetch, not a targeted one - there's
 * no single-invoice GET endpoint - but still far cheaper than the old
 * every-page-visit behavior since it only runs on these specific actions.
 */
export async function resyncInvoicesFromServer(): Promise<void> {
  const res = await api.get('/invoices');
  if (!res.data.success) return;
  await syncDb.invoices.bulkPut(res.data.data.invoices);
}

// --- Optimistic local-first writes -------------------------------------

function newClientTxnId(): string {
  return crypto.randomUUID();
}

async function enqueue(entry: OutboxEntry): Promise<void> {
  await syncDb.outbox.add(entry);
  flushOutbox().catch(() => {});
}

export async function createAccountLocalFirst(body: Record<string, unknown>): Promise<LocalAccount> {
  const clientTxnId = newClientTxnId();
  const tempId = `temp:${clientTxnId}`;
  const now = new Date().toISOString();

  const optimistic: LocalAccount = {
    id: tempId,
    code: String(body.code ?? ''),
    name: String(body.name ?? ''),
    type: String(body.type ?? ''),
    parentId: (body.parentId as string) ?? null,
    currency: (body.currency as string) ?? 'USD',
    isActive: body.isActive !== undefined ? Boolean(body.isActive) : true,
    isCashEquivalent: Boolean(body.isCashEquivalent),
    isFixedAsset: Boolean(body.isFixedAsset),
    defaultRole: null,
    createdAt: now,
    updatedAt: now,
    _pending: true,
  };
  await syncDb.accounts.put(optimistic);

  await enqueue({
    kind: 'CREATE_ACCOUNT',
    clientTxnId,
    tempId,
    body: { ...body, clientTxnId },
    status: 'pending',
    createdAt: now,
  });

  return optimistic;
}

export async function updateAccountLocalFirst(accountId: string, body: Record<string, unknown>): Promise<void> {
  const clientTxnId = newClientTxnId();
  const existing = await syncDb.accounts.get(accountId);
  if (existing) {
    await syncDb.accounts.put({ ...existing, ...body, _pending: true } as LocalAccount);
  }

  await enqueue({
    kind: 'UPDATE_ACCOUNT',
    clientTxnId,
    accountId,
    body,
    status: 'pending',
    createdAt: new Date().toISOString(),
  });
}

export async function createInvoiceLocalFirst(body: Record<string, unknown>, customer?: { id: string; name: string; email: string }): Promise<LocalInvoice> {
  const clientTxnId = newClientTxnId();
  const tempId = `temp:${clientTxnId}`;
  const now = new Date().toISOString();
  const items = (body.items as any[]) || [];
  const subtotal = items.reduce((sum, it) => sum + (Number(it.quantity) || 1) * (Number(it.unitPrice) || 0), 0);

  const optimistic: LocalInvoice = {
    id: tempId,
    tenantId: '',
    invoiceNumber: 'Pending...',
    customerId: String(body.customerId ?? ''),
    customer,
    items: items.map((it) => ({
      description: it.description || 'Service/Product',
      quantity: Number(it.quantity) || 1,
      unitPrice: Number(it.unitPrice) || 0,
      amount: (Number(it.quantity) || 1) * (Number(it.unitPrice) || 0),
    })),
    issueDate: now,
    dueDate: now,
    currency: (body.currency as string) || 'USD',
    exchangeRate: 1,
    subtotal,
    tax: 0,
    taxRateId: (body.taxRateId as string) || null,
    taxBreakdown: null,
    total: subtotal,
    baseCurrencyAmount: null,
    amountPaid: 0,
    status: 'SENT',
    fundId: (body.fundId as string) || null,
    createdAt: now,
    _pending: true,
  };
  await syncDb.invoices.put(optimistic);

  await enqueue({
    kind: 'CREATE_INVOICE',
    clientTxnId,
    tempId,
    body: { ...body, clientTxnId },
    status: 'pending',
    createdAt: now,
  });

  return optimistic;
}

export async function payInvoiceLocalFirst(invoiceId: string, amount?: number): Promise<void> {
  const clientTxnId = newClientTxnId();
  const existing = await syncDb.invoices.get(invoiceId);
  if (existing) {
    // Best-effort optimistic guess at the resulting status/amountPaid,
    // mirroring invoicePaymentService.recordInvoicePayment's own math - the
    // server remains the source of truth and overwrites this the moment the
    // real response comes back (see processOutboxEntry below).
    const remaining = Math.round((existing.total - (existing.amountPaid || 0)) * 100) / 100;
    const paying = amount !== undefined ? Math.min(amount, remaining) : remaining;
    const newAmountPaid = Math.round(((existing.amountPaid || 0) + paying) * 100) / 100;
    const newStatus = newAmountPaid >= existing.total - 0.01 ? 'PAID' : 'PARTIALLY_PAID';
    await syncDb.invoices.put({ ...existing, status: newStatus, amountPaid: newAmountPaid, _pending: true });
  }

  await enqueue({
    kind: 'PAY_INVOICE',
    clientTxnId,
    invoiceId,
    amount,
    status: 'pending',
    createdAt: new Date().toISOString(),
  });
}

let flushing = false;

/**
 * Replays queued writes against the real API, sequentially (matching
 * saleSyncQueue.ts's established pattern - avoids reordering two writes
 * from the same session). A network-layer failure (still offline) stops
 * the whole pass early and leaves every remaining entry `pending` for the
 * next trigger; a real server rejection marks that one entry `failed` and
 * keeps going - the local optimistic record is never silently deleted
 * either way, only ever reconciled to the real state or flagged for the
 * user's attention.
 */
export async function flushOutbox(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const entries = await syncDb.outbox.where('status').equals('pending').sortBy('localId');
    for (const entry of entries) {
      try {
        await processOutboxEntry(entry);
        await syncDb.outbox.delete(entry.localId!);
      } catch (err: any) {
        if (!err.response) {
          // Genuinely offline / no response reached - stop this pass,
          // nothing after this would fare any better right now.
          break;
        }
        await syncDb.outbox.update(entry.localId!, {
          status: 'failed',
          failureReason: err.response?.data?.error || 'Sync failed - server rejected this change.',
        });
        await markEntityFailed(entry, err.response?.data?.error);
      }
    }
  } finally {
    flushing = false;
  }
}

async function processOutboxEntry(entry: OutboxEntry): Promise<void> {
  if (entry.kind === 'CREATE_ACCOUNT') {
    const res = await api.post('/accounts', entry.body);
    const real: LocalAccount = res.data.data.account;
    await syncDb.transaction('rw', syncDb.accounts, async () => {
      await syncDb.accounts.delete(entry.tempId);
      await syncDb.accounts.put(real);
    });
  } else if (entry.kind === 'UPDATE_ACCOUNT') {
    const res = await api.put(`/accounts/${entry.accountId}`, entry.body);
    const real: LocalAccount = res.data.data.account;
    await syncDb.accounts.put(real);
  } else if (entry.kind === 'CREATE_INVOICE') {
    const res = await api.post('/invoices', entry.body);
    const real: LocalInvoice = res.data.data.invoice;
    await syncDb.transaction('rw', syncDb.invoices, async () => {
      await syncDb.invoices.delete(entry.tempId);
      await syncDb.invoices.put(real);
    });
  } else if (entry.kind === 'PAY_INVOICE') {
    const res = await api.post(`/invoices/${entry.invoiceId}/pay`, entry.amount !== undefined ? { amount: entry.amount } : {});
    const real: LocalInvoice = res.data.data.invoice;
    await syncDb.invoices.put(real);
  }
}

async function markEntityFailed(entry: OutboxEntry, reason?: string): Promise<void> {
  if (entry.kind === 'CREATE_ACCOUNT') {
    const row = await syncDb.accounts.get(entry.tempId);
    if (row) await syncDb.accounts.put({ ...row, _pending: false, _failed: true, _failureReason: reason });
  } else if (entry.kind === 'UPDATE_ACCOUNT') {
    const row = await syncDb.accounts.get(entry.accountId);
    if (row) await syncDb.accounts.put({ ...row, _pending: false, _failed: true, _failureReason: reason });
  } else if (entry.kind === 'CREATE_INVOICE') {
    const row = await syncDb.invoices.get(entry.tempId);
    if (row) await syncDb.invoices.put({ ...row, _pending: false, _failed: true, _failureReason: reason });
  } else if (entry.kind === 'PAY_INVOICE') {
    const row = await syncDb.invoices.get(entry.invoiceId);
    if (row) await syncDb.invoices.put({ ...row, _pending: false, _failed: true, _failureReason: reason });
  }
}

let retryInterval: ReturnType<typeof setInterval> | null = null;

/** Starts the background retry triggers (online event + fallback interval) - call once on login; stopSyncBackground() tears it down on logout. */
export function startSyncBackground(): void {
  window.addEventListener('online', handleOnline);
  if (!retryInterval) {
    retryInterval = setInterval(() => {
      flushOutbox().catch(() => {});
    }, OUTBOX_RETRY_INTERVAL_MS);
  }
}

function handleOnline(): void {
  flushOutbox().catch(() => {});
  catchUpSync().catch(() => {});
}

export function stopSyncBackground(): void {
  window.removeEventListener('online', handleOnline);
  if (retryInterval) {
    clearInterval(retryInterval);
    retryInterval = null;
  }
}
