import { openDB, type DBSchema, type IDBPDatabase } from "idb";

// Local-first storage for the POS's hybrid-offline sale queue. Deliberately
// scoped to exactly what a cashier needs to keep ringing up sales during a
// connectivity outage: a snapshot of what's sellable (catalogSnapshot,
// refreshed opportunistically whenever the app is online) and the queue of
// sales rung up before they could be confirmed by the server (pendingSales).
// Nothing else in this app is cached offline - financial data everywhere
// else (balances, invoices, ledgers) still always hits the network live.

export interface OfflineCatalogItem {
  id: string;
  sku: string;
  name: string;
  sellingPrice: number;
  wholesalePrice: number | null;
  unitOfMeasure: string;
  stockQty: number;
}

export interface OfflinePendingSaleLine {
  itemId: string;
  quantity: number;
  itemName: string;
  itemSku: string;
  unitPrice: number;
}

export interface OfflineWarehouseOption {
  id: string;
  name: string;
}

export type PendingSaleStatus = "pending" | "syncing" | "failed";

export interface OfflinePendingSale {
  clientTxnId: string;
  tillId: string;
  warehouseId: string;
  lines: OfflinePendingSaleLine[];
  cashGiven: number;
  saleType?: "RETAIL" | "WHOLESALE";
  clientOccurredAt: string; // ISO timestamp - when the cashier actually rang this up
  queuedAt: number; // Date.now() - local queue order, distinct from clientOccurredAt
  status: PendingSaleStatus;
  failureReason?: string;
}

interface PosOfflineDbSchema extends DBSchema {
  catalogSnapshot: {
    key: string; // warehouseId
    value: { warehouseId: string; items: OfflineCatalogItem[]; savedAt: number };
  };
  pendingSales: {
    key: string; // clientTxnId
    value: OfflinePendingSale;
    indexes: { "by-till": string };
  };
  // Last-known open till per warehouse and the last-known warehouse roster -
  // without these, a page reload/reopen *during* an outage (as opposed to
  // losing connectivity mid-session, which just leaves React state alone)
  // would strand the cashier on the "Open Till" screen with no warehouse to
  // even pick, even though a till may genuinely already be open server-side.
  tillSnapshot: {
    key: string; // warehouseId
    value: { warehouseId: string; till: unknown; savedAt: number };
  };
  warehousesSnapshot: {
    key: string; // fixed singleton key
    value: { id: string; warehouses: OfflineWarehouseOption[]; savedAt: number };
  };
}

const DB_NAME = "ledgio-pos-offline";
const DB_VERSION = 2;
const WAREHOUSES_SNAPSHOT_KEY = "list";

let dbPromise: Promise<IDBPDatabase<PosOfflineDbSchema>> | null = null;

function getDb(): Promise<IDBPDatabase<PosOfflineDbSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<PosOfflineDbSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("catalogSnapshot")) {
          db.createObjectStore("catalogSnapshot", { keyPath: "warehouseId" });
        }
        if (!db.objectStoreNames.contains("pendingSales")) {
          const pendingStore = db.createObjectStore("pendingSales", { keyPath: "clientTxnId" });
          pendingStore.createIndex("by-till", "tillId");
        }
        if (!db.objectStoreNames.contains("tillSnapshot")) {
          db.createObjectStore("tillSnapshot", { keyPath: "warehouseId" });
        }
        if (!db.objectStoreNames.contains("warehousesSnapshot")) {
          db.createObjectStore("warehousesSnapshot", { keyPath: "id" });
        }
      },
    });
  }
  return dbPromise;
}

export async function saveCatalogSnapshot(warehouseId: string, items: OfflineCatalogItem[]): Promise<void> {
  const db = await getDb();
  await db.put("catalogSnapshot", { warehouseId, items, savedAt: Date.now() });
}

export async function getCatalogSnapshot(warehouseId: string): Promise<OfflineCatalogItem[]> {
  const db = await getDb();
  const snapshot = await db.get("catalogSnapshot", warehouseId);
  return snapshot?.items ?? [];
}

export async function saveWarehousesSnapshot(warehouses: OfflineWarehouseOption[]): Promise<void> {
  const db = await getDb();
  await db.put("warehousesSnapshot", { id: WAREHOUSES_SNAPSHOT_KEY, warehouses, savedAt: Date.now() });
}

export async function getWarehousesSnapshot(): Promise<OfflineWarehouseOption[]> {
  const db = await getDb();
  const snapshot = await db.get("warehousesSnapshot", WAREHOUSES_SNAPSHOT_KEY);
  return snapshot?.warehouses ?? [];
}

export async function saveTillSnapshot(warehouseId: string, till: unknown): Promise<void> {
  const db = await getDb();
  await db.put("tillSnapshot", { warehouseId, till, savedAt: Date.now() });
}

export async function getTillSnapshot(warehouseId: string): Promise<unknown | null> {
  const db = await getDb();
  const snapshot = await db.get("tillSnapshot", warehouseId);
  return snapshot?.till ?? null;
}

export async function clearTillSnapshot(warehouseId: string): Promise<void> {
  const db = await getDb();
  await db.delete("tillSnapshot", warehouseId);
}


export async function enqueuePendingSale(sale: OfflinePendingSale): Promise<void> {
  const db = await getDb();
  await db.put("pendingSales", sale);
}

export async function getPendingSalesForTill(tillId: string): Promise<OfflinePendingSale[]> {
  const db = await getDb();
  const all = await db.getAllFromIndex("pendingSales", "by-till", tillId);
  return all.sort((a, b) => a.queuedAt - b.queuedAt);
}

export async function updatePendingSaleStatus(
  clientTxnId: string,
  status: PendingSaleStatus,
  failureReason?: string
): Promise<void> {
  const db = await getDb();
  const existing = await db.get("pendingSales", clientTxnId);
  if (!existing) return;
  await db.put("pendingSales", { ...existing, status, failureReason });
}

export async function removePendingSale(clientTxnId: string): Promise<void> {
  const db = await getDb();
  await db.delete("pendingSales", clientTxnId);
}

/** Wipes all POS offline stores - called on logout alongside resetLocalSyncData() so a shared device's next user never inherits stale POS data. */
export async function clearPosOfflineData(): Promise<void> {
  const db = await getDb();
  await Promise.all([
    db.clear("catalogSnapshot"),
    db.clear("pendingSales"),
    db.clear("tillSnapshot"),
    db.clear("warehousesSnapshot"),
  ]);
}
