// =============================================
// SyncIndicator - Shows online/offline status
// Simple indicator, no sync/pending logic
// =============================================

"use client";

import { Wifi, WifiOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useEffect, useState } from "react";

export function SyncIndicator({ compact = false }: { compact?: boolean }) {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  if (compact) {
    // Compact version for mobile
    return (
      <span className={`flex items-center gap-1 text-xs ${isOnline ? "text-green-500" : "text-red-500"}`}>
        {isOnline ? (
          <Wifi className="h-3 w-3" />
        ) : (
          <WifiOff className="h-3 w-3" />
        )}
        {isOnline ? "Online" : "Offline"}
      </span>
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
    </div>
  );
}