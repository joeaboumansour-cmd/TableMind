"use client";

// =============================================
// Editable cart quantity (desktop till only)
//
// The mobile cart keeps its +/- buttons and nothing else: on a phone, tapping
// a number field summons a keyboard over the cart and typing "12" is slower
// than two taps. A desktop till already has a physical keyboard and a cashier
// whose hands are on it, so retyping a quantity beats clicking "+" eleven
// times.
//
// The +/- buttons stay either way. This only replaces the static number
// between them with an input.
//
// Commit rules, deliberately conservative for a till:
//   - Enter or blur commits; Escape reverts.
//   - Anything that is not a positive whole number reverts to the current
//     quantity. Typing 0 does NOT delete the line -- an accidental clear
//     should not silently drop an item a customer is standing there buying.
//     Removal stays on the "-" button, which is explicit.
// =============================================

import { useEffect, useRef, useState } from "react";

interface Props {
  quantity: number;
  productName: string;
  /** Called only with a positive whole number that differs from `quantity`. */
  onCommit: (quantity: number) => void;
}

export default function CartQuantityInput({ quantity, productName, onCommit }: Props) {
  const [draft, setDraft] = useState(String(quantity));
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Keep in step when the quantity changes from anywhere else: the +/- buttons,
  // or a repeat scan of the same barcode incrementing the line.
  useEffect(() => {
    setDraft(String(quantity));
  }, [quantity]);

  const commit = () => {
    const next = Number.parseInt(draft, 10);
    if (!Number.isFinite(next) || next < 1) {
      setDraft(String(quantity));
      return;
    }
    if (next !== quantity) onCommit(next);
  };

  return (
    <input
      ref={inputRef}
      type="text"
      // Not type="number": its spinners and locale-dependent parsing are more
      // trouble than the digit filtering below, and inputMode already gets the
      // numeric keypad on the rare touchscreen till.
      inputMode="numeric"
      autoComplete="off"
      value={draft}
      aria-label={`Quantity for ${productName}`}
      onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ""))}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
          inputRef.current?.blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          setDraft(String(quantity));
          inputRef.current?.blur();
        }
        // Everything else, F-keys included, is left to bubble: the POS
        // shortcuts must keep working while a quantity is being edited.
      }}
      className="w-10 rounded-lg bg-transparent text-center text-[15px] font-bold tnum outline-none focus:bg-background focus:ring-1 focus:ring-primary/60"
    />
  );
}
