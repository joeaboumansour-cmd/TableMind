"use client";

// Everyone this DEVICE has seen sign in, plus a way in for anyone it has not.
//
// The list is the offline credential cache that has always existed — it is what
// already decides who can sign in during an outage. Surfacing it turns three
// typed fields into one tap.
//
// PRIVACY NOTE, accepted deliberately: this puts staff display names on a screen
// nobody has authenticated to yet, so whoever holds the till learns who works
// there. "Change store" and the per-person "Forget" below are what ship with
// that trade, and the previous offline banner already listed these same names.

import { UserPlus, X } from "lucide-react";
import type { RosterEntry } from "@/lib/auth/offlineAuth";
import { AvatarChip } from "./AvatarChip";
import { cn } from "@/lib/utils";

export function RosterGrid({
  roster,
  selectedUsername,
  onSelect,
  onOther,
  onForget,
  manageMode = false,
  className,
}: {
  roster: RosterEntry[];
  selectedUsername?: string | null;
  onSelect: (entry: RosterEntry) => void;
  onOther: () => void;
  onForget?: (entry: RosterEntry) => void;
  manageMode?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-4 gap-1 sm:gap-2",
        className
      )}
    >
      {roster.map((entry) => (
        <div key={`${entry.storeUsername}::${entry.username}`} className="relative">
          <AvatarChip
            displayName={entry.displayName}
            hasPin={entry.hasPin}
            // `pinLockedUntil` is already null unless the pad was cold when the
            // roster was read (see toRosterEntry), so there is nothing to
            // compare it against here — and reading the clock during render
            // would make this component non-idempotent.
            isCoolingDown={entry.pinLockedUntil !== null}
            selected={selectedUsername === entry.username}
            onClick={() => onSelect(entry)}
            className="w-full"
          />
          {manageMode && onForget && (
            <button
              type="button"
              onClick={() => onForget(entry)}
              aria-label={`Forget ${entry.displayName} on this device`}
              className="tap absolute right-0 top-0 flex h-6 w-6 items-center justify-center rounded-full border border-white/[0.12] bg-destructive/20 text-destructive"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ))}

      {/* Always present, never conditional. A new hire's first shift is exactly
          when the roster cannot help them, and a screen with no way in for a
          person who is not on it would be worse than the old form. */}
      <button
        type="button"
        onClick={onOther}
        className="tap group flex flex-col items-center gap-2 rounded-2xl p-2"
      >
        <span className="flex h-16 w-16 items-center justify-center rounded-2xl border border-dashed border-white/[0.16] bg-transparent text-muted-foreground transition-colors group-hover:border-primary/40 group-hover:text-primary">
          <UserPlus className="h-6 w-6" />
        </span>
        <span className="max-w-[5.5rem] truncate text-[13px] font-semibold text-muted-foreground">
          Other
        </span>
      </button>
    </div>
  );
}

export default RosterGrid;
