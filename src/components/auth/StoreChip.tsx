"use client";

// The store, pinned at the top and never typed.
//
// A till is not mobile — it lives on one counter in one shop, and the store
// username was the first of three fields a cashier retyped on every single
// sign-in. It is remembered from the credential cache instead, with a "Change"
// that is deliberately small: switching store is rare, and the affordance
// should not compete with the roster underneath it.

import { Store as StoreIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function StoreChip({
  storeUsername,
  onChange,
  className,
}: {
  storeUsername: string;
  onChange?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-card px-3 py-2.5",
        className
      )}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
        <StoreIcon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
          Store
        </span>
        <span className="block truncate text-[15px] font-semibold text-foreground">
          {storeUsername}
        </span>
      </span>
      {onChange && (
        <button
          type="button"
          onClick={onChange}
          className="tap shrink-0 rounded-lg px-2.5 py-1.5 text-[13px] font-semibold text-primary hover:bg-primary/10"
        >
          Change
        </button>
      )}
    </div>
  );
}

export default StoreChip;
