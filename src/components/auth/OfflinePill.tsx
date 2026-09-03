"use client";

// Connectivity, said once, quietly. The login screen needs it because what a
// cashier can DO differs offline (password login falls back to the cached
// credential; a brand-new person cannot sign in at all), and because a till
// that seems broken is usually a till that is simply offline.

import { useEffect, useState } from "react";
import { connectivity } from "@/lib/connectivity";
import { cn } from "@/lib/utils";

export function OfflinePill({ className }: { className?: string }) {
  const [isOnline, setIsOnline] = useState(connectivity.isOnline);

  useEffect(() => {
    // subscribe() replays the current status by default, which is what a
    // freshly mounted screen wants.
    return connectivity.subscribe((status) => setIsOnline(status === "online"));
  }, []);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 text-[12px] font-medium",
        isOnline ? "text-muted-foreground" : "text-amber-400",
        className
      )}
    >
      <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
        {!isOnline && (
          <span className="animate-status-ping absolute inline-flex h-full w-full rounded-full bg-amber-400" />
        )}
        <span
          className={cn(
            "relative inline-flex h-2 w-2 rounded-full",
            isOnline ? "bg-emerald-500" : "bg-amber-400"
          )}
        />
      </span>
      {isOnline ? "Connected" : "Offline"}
    </span>
  );
}

export default OfflinePill;
