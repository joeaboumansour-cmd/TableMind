"use client";

// =============================================
// PinSetupCard — offered once, right after a password sign-in.
//
// It lives HERE, on the login screen, rather than as a dialog on /pos. The
// person is already standing still in an auth frame of mind, the interaction is
// a keypad that has no home on the till, and a dialog on /pos can land in the
// middle of a scan.
//
// "Not now" is a full-width button, not a small dismiss: a cashier with a queue
// at the counter must be able to skip this in one obvious tap.
// =============================================

import { useCallback, useEffect, useState } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";
import { Keypad, digitKeys, type KeypadKey } from "@/components/ui/Keypad";
import { PIN_LENGTH, isWeakPin, isWellFormedPin } from "@/lib/auth/pinPolicy";
import { playSuccessSound, playErrorSound } from "@/lib/feedback";
import { useReloadGuard } from "@/lib/pwa/useReloadGuard";
import { cn } from "@/lib/utils";
import PinDots from "./PinDots";

const KEYS: KeypadKey[] = [
  ...digitKeys(["1", "2", "3", "4", "5", "6", "7", "8", "9"]),
  { kind: "spacer" },
  ...digitKeys(["0"]),
  { kind: "backspace" },
];

export function PinSetupCard({
  displayName,
  onSave,
  onSkip,
  skipLabel = "Not now",
  title = "Set a quick PIN",
  className,
}: {
  displayName: string;
  /** Returns an error string to show, or null on success. */
  onSave: (pin: string) => string | null;
  onSkip: () => void;
  skipLabel?: string;
  title?: string;
  className?: string;
}) {
  const [stage, setStage] = useState<"enter" | "confirm">("enter");
  const [first, setFirst] = useState("");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);

  // A reload here loses a half-typed PIN, and unlike the lock screen there is
  // nothing persisted to come back to.
  useReloadGuard(true, "pin-setup");

  useEffect(() => {
    if (!shake) return;
    const t = setTimeout(() => {
      setShake(false);
      setValue("");
    }, 240);
    return () => clearTimeout(t);
  }, [shake]);

  const fail = useCallback((message: string, resetToEnter = false) => {
    playErrorSound();
    setError(message);
    setShake(true);
    if (resetToEnter) {
      setStage("enter");
      setFirst("");
    }
  }, []);

  const commit = useCallback(
    (pin: string) => {
      if (stage === "enter") {
        if (!isWellFormedPin(pin)) return fail("A PIN is four digits.");
        // Blocked, not warned. With only five attempts before a cooldown,
        // allowing 1234 hands the till to the first person who tries it — and
        // the denylist is short enough that the friction is negligible.
        if (isWeakPin(pin)) return fail("That PIN is too easy to guess. Pick another.");
        setFirst(pin);
        setValue("");
        setError(null);
        setStage("confirm");
        return;
      }

      if (pin !== first) {
        return fail("Those did not match. Start again.", true);
      }

      const saveError = onSave(pin);
      if (saveError) return fail(saveError, true);
      playSuccessSound();
    },
    [stage, first, fail, onSave]
  );

  // Committing happens HERE, in the event handler, reading `value` from this
  // render's closure — never inside a setState updater. React may invoke an
  // updater more than once for a single press, and a commit in there would run
  // twice, which on the confirm step compares the code against itself.
  const press = useCallback(
    (digit: string) => {
      if (shake) return;
      if (value.length >= PIN_LENGTH) return;
      const next = value + digit;
      setValue(next);
      if (next.length === PIN_LENGTH) commit(next);
    },
    [shake, value, commit]
  );

  const backspace = useCallback(() => {
    if (shake) return;
    setValue((prev) => prev.slice(0, -1));
    setError(null);
  }, [shake]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        press(e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        backspace();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [press, backspace]);

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <div className="flex flex-col items-center gap-3 px-5 pt-2 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/12 text-primary">
          {stage === "enter" ? (
            <KeyRound className="h-6 w-6" />
          ) : (
            <ShieldCheck className="h-6 w-6" />
          )}
        </span>
        <div>
          <p className="text-[16px] font-bold text-foreground">{title}</p>
          <p className="mt-0.5 max-w-[18rem] text-[12.5px] leading-snug text-muted-foreground">
            {stage === "enter"
              ? `Four digits to get ${displayName} back into the till after a break — no password.`
              : "Enter it once more to confirm."}
          </p>
        </div>

        <PinDots length={value.length} error={shake} className="py-1" />

        <p
          className="min-h-[1.25rem] text-[13px] font-medium text-destructive"
          role={error ? "alert" : undefined}
        >
          {error ?? " "}
        </p>
      </div>

      <Keypad
        aria-label="Set PIN keypad"
        keys={KEYS}
        onKey={press}
        onBackspace={backspace}
        disabled={shake}
        className="mx-auto grid w-full max-w-[320px] flex-1 shrink-0 auto-rows-fr grid-cols-3 gap-2.5 px-5 py-3"
      />

      <div className="px-5 pb-2 pt-1">
        <button
          type="button"
          onClick={onSkip}
          className="tap h-11 w-full rounded-2xl border border-white/[0.08] bg-card text-[14px] font-semibold text-muted-foreground hover:bg-muted/40"
        >
          {skipLabel}
        </button>
      </div>
    </div>
  );
}

export default PinSetupCard;
