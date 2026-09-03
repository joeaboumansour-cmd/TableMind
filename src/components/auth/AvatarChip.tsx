"use client";

// One person on the till's roster. The tile is the tap target — big, square and
// unambiguous, because the whole promise of this screen is "tap your face, type
// four digits" for someone holding change in the other hand.

import { KeyRound, Lock } from "lucide-react";
import { initialsFor } from "@/lib/auth/initials";
import { cn } from "@/lib/utils";

export interface AvatarChipProps {
  displayName: string;
  hasPin: boolean;
  /** True while this person's pad is cooling after too many wrong PINs. */
  isCoolingDown?: boolean;
  selected?: boolean;
  onClick: () => void;
  className?: string;
}

export function AvatarChip({
  displayName,
  hasPin,
  isCoolingDown = false,
  selected = false,
  onClick,
  className,
}: AvatarChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "tap group flex flex-col items-center gap-2 rounded-2xl p-2 transition-colors",
        className
      )}
    >
      <span
        className={cn(
          "relative flex h-16 w-16 items-center justify-center rounded-2xl border text-xl font-bold tracking-wide transition-colors",
          selected
            ? "border-primary bg-primary text-primary-foreground"
            : "border-white/[0.08] bg-card text-foreground group-hover:border-primary/40 group-hover:bg-muted/40"
        )}
      >
        {initialsFor(displayName)}
        {hasPin && !selected && (
          <span
            className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border border-background bg-muted"
            title="Quick unlock with a PIN"
          >
            {isCoolingDown ? (
              <Lock className="h-3 w-3 text-amber-400" />
            ) : (
              <KeyRound className="h-3 w-3 text-primary" />
            )}
          </span>
        )}
      </span>
      <span
        className={cn(
          "max-w-[5.5rem] truncate text-[13px] font-semibold",
          selected ? "text-primary" : "text-muted-foreground"
        )}
      >
        {displayName}
      </span>
    </button>
  );
}

export default AvatarChip;
