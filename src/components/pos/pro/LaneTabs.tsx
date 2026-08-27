"use client";

// =============================================
// Lane strip (desktop Pro till)
//
// One tab per parallel cart. A cashier parks the customer who forgot their
// wallet and opens another lane rather than clearing a cart nobody paid for.
//
// Every control here is a real button sized for a finger, not a hover target:
// plenty of these tills are touchscreens, where :hover either never fires or
// sticks after a tap. The close affordance is therefore always visible on
// every lane it applies to, not revealed on hover.
// =============================================

import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LaneSummary } from "@/lib/types/cart";

/**
 * How long a parked lane sits untouched before the strip starts nagging.
 * Short enough to notice an abandoned cart, long enough that stepping away to
 * fetch one item does not light it up.
 */
export const WAITING_THRESHOLD_MS = 30_000;

/** m:ss, for the WAITING badge. */
export function formatIdle(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
}

interface LaneTabsProps {
  summaries: LaneSummary[];
  canOpen: boolean;
  onSwitch: (laneId: string) => void;
  onOpen: () => void;
  /** Parent confirms first when the lane still holds items. */
  onClose: (laneId: string) => void;
}

export default function LaneTabs({
  summaries,
  canOpen,
  onSwitch,
  onOpen,
  onClose,
}: LaneTabsProps) {
  // A single lane is not a choice — the strip would just be chrome. It appears
  // the moment a second lane exists, and the "+" lives beside the tabs so
  // there is always a way to get there.
  const showClose = summaries.length > 1;

  return (
    <div
      role="tablist"
      aria-label="Sale lanes"
      className="no-scrollbar flex flex-shrink-0 items-stretch gap-1 overflow-x-auto border-b border-white/[0.06] px-3 py-1.5"
    >
      {summaries.map((lane) => {
        const waiting =
          !lane.isActive && !lane.isEmpty && lane.idleMs >= WAITING_THRESHOLD_MS;

        return (
          <div
            key={lane.id}
            className={cn(
              "group relative flex flex-none items-center rounded-xl transition-colors",
              lane.isActive ? "bg-muted/70 ring-1 ring-primary/40" : "hover:bg-muted/30"
            )}
          >
            <button
              type="button"
              role="tab"
              aria-selected={lane.isActive}
              onClick={() => onSwitch(lane.id)}
              className="tap flex min-h-[44px] items-center gap-2 rounded-xl py-1.5 pl-2.5 pr-2"
            >
              {/* The shortcut is printed on the tab so a cashier learns it
                  without being taught it. */}
              <span
                className={cn(
                  "rounded px-1 py-0.5 text-[9px] font-bold uppercase leading-none tracking-[0.08em]",
                  lane.isActive
                    ? "bg-primary/20 text-primary"
                    : "bg-white/[0.06] text-muted-foreground"
                )}
              >
                Alt {lane.position}
              </span>

              <span
                className={cn(
                  "text-sm font-bold leading-none",
                  lane.isActive ? "text-foreground" : "text-muted-foreground"
                )}
              >
                {lane.label}
              </span>

              {lane.isEmpty ? (
                <span className="text-xs font-medium leading-none text-muted-foreground/60">
                  empty
                </span>
              ) : (
                <span
                  className={cn(
                    "text-xs font-semibold leading-none tnum",
                    lane.isActive ? "text-muted-foreground" : "text-muted-foreground/80"
                  )}
                >
                  {lane.unitCount} · {Math.round(lane.total).toLocaleString("en-US")}
                </span>
              )}

              {waiting && (
                <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase leading-none tracking-[0.08em] text-amber-400 tnum">
                  Waiting {formatIdle(lane.idleMs)}
                </span>
              )}
            </button>

            {showClose && (
              <button
                type="button"
                onClick={() => onClose(lane.id)}
                aria-label={`Close ${lane.label}`}
                // Always visible: a touchscreen till has no hover to reveal it.
                className="tap mr-1 flex h-8 w-8 flex-none items-center justify-center rounded-lg text-muted-foreground/60 hover:bg-white/[0.06] hover:text-destructive"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        );
      })}

      <button
        type="button"
        onClick={onOpen}
        disabled={!canOpen}
        aria-label="Open another lane"
        title={canOpen ? "Open another lane" : "Maximum lanes open"}
        className="tap ml-1 flex h-[44px] w-11 flex-none items-center justify-center rounded-xl border border-white/[0.08] text-muted-foreground hover:bg-muted/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}
