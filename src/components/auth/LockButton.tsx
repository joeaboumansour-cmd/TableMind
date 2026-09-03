"use client";

// =============================================
// LockButton — one tap, and the till is frozen.
//
// Deliberately NOT behind a confirm dialog, and deliberately NOT tucked inside
// the account menu. Locking is the thing this whole feature exists to make
// cheap: a cashier stepping out for two minutes should not have to think about
// it, and it destroys nothing — the cart, the lanes, the open shift and every
// queued sale are exactly where they were when the screen comes back.
//
// Sign-out keeps its confirm and its cart warning. That one IS destructive.
// =============================================

import { Lock } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthContext";
import { lockSession } from "@/lib/auth/lockStore";
import { getCachedStoreUsernameForStoreId } from "@/lib/auth/offlineAuth";
import { logActivity } from "@/lib/activity/logger";
import { cn } from "@/lib/utils";

export function useLockTill(): () => void {
  const { user } = useAuth();
  return () => {
    if (!user) return;
    // The roster is keyed by store USERNAME; a session only carries store_id.
    // Falling back to the username keeps the lock working on a device whose
    // credential cache has been cleared — the lock screen then just starts on
    // the full form instead of the person's PIN pad, which is the safe way to
    // fail.
    const storeUsername =
      getCachedStoreUsernameForStoreId(user.storeId) ?? user.username;

    logActivity("auth.lock", {
      target: user.displayName,
      details: { role: user.isOwner ? "owner" : "employee" },
    });

    lockSession({ storeUsername, username: user.username });
  };
}

export function LockButton({ className }: { className?: string }) {
  const lock = useLockTill();

  return (
    <button
      type="button"
      onClick={lock}
      aria-label="Lock the till"
      title="Lock the till"
      className={cn(
        "tap flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground",
        className
      )}
    >
      <Lock className="h-4 w-4" />
    </button>
  );
}

export default LockButton;
