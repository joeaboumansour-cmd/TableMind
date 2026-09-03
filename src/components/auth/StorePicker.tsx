"use client";

// =============================================
// StorePicker — "Change" on the store chip lands here.
//
// A till lives in one shop, so this is rare. But when it happens the device
// usually already knows the answer: a phone that has served two branches has
// both in its credential cache. Offering them as rows means changing store is a
// tap, and typing the store username stays the fallback for a shop this device
// has never seen.
//
// Showing how many people are cached per store is the useful bit — it is what
// tells a supervisor which of two similarly-named branches is the one they set
// up.
// =============================================

import { Store as StoreIcon, Check, ChevronRight, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

export interface StorePickerProps {
  /** Store usernames this device holds credentials for, most recent first. */
  stores: string[];
  /** The one currently selected, so it can be marked. */
  current: string;
  /** How many people are cached for a store — drives the subtitle. */
  countFor: (storeUsername: string) => number;
  onPick: (storeUsername: string) => void;
  /** A store this device has never seen: go to the full form. */
  onOther: () => void;
  onCancel: () => void;
  className?: string;
}

export function StorePicker({
  stores,
  current,
  countFor,
  onPick,
  onOther,
  onCancel,
  className,
}: StorePickerProps) {
  return (
    <div className={cn("flex min-h-0 flex-1 flex-col px-5 pb-4", className)}>
      <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
        Which store?
      </p>

      <div className="space-y-2">
        {stores.map((store) => {
          const people = countFor(store);
          const isCurrent = store === current;
          return (
            <button
              key={store}
              type="button"
              onClick={() => onPick(store)}
              className={cn(
                "tap flex w-full items-center gap-3 rounded-2xl border px-3.5 py-3 text-left transition-colors",
                isCurrent
                  ? "border-primary/50 bg-primary/10"
                  : "border-white/[0.07] bg-card hover:border-primary/40 hover:bg-muted/40"
              )}
            >
              <span
                className={cn(
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                  isCurrent ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
                )}
              >
                <StoreIcon className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold text-foreground">
                  {store}
                </span>
                <span className="block text-[12px] text-muted-foreground">
                  {people === 0
                    ? "No one signed in yet"
                    : `${people} ${people === 1 ? "person" : "people"} on this device`}
                </span>
              </span>
              {isCurrent ? (
                <Check className="h-4 w-4 shrink-0 text-primary" />
              ) : (
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
            </button>
          );
        })}

        {/* Always present: a branch this device has never served has no row. */}
        <button
          type="button"
          onClick={onOther}
          className="tap flex w-full items-center gap-3 rounded-2xl border border-dashed border-white/[0.16] px-3.5 py-3 text-left transition-colors hover:border-primary/40"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-muted-foreground">
            <Plus className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold text-foreground">
              Another store
            </span>
            <span className="block text-[12px] text-muted-foreground">
              Sign in with the store username
            </span>
          </span>
        </button>
      </div>

      <div className="mt-4 text-center">
        <button
          type="button"
          onClick={onCancel}
          className="tap rounded-xl px-4 py-2 text-[13px] font-semibold text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export default StorePicker;
