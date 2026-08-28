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

/**
 * How often to check that focus has not been left nowhere. Frequent enough
 * that a cashier never out-types it, cheap enough to be irrelevant: it reads
 * one property and returns.
 */
const FOCUS_SWEEP_MS = 300;

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

    // Safety net for the paths that fire NO event at all. React unmounting the
    // element that currently has focus — a cart row removed, an editor closing,
    // a lane tab disappearing — drops focus onto <body> without a reliable
    // focusout, and the till would then silently swallow the next scan.
    //
    // Deliberately narrow: it only acts when focus is nowhere (body/html/null),
    // so it can never pull the caret out of a field someone is typing in. That
    // is why it is safe to run on a timer rather than trying to enumerate every
    // way focus can be lost.
    const sweep = window.setInterval(() => {
      const active = document.activeElement;
      if (active && active !== document.body && active !== document.documentElement) return;
      restore();
    }, FOCUS_SWEEP_MS);

    // And once now, so re-enabling after an editor closes lands focus back
    // here without every call site having to remember to do it.
    schedule();

    return () => {
      cancelAnimationFrame(frame);
      window.clearInterval(sweep);
      document.removeEventListener("focusout", schedule);
      document.removeEventListener("pointerup", schedule);
      window.removeEventListener("focus", schedule);
    };
  }, [ref, paused]);
}
