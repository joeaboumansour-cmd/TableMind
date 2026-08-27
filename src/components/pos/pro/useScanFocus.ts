"use client";

// =============================================
// Keep the scan field focused (desktop Pro till)
//
// A hardware wedge scanner is just a keyboard: it types the barcode wherever
// the caret happens to be and presses Enter. If focus is sitting on the "+"
// button a cashier last tapped, the scan goes nowhere — the item silently does
// not get added, and nobody notices until the total is wrong.
//
// So the scan field is the resting place for focus, and anything that takes it
// away hands it back. What this must NOT do is fight the cashier: while they
// are typing in a price, a name or a quantity, focus belongs to them.
// =============================================

import { useEffect } from "react";

/** Somewhere the user could be deliberately typing. */
function isTextEntry(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return (el as HTMLElement).isContentEditable === true;
}

/**
 * A modal traps focus on purpose (Radix moves focus in on open and restores it
 * on close). Yanking it out from under one breaks the trap and the Escape
 * handling with it.
 */
function isInsideDialog(el: Element | null): boolean {
  return !!el && typeof el.closest === "function" && !!el.closest('[role="dialog"]');
}

/** The user is highlighting something to read it; do not collapse it. */
function hasTextSelection(): boolean {
  const sel = window.getSelection();
  return !!sel && !sel.isCollapsed && String(sel).length > 0;
}

/**
 * @param ref     the scan field
 * @param paused  true while something else legitimately owns the keyboard —
 *                a line editor, the unknown-barcode strip, a confirm dialog,
 *                an in-flight write. The keeper goes completely inert rather
 *                than trying to be clever about it.
 */
export function useScanFocus(
  ref: React.RefObject<HTMLInputElement | null>,
  paused: boolean
): void {
  useEffect(() => {
    if (paused) return;
    const input = ref.current;
    if (!input) return;

    let frame = 0;

    const restore = () => {
      const active = document.activeElement;
      if (active === input) return;
      if (isTextEntry(active)) return;
      if (isInsideDialog(active)) return;
      if (hasTextSelection()) return;
      // A detached or hidden field cannot take focus; bail rather than loop.
      if (!input.isConnected || input.disabled) return;
      input.focus();
    };

    // Deferred by a frame, never called inline: on a click the browser is
    // mid-way through focus/mouseup/click when these fire, and moving focus
    // in the middle of that sequence can swallow the click the cashier just
    // made. Letting the event finish first is what keeps buttons working.
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(restore);
    };

    // focusout covers keyboard traversal and programmatic blur (the quantity
    // field blurs itself on Enter); pointerup covers taps on buttons and on
    // dead space, which produce no focus change at all on some elements.
    document.addEventListener("focusout", schedule);
    document.addEventListener("pointerup", schedule);
    // Coming back from another window or another tab.
    window.addEventListener("focus", schedule);

    // And once now, so re-enabling after an editor closes lands focus back
    // here without every call site having to remember to do it.
    schedule();

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("focusout", schedule);
      document.removeEventListener("pointerup", schedule);
      window.removeEventListener("focus", schedule);
    };
  }, [ref, paused]);
}
