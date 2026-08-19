"use client";

// =============================================
// Arrow-key navigation for a dialog's action row
//
// A desktop till is driven from the keyboard: F4 opens the "finish this sale?"
// confirmation, and the cashier's hands never leave the keys. Tab technically
// works, but nobody reaches for Tab mid-sale -- arrows are what people try.
//
// Left/Up and Right/Down move focus between the enabled buttons in the row.
// Enter needs no handling: a focused <button> is activated by Enter natively.
//
// Focus deliberately starts on the FIRST button, which in this codebase is the
// cancelling one. Landing on the confirm button would mean a stray Enter
// completes a sale, and on a live till that is real money. The cashier arrows
// across to confirm -- one extra keystroke, and an intentional one.
// =============================================

import { useCallback, useEffect, useRef } from "react";

const PREV_KEYS = ["ArrowLeft", "ArrowUp"];
const NEXT_KEYS = ["ArrowRight", "ArrowDown"];

export function useDialogArrowNav<T extends HTMLElement = HTMLDivElement>(open: boolean) {
  const containerRef = useRef<T | null>(null);

  const buttons = useCallback((): HTMLButtonElement[] => {
    if (!containerRef.current) return [];
    return Array.from(
      containerRef.current.querySelectorAll<HTMLButtonElement>("button:not([disabled])")
    );
  }, []);

  // Put focus somewhere predictable once the dialog has mounted its content.
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => {
      const list = buttons();
      if (list.length > 0 && !list.includes(document.activeElement as HTMLButtonElement)) {
        list[0].focus();
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, [open, buttons]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const isPrev = PREV_KEYS.includes(e.key);
      const isNext = NEXT_KEYS.includes(e.key);
      if (!isPrev && !isNext) return;

      // A dialog may contain a text field (an amount, a note). Arrows belong to
      // the caret there, not to us.
      const target = e.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;

      const list = buttons();
      if (list.length < 2) return;

      e.preventDefault();
      const current = list.indexOf(document.activeElement as HTMLButtonElement);
      const delta = isNext ? 1 : -1;
      const next = current === -1 ? 0 : (current + delta + list.length) % list.length;
      list[next].focus();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, buttons]);

  return containerRef;
}
