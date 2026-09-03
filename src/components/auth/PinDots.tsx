"use client";

// Four dots, filling as digits land. Deliberately NOT an <input type="password">:
// a focused input raises the software keyboard over the pad on a phone, and the
// pad is the whole point of this screen.

import { cn } from "@/lib/utils";
import { PIN_LENGTH } from "@/lib/auth/pinPolicy";

export function PinDots({
  length,
  error = false,
  className,
}: {
  length: number;
  error?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-center gap-4",
        error && "animate-pin-shake",
        className
      )}
      role="status"
      aria-live="polite"
      aria-label={`${length} of ${PIN_LENGTH} digits entered`}
    >
      {Array.from({ length: PIN_LENGTH }).map((_, i) => {
        const filled = i < length;
        const justFilled = !error && i === length - 1;
        return (
          <span
            // The key carries `filled` so the dot that just landed REMOUNTS and
            // replays the bump. Without that, React reuses the node and the
            // animation only ever plays once.
            key={`${i}-${filled}`}
            aria-hidden
            className={cn(
              "h-3.5 w-3.5 rounded-full",
              error
                ? "bg-destructive"
                : filled
                  ? "bg-primary"
                  : "border border-white/[0.18] bg-transparent",
              justFilled && "animate-value-bump"
            )}
          />
        );
      })}
    </div>
  );
}

export default PinDots;
