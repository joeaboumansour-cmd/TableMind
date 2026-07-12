// =============================================
// Hook: Online/Offline Status
// Tracks connectivity changes in real-time
// =============================================

import { useState, useEffect, useCallback } from "react";
import { syncEngine } from "@/lib/sync/engine";
import { getQueuedCount } from "@/lib/db/localDB";

export type NetworkStatus = "online" | "offline";

interface UseOnlineStatusReturn {
  /** Current connectivity status */
  status: NetworkStatus;
  /** True if the browser is online */
  isOnline: boolean;
  /** True if the browser is offline */
  isOffline: boolean;
  /** Number of transactions queued for sync */
  pendingSyncCount: number;
  /** Current sync engine status */
  syncStatus: string;
  /** Trigger a manual sync */
  syncNow: () => Promise<void>;
  /** Refresh the pending count */
  refreshPendingCount: () => Promise<void>;
}

export function useOnlineStatus(): UseOnlineStatusReturn {
  const [status, setStatus] = useState<NetworkStatus>(
    navigator.onLine ? "online" : "offline"
  );
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [syncStatus, setSyncStatus] = useState(syncEngine.status);

  // Update pending count from IndexedDB
  const refreshPendingCount = useCallback(async () => {
    try {
      const count = await getQueuedCount();
      setPendingSyncCount(count);
    } catch {
      // IndexedDB might not be available
    }
  }, []);

  const handleOnline = useCallback(() => {
    setStatus("online");
    refreshPendingCount();
  }, [refreshPendingCount]);

  const handleOffline = useCallback(() => {
    setStatus("offline");
    refreshPendingCount();
  }, [refreshPendingCount]);

  // Listen for online/offline events
  useEffect(() => {
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Initial check
    refreshPendingCount();

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [handleOnline, handleOffline, refreshPendingCount]);

  // Subscribe to sync engine status changes
  useEffect(() => {
    const unsubscribe = syncEngine.subscribe((newStatus) => {
      setSyncStatus(newStatus);
      // Refresh pending count when sync completes
      if (newStatus === "idle" || newStatus === "error") {
        refreshPendingCount();
      }
    });

    return unsubscribe;
  }, [refreshPendingCount]);

  // Trigger a manual sync
  const syncNow = useCallback(async () => {
    if (navigator.onLine) {
      await syncEngine.syncNow();
      await refreshPendingCount();
    }
  }, [refreshPendingCount]);

  return {
    status,
    isOnline: status === "online",
    isOffline: status === "offline",
    pendingSyncCount,
    syncStatus,
    syncNow,
    refreshPendingCount,
  };
}