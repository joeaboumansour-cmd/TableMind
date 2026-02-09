"use client";

import { useEffect, useState } from "react";

interface OfflineBannerProps {
  pendingCount?: number;
  isSyncing?: boolean;
  lastSyncedAt?: number | null;
  onSync?: () => void;
}

export function OfflineBanner({
  pendingCount = 0,
  isSyncing = false,
  lastSyncedAt,
  onSync,
}: OfflineBannerProps) {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setIsOnline(navigator.onLine);

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  if (isOnline && pendingCount === 0) {
    return null;
  }

  const formatLastSync = (timestamp: number | null) => {
    if (!timestamp) return "";
    const date = new Date(timestamp);
    return date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  };

  if (!isOnline) {
    return (
      <div className="m-4 p-4 rounded-lg border border-amber-200 bg-amber-50 text-amber-900">
        <div className="flex items-center gap-2 font-medium">
          <span>📡</span>
          <span>You're Offline</span>
        </div>
        <div className="mt-1 text-sm opacity-90">
          Changes will be saved locally and synced when you're back online.
        </div>
      </div>
    );
  }

  return (
    <div className="m-4 p-4 rounded-lg border border-blue-200 bg-blue-50 text-blue-900">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 font-medium">
            <span className={isSyncing ? "animate-spin" : ""}>🔄</span>
            <span>Sync Pending</span>
          </div>
          <div className="mt-1 text-sm opacity-90">
            {pendingCount} change{pendingCount !== 1 ? "s" : ""} waiting to sync
            {lastSyncedAt && (
              <span className="ml-2 opacity-75">
                (Last synced: {formatLastSync(lastSyncedAt)})
              </span>
            )}
          </div>
        </div>
        {onSync && (
          <button
            onClick={onSync}
            disabled={isSyncing}
            className="px-3 py-1 text-sm border border-blue-300 rounded bg-white hover:bg-blue-100 disabled:opacity-50"
          >
            {isSyncing ? "Syncing..." : "Sync Now"}
          </button>
        )}
      </div>
    </div>
  );
}
