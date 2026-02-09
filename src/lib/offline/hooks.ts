"use client";

import { useState, useEffect, useCallback } from "react";
import {
  initDB,
  getSyncState,
  updateSyncState,
  addNetworkListeners,
  syncPendingActions,
  getPendingCount,
  isOnline,
  type SyncState,
  type PendingAction,
} from "./indexeddb";

interface UseOfflineOptions {
  autoSync?: boolean;
  syncInterval?: number;
}

interface UseOfflineReturn {
  isOnline: boolean;
  syncState: SyncState;
  pendingCount: number;
  lastSyncedAt: number | null;
  isSyncing: boolean;
  sync: () => Promise<void>;
  forceOffline: () => void;
  forceOnline: () => void;
  addPendingAction: (action: Omit<PendingAction, "id" | "timestamp">) => Promise<void>;
}

export function useOffline(options: UseOfflineOptions = {}): UseOfflineReturn {
  const { autoSync = true, syncInterval = 30000 } = options;
  const [online, setOnline] = useState(true);
  const [syncState, setSyncState] = useState<SyncState>({
    lastSyncedAt: null,
    pendingCount: 0,
    isOnline: true,
  });
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    initDB().catch(console.error);
    getSyncState().then(setSyncState);
    getPendingCount().then(setPendingCount);
    setOnline(isOnline());

    const cleanup = addNetworkListeners(
      () => {
        setOnline(true);
        updateSyncState({ isOnline: true });
        if (autoSync) syncPendingActions();
      },
      () => {
        setOnline(false);
        updateSyncState({ isOnline: false });
      }
    );
    return cleanup;
  }, [autoSync]);

  useEffect(() => {
    if (!autoSync || !online) return;
    const interval = setInterval(() => {
      syncPendingActions().then(() => {
        getSyncState().then(setSyncState);
        getPendingCount().then(setPendingCount);
      });
    }, syncInterval);
    return () => clearInterval(interval);
  }, [autoSync, online, syncInterval]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleMessage = (event: MessageEvent) => {
      if (event.data && (event.data.type === "SYNC_WAITLIST" || event.data.type === "SYNC_ALL")) {
        syncPendingActions().then(() => {
          getSyncState().then(setSyncState);
          getPendingCount().then(setPendingCount);
        });
      }
    };
    navigator.serviceWorker?.addEventListener("message", handleMessage);
    return () => navigator.serviceWorker?.removeEventListener("message", handleMessage);
  }, []);

  const sync = useCallback(async () => {
    if (!online || isSyncing) return;
    setIsSyncing(true);
    try {
      await syncPendingActions();
      const newState = await getSyncState();
      const newPending = await getPendingCount();
      setSyncState(newState);
      setPendingCount(newPending);
    } finally {
      setIsSyncing(false);
    }
  }, [online, isSyncing]);

  const addPendingAction = useCallback(async (action: Omit<PendingAction, "id" | "timestamp">) => {
    await import("./indexeddb").then(({ addPendingAction: addAction }) =>
      addAction({ ...action, id: crypto.randomUUID(), timestamp: Date.now() })
    );
    const count = await getPendingCount();
    setPendingCount(count);
  }, []);

  const forceOffline = useCallback(() => {
    setOnline(false);
    updateSyncState({ isOnline: false });
  }, []);

  const forceOnline = useCallback(() => {
    setOnline(true);
    updateSyncState({ isOnline: true });
    if (autoSync) sync();
  }, [autoSync, sync]);

  return { isOnline: online, syncState, pendingCount, lastSyncedAt: syncState.lastSyncedAt, isSyncing, sync, forceOffline, forceOnline, addPendingAction };
}

export function useOfflineWaitlist<T>(options: { enabled?: boolean } = {}) {
  const { enabled = true } = options;
  const [data, setData] = useState<T[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const { isOnline, pendingCount, lastSyncedAt, sync, addPendingAction: addAction } = useOffline({ autoSync: enabled });

  useEffect(() => {
    if (!enabled) return;
    import("./indexeddb").then(async ({ getOfflineWaitlist }) => {
      try {
        const offlineData = await getOfflineWaitlist();
        setData(offlineData as T[]);
      } catch (err) {
        setError(err as Error);
      } finally {
        setIsLoading(false);
      }
    });
  }, [enabled]);

  const saveLocal = useCallback(async (newData: T[]) => {
    const { saveWaitlistOffline } = await import("./indexeddb");
    await saveWaitlistOffline(newData as any[]);
    setData(newData);
  }, []);

  return { data, isLoading, error, isOffline: !isOnline, pendingChanges: pendingCount, lastSynced: lastSyncedAt, saveLocal, addPendingAction: addAction, forceSync: sync };
}
