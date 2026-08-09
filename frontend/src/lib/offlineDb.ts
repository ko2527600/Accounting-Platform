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

export type PendingSaleStatus = "pending" | "syncing" | "failed";

export interface OfflinePendingSale {
  clientTxnId: string;
  tillId: string;
  warehouseId: string;
  lines: OfflinePendingSaleLine[];
  cashGiven: number;
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
}

const DB_NAME = "ledgio-pos-offline";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<PosOfflineDbSchema>> | null = null;

function getDb(): Promise<IDBPDatabase<PosOfflineDbSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<PosOfflineDbSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore("catalogSnapshot", { keyPath: "warehouseId" });
        const pendingStore = db.createObjectStore("pendingSales", { keyPath: "clientTxnId" });
        pendingStore.createIndex("by-till", "tillId");
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
