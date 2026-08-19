import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import {
  type OfflinePendingSale,
  enqueuePendingSale,
  getPendingSalesForTill,
  removePendingSale,
  updatePendingSaleStatus,
} from "./offlineDb";

const SYNC_INTERVAL_MS = 15000;

/**
 * Drives the hybrid-offline POS sync loop for one till: replays locally-
 * queued sales against the real POST /tills/sales once connectivity allows,
 * using each sale's clientTxnId so a retried/duplicate replay is safely
 * deduped server-side rather than double-processed. Deliberately an in-app
 * (React-level) loop, not a service-worker Background Sync queue - it needs
 * to drive the same manual "Sync Now" trigger and rich pending/needs-
 * attention UI either way, and this works in every browser (Background Sync
 * has no Safari/iOS support at all).
 *
 * Only network-layer failures (no response received - still offline, or a
 * transient blip) get silently retried on the next pass. A real rejection
 * from the server (e.g. insufficient stock discovered only at sync time -
 * there's still no *server-side* offline stock reservation, only the local,
 * same-device soft reservation PointOfSale.tsx keeps against its own pending
 * queue) stops that sale from auto-retrying and moves it into "needs
 * attention" - a completed cash sale, with real money already collected
 * from a real customer, must never be silently dropped.
 */
export function useSaleSyncQueue(tillId: string | null, onSynced: () => void) {
  const [pendingSales, setPendingSales] = useState<OfflinePendingSale[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const syncingRef = useRef(false);

  const refreshPending = useCallback(async () => {
    if (!tillId) {
      setPendingSales([]);
      return;
    }
    setPendingSales(await getPendingSalesForTill(tillId));
  }, [tillId]);

  useEffect(() => {
    refreshPending();
  }, [refreshPending]);

  const syncNow = useCallback(async () => {
    if (!tillId || syncingRef.current) return;
    syncingRef.current = true;
    setIsSyncing(true);
    try {
      const queue = (await getPendingSalesForTill(tillId)).filter((s) => s.status !== "failed");
      let syncedAny = false;

      for (const sale of queue) {
        try {
          const res = await api.post("/tills/sales", {
            tillId: sale.tillId,
            items: sale.lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity })),
            cashGiven: sale.cashGiven,
            saleType: sale.saleType ?? "RETAIL",
            clientTxnId: sale.clientTxnId,
            clientOccurredAt: sale.clientOccurredAt,
          });
          if (res.data.success) {
            await removePendingSale(sale.clientTxnId);
            syncedAny = true;
          }
        } catch (err: any) {
          if (!err.response) {
            // No response at all - genuinely still offline (or a transient
            // blip). Stop the whole pass; no point burning through the rest
            // of the queue against a connection that isn't there right now.
            break;
          }
          const reason = err.response?.data?.error || "Sync failed.";
          await updatePendingSaleStatus(sale.clientTxnId, "failed", reason);
          try {
            await api.post("/tills/sales/sync-failures", {
              clientTxnId: sale.clientTxnId,
              reason,
              saleSnapshot: sale,
            });
          } catch {
            // Best-effort cross-device visibility only - the local "failed"
            // status above is already recorded either way.
          }
        }
      }

      await refreshPending();
      if (syncedAny) onSynced();
    } finally {
      syncingRef.current = false;
      setIsSyncing(false);
    }
  }, [tillId, onSynced, refreshPending]);

  useEffect(() => {
    if (!tillId) return;
    const handleOnline = () => {
      syncNow();
    };
    window.addEventListener("online", handleOnline);
    const interval = setInterval(syncNow, SYNC_INTERVAL_MS);
    return () => {
      window.removeEventListener("online", handleOnline);
      clearInterval(interval);
    };
  }, [tillId, syncNow]);

  const queueSale = useCallback(
    async (sale: OfflinePendingSale) => {
      await enqueuePendingSale(sale);
      await refreshPending();
      // Attempt a sync right away in case this was just a transient blip
      // rather than a genuine outage - no reason to wait for the next poll.
      syncNow();
    },
    [refreshPending, syncNow]
  );

  // Real money was physically collected for every locally-queued sale
  // regardless of sync outcome (pending or failed) - only a synced sale has
  // moved into the server's authoritative till.cashSalesTotal.
  const pendingTotal = pendingSales.reduce(
    (sum, s) => sum + s.lines.reduce((lineSum, l) => lineSum + l.unitPrice * l.quantity, 0),
    0
  );
  const needsAttention = pendingSales.filter((s) => s.status === "failed");

  return { pendingSales, needsAttention, pendingTotal, isSyncing, syncNow, queueSale, refreshPending };
}
