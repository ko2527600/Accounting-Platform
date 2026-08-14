import { useEffect } from "react";
import { useAuth } from "../contexts/AuthContext";
import { connectPresenceSocket, disconnectPresenceSocket } from "../lib/presenceSocket";

/**
 * Drives the live "who's online" presence socket off the same auth state
 * useSyncEngineLifecycle already reacts to - mount once near the app root,
 * unconditionally for every role (not just Admin), so the online roster
 * reflects everyone actually using the app. Only the Team Management page
 * (Admin-only) actually displays it, but every logged-in session needs to
 * be connected for that roster to be accurate.
 */
export function usePresenceLifecycle(): void {
  const { token } = useAuth();

  useEffect(() => {
    if (token) {
      connectPresenceSocket(token);
    } else {
      disconnectPresenceSocket();
    }

    return () => {
      disconnectPresenceSocket();
    };
  }, [token]);
}
