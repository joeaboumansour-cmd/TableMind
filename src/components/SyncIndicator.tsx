// =============================================
// SyncIndicator - Shows online/offline status
// and pending sync count
// =============================================

"use client";

import { Wifi, WifiOff, Upload, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { syncEngine } from "@/lib/sync/engine";
import { connectivity } from "@/lib/connectivity";

export function SyncIndicator({
  compact = false,
  dot = false,
}: {
  compact?: boolean;
  /** Bare status dot — no label. Used inside the POS header chip, where the
   *  store name is the subject and connectivity is an ambient detail. */
  dot?: boolean;
}) {
  const [isOnline, setIsOnline] = useState(connectivity.isOnline);
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    // Subscribe to real connectivity changes (heartbeat-based)
    const unsubscribeConnectivity = connectivity.subscribe((status) => {
      setIsOnline(status === "online");
    });

    // Subscribe to sync engine updates
    const unsubscribe = syncEngine.subscribe((status, count) => {
      setPendingCount(count || 0);
      setIsSyncing(status === "syncing");
    });

    return () => {
      unsubscribeConnectivity();
      unsubscribe();
    };
  }, []);

  const handleSyncNow = () => {
    if (isOnline) {
      syncEngine.syncNow().then((result) => {
        if (result.pushed > 0) {
          // The toast is handled by the component using this
          console.log(`[SyncIndicator] Synced ${result.pushed} transactions`);
        }
      });
    }
  };

  if (dot) {
    // Three states, one glyph: offline (red), work waiting to go up
    // (amber, pinging), everything settled (green).
    const state = !isOnline
      ? { color: "bg-red-500", label: "Offline" }
      : pendingCount > 0 || isSyncing
        ? { color: "bg-amber-400", label: `${pendingCount} waiting to sync` }
        : { color: "bg-emerald-400", label: "Online" };

    return (
      <span className="relative flex h-2.5 w-2.5 shrink-0" title={state.label}>
        <span className="sr-only">{state.label}</span>
        {(pendingCount > 0 || isSyncing || !isOnline) && (
          <span
            className={`animate-status-ping absolute inline-flex h-full w-full rounded-full ${state.color}`}
            aria-hidden
          />
        )}
        <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${state.color}`} aria-hidden />
      </span>
    );
  }

  if (compact) {
    // Compact version for mobile
    return (
      <div className="flex items-center gap-2">
        <span className={`flex items-center gap-1 text-xs ${isOnline ? "text-green-500" : "text-red-500"}`}>
          {isOnline ? (
            <Wifi className="h-3 w-3" />
          ) : (
            <WifiOff className="h-3 w-3" />
          )}
          {isOnline ? "Online" : "Offline"}
        </span>
        {pendingCount > 0 && (
          <span className="flex items-center gap-1 text-xs text-amber-500 font-medium">
            <Upload className="h-3 w-3" />
            {pendingCount} pending
          </span>
        )}
        {isSyncing && (
          <RefreshCw className="h-3 w-3 text-blue-500 animate-spin" />
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {isOnline ? (
        <Badge
          variant="outline"
          className="border-green-500 text-green-600 flex items-center gap-1 text-xs"
        >
          <Wifi className="h-3 w-3" />
          Connected
        </Badge>
      ) : (
        <Badge
          variant="outline"
          className="border-red-500 text-red-600 flex items-center gap-1 text-xs"
        >
          <WifiOff className="h-3 w-3" />
          Offline
        </Badge>
      )}
      {pendingCount > 0 && (
        <Badge
          variant="outline"
          className="border-amber-500 text-amber-600 flex items-center gap-1 text-xs"
        >
          <Upload className="h-3 w-3" />
          {pendingCount} pending
        </Badge>
      )}
      {isSyncing && (
        <Badge
          variant="outline"
          className="border-blue-500 text-blue-600 flex items-center gap-1 text-xs"
        >
          <RefreshCw className="h-3 w-3 animate-spin" />
          Syncing...
        </Badge>
      )}
      {pendingCount > 0 && !isSyncing && (
        <Button
          variant="ghost"
          size="sm"
          onClick={handleSyncNow}
          className="text-xs h-7 px-2"
          title="Sync now"
        >
          <RefreshCw className="h-3 w-3 mr-1" />
          Sync
        </Button>
      )}
    </div>
  );
}
