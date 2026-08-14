import { useEffect, useState } from "react";
import { subscribeToPresence, type OnlineUser } from "../lib/presenceSocket";

/** Live "who's online" roster for the current tenant - updates in real time as teammates connect/disconnect. */
export function usePresence(): { online: OnlineUser[]; onlineUserIds: Set<string> } {
  const [online, setOnline] = useState<OnlineUser[]>([]);

  useEffect(() => {
    return subscribeToPresence(setOnline);
  }, []);

  const onlineUserIds = new Set(online.map((u) => u.userId));
  return { online, onlineUserIds };
}
