"use client";

// =============================================
// Keypad — the 3-column numeric pad, shared by the checkout money entry and
// the login PIN pad.
//
// Extracted from checkout/page.tsx, and deliberately PRESENTATIONAL ONLY. It
// renders keys and reports presses; it holds no value, no formatting and no
// validation. Everything the money screen knows — which field is active,
// `000` vs `.`, Tab between LL and USD, Escape to clear, whether the sale is
// already complete — stayed in checkout, where it belongs. The hardware
// keyboard handler stayed there too, for the same reason.
//
// Sharing it means the PIN pad has the same 3x4 geometry and the same key
// sizes as the pad a cashier already uses fifty times a day, so muscle memory
// transfers.
// =============================================

import { type ReactNode } from "react";
import { Delete } from "lucide-react";
import { vibrate } from "@/lib/feedback";
import { cn } from "@/lib/utils";

export type KeypadKey =
  /** A value key: "0".."9", and checkout's "000" and ".". */
  | { kind: "digit"; value: string }
  | { kind: "backspace" }
  | { kind: "action"; id: string; label: ReactNode; ariaLabel: string }
  /** Holds a grid cell without rendering a control. */
  | { kind: "spacer" };

export interface KeypadProps {
  /** Row-major, three columns. */
  keys: KeypadKey[];
  onKey: (value: string) => void;
  onBackspace: () => void;
  onAction?: (id: string) => void;
  /**
   * Haptic pulse per press.
   *
   * Pass 0 when the caller already vibrates inside its own press handler —
   * checkout does, because its HARDWARE keyboard path calls the same handler,
   * and vibrating here as well would double-pulse every touch press.
   */
  hapticMs?: number;
  disabled?: boolean;
  className?: string;
  keyClassName?: string;
  "aria-label"?: string;
}

/** Checkout's grid, verbatim. Kept as the default so its layout is unchanged. */
const DEFAULT_GRID =
  "grid min-h-[212px] flex-1 shrink-0 grid-cols-3 auto-rows-fr gap-2 px-5 py-3";

const DEFAULT_KEY =
  "tap flex items-center justify-center rounded-2xl bg-muted/50 text-2xl font-semibold tnum active:bg-muted";

export function Keypad({
  keys,
  onKey,
  onBackspace,
  onAction,
  hapticMs = 8,
  disabled = false,
  className,
  keyClassName,
  "aria-label": ariaLabel,
}: KeypadProps) {
  const buzz = () => {
    if (hapticMs > 0) vibrate(hapticMs);
  };

  return (
    <div
      className={cn(DEFAULT_GRID, className)}
      role="group"
      aria-label={ariaLabel}
    >
      {keys.map((key, index) => {
        if (key.kind === "spacer") {
          return <div key={`spacer-${index}`} aria-hidden />;
        }

        if (key.kind === "backspace") {
          return (
            <button
              key={`backspace-${index}`}
              type="button"
              disabled={disabled}
              onClick={() => {
                buzz();
                onBackspace();
              }}
              aria-label="Delete last digit"
              className={cn(
                "tap flex items-center justify-center rounded-2xl bg-muted/50 active:bg-muted",
                disabled && "pointer-events-none opacity-40",
                keyClassName
              )}
            >
              <Delete className="h-6 w-6" />
            </button>
          );
        }

        if (key.kind === "action") {
          return (
            <button
              key={`action-${key.id}`}
              type="button"
              disabled={disabled}
              onClick={() => {
                buzz();
                onAction?.(key.id);
              }}
              aria-label={key.ariaLabel}
              className={cn(
                "tap flex items-center justify-center rounded-2xl bg-muted/50 active:bg-muted",
                disabled && "pointer-events-none opacity-40",
                keyClassName
              )}
            >
              {key.label}
            </button>
          );
        }

        return (
          <button
            key={`digit-${key.value}-${index}`}
            type="button"
            disabled={disabled}
            onClick={() => {
              buzz();
              onKey(key.value);
            }}
            className={cn(
              DEFAULT_KEY,
              disabled && "pointer-events-none opacity-40",
              keyClassName
            )}
          >
            {key.value}
          </button>
        );
      })}
    </div>
  );
}

/** `digits` as value keys, for the common case. */
export function digitKeys(digits: string[]): KeypadKey[] {
  return digits.map((value) => ({ kind: "digit", value }));
}

export default Keypad;
