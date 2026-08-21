import { useEffect } from "react";
import { useAuth } from "../contexts/AuthContext";
import {
  bootstrapSync,
  connectSyncSocket,
  disconnectSyncSocket,
  resetLocalSyncData,
  startSyncBackground,
  stopSyncBackground,
} from "../lib/syncEngine";
import { clearPosOfflineData } from "../lib/offlineDb";

/**
 * Drives the local-first sync engine's lifecycle off the same auth state
 * everything else already reacts to (mirrors TenantSettingsContext's own
 * `[token]` effect) - mount once near the app root. On login: pull the full
 * bootstrap snapshot into IndexedDB, open the live push socket, and start
 * the background outbox-retry triggers. On logout: tear all of that down
 * and wipe the local mirror, so a shared device's next login never inherits
 * a stale previous tenant's cached data.
 */
export function useSyncEngineLifecycle(): void {
  const { token, user } = useAuth();

  useEffect(() => {
    if (token && user?.tenantId) {
      bootstrapSync(user.tenantId).catch((err) => {
        console.error("Failed to bootstrap local-first sync:", err);
      });
      connectSyncSocket(token);
      startSyncBackground();
    } else {
      disconnectSyncSocket();
      stopSyncBackground();
      resetLocalSyncData().catch(() => {});
      clearPosOfflineData().catch(() => {});
    }

    return () => {
      disconnectSyncSocket();
      stopSyncBackground();
    };
  }, [token, user?.tenantId]);
}
