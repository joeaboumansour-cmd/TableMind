"use client";

// =============================================
// PinPad — four digits and you are back in the till.
//
// Auto-submits on the fourth digit. There is no confirm button on purpose: a
// four-digit code has a known length, so asking for a second tap to say "yes I
// have finished typing four of four" is pure ceremony on the screen whose only
// job is to be fast.
//
// The pad owns the hardware keyboard while it is up. Every other window-level
// keydown handler in the app stands down when the lock is on (see the guards in
// checkout/page.tsx and pos/page.tsx) — including the one that completes a sale
// on F4.
// =============================================

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Keypad, digitKeys, type KeypadKey } from "@/components/ui/Keypad";
import { PIN_LENGTH, PIN_MAX_ATTEMPTS } from "@/lib/auth/pinPolicy";
import { initialsFor } from "@/lib/auth/initials";
import { playErrorSound, vibrate } from "@/lib/feedback";
import { cn } from "@/lib/utils";
import PinDots from "./PinDots";

export interface PinPadProps {
  displayName: string;
  /** Called with the completed code. Resolve false to clear and shake. */
  onSubmit: (pin: string) => Promise<boolean>;
  onCancel: () => void;
  onUsePassword: () => void;
  /** Rendered under the dots — the wrong-PIN or cooldown line. */
  message?: string | null;
  tone?: "error" | "muted";
  /** While cooling, the pad is inert and only the password route is live. */
  disabled?: boolean;
  className?: string;
}

const KEYS: KeypadKey[] = [
  ...digitKeys(["1", "2", "3", "4", "5", "6", "7", "8", "9"]),
  {
    kind: "action",
    id: "cancel",
    ariaLabel: "Back to the list of people",
    label: <ArrowLeft className="h-6 w-6" />,
  },
  ...digitKeys(["0"]),
  { kind: "backspace" },
];

export function PinPad({
  displayName,
  onSubmit,
  onCancel,
  onUsePassword,
  message,
  tone = "muted",
  disabled = false,
  className,
}: PinPadProps) {
  const [value, setValue] = useState("");
  const [shake, setShake] = useState(false);
  // A submit is in flight, or the wrong-PIN shake is still playing. Either way
  // the pad must not accept the first digit of the next attempt yet, or it
  // lands in a code that is about to be cleared.
  const [busy, setBusy] = useState(false);
  const shakeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (shakeTimer.current) clearTimeout(shakeTimer.current);
    };
  }, []);

  const submit = useCallback(
    async (pin: string) => {
      setBusy(true);
      const ok = await onSubmit(pin);
      if (ok) {
        // Leave the dots full — the overlay is about to go away, and blanking
        // them first reads as a failure for the frame before it does.
        setBusy(false);
        return;
      }
      playErrorSound();
      setShake(true);
      shakeTimer.current = setTimeout(() => {
        setShake(false);
        setValue("");
        setBusy(false);
      }, 240);
    },
    [onSubmit]
  );

  // Submitting happens HERE, in the event handler, reading `value` from this
  // render's closure.
  //
  // Not inside a setState updater: React may invoke an updater more than once
  // for a single press, and a submit in there is counted twice against the
  // throttle — five wrong guesses become a cooldown after two and a half.
  // (Observed, and fixed, during verification.) Not in an effect either; a side
  // effect belongs to the interaction that caused it.
  const press = useCallback(
    (digit: string) => {
      if (disabled || busy) return;
      if (value.length >= PIN_LENGTH) return;
      const next = value + digit;
      setValue(next);
      if (next.length === PIN_LENGTH) void submit(next);
    },
    [disabled, busy, value, submit]
  );

  const backspace = useCallback(() => {
    if (disabled || busy) return;
    setValue((prev) => prev.slice(0, -1));
  }, [disabled, busy]);

  // Desktop tills have a keyboard and no touchscreen. While the pad is up it is
  // the only listener that should be acting on keys.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        vibrate(8);
        press(e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        vibrate(12);
        backspace();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [press, backspace, onCancel]);

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <div className="flex flex-col items-center gap-4 px-5 pb-1 pt-2">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/40 bg-primary/10 text-lg font-bold text-primary">
          {initialsFor(displayName)}
        </span>
        <div className="text-center">
          <p className="text-[15px] font-semibold text-foreground">{displayName}</p>
          <p className="text-[12px] text-muted-foreground">Enter your PIN</p>
        </div>

        <PinDots length={value.length} error={shake} className="py-1" />

        {/* The line is always in the layout, even when empty, so the pad does
            not jump down the screen the moment something goes wrong. */}
        <p
          className={cn(
            "min-h-[1.25rem] text-center text-[13px] font-medium tnum",
            tone === "error" ? "text-destructive" : "text-muted-foreground"
          )}
          role={tone === "error" ? "alert" : undefined}
        >
          {message ?? " "}
        </p>
      </div>

      <Keypad
        aria-label="PIN keypad"
        keys={KEYS}
        onKey={press}
        onBackspace={backspace}
        onAction={(id) => id === "cancel" && onCancel()}
        disabled={disabled || busy}
        className="mx-auto grid w-full max-w-[320px] flex-1 shrink-0 auto-rows-fr grid-cols-3 gap-2.5 px-5 py-3"
      />

      <div className="px-5 pb-2 pt-1 text-center">
        <button
          type="button"
          onClick={onUsePassword}
          className={cn(
            "tap rounded-xl px-4 py-2.5 text-[13px] font-semibold",
            // Promoted to the obvious way forward once the pad is cold. It is
            // the only route left, and it must not read as a footnote.
            disabled
              ? "bg-primary text-primary-foreground"
              : "text-primary hover:bg-primary/10"
          )}
        >
          Sign in with password
        </button>
      </div>
    </div>
  );
}

export { PIN_MAX_ATTEMPTS };
export default PinPad;
