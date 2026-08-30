"use client";

// =============================================
// Viewport height sync
//
// Publishes the ACTUALLY visible viewport height as `--app-h`.
//
// Why not just 100dvh: on Android Chrome the retractable URL bar makes the
// viewport a moving target, and dvh does not track it tightly enough — the
// shell ends up taller than what is on screen, the document gains a scroll it
// should not have, and the bottom tab bar falls below the fold. That is the
// "sometimes I have to scroll to see the nav bar" report, and it is Android
// only because iOS standalone has no URL bar to retract.
//
// visualViewport.height is the one measurement that is correct on every
// platform, so the shell sizes itself from that and the tab bar lands exactly
// on the bottom edge of whatever screen it is running on.
// =============================================

import { useEffect } from "react";

/**
 * A visual/layout viewport gap larger than this is the on-screen keyboard,
 * not browser chrome.
 */
const KEYBOARD_THRESHOLD_PX = 150;

export default function ViewportHeightSync() {
  useEffect(() => {
    const root = document.documentElement;
    const vv = window.visualViewport;

    // Last height measured with no keyboard up.
    let lastStable = window.innerHeight;
    // What is actually written into `--app-h` right now. Setting a custom
    // property dirties the root element's inline style and invalidates style
    // for the WHOLE document — every descendant that could read the variable.
    // `visualViewport` fires `scroll` once per frame while Android's URL bar
    // retracts, and this used to write on every one of those, unconditionally,
    // even when the number had not changed. Tracking the written value turns a
    // per-frame full-document invalidation into one write per real change.
    let written = -1;
    let frame = 0;

    const measure = () => {
      const visual = vv?.height ?? window.innerHeight;
      const layout = window.innerHeight;

      // iOS floats the keyboard OVER the page: the visual viewport collapses
      // but the layout viewport does not. Shrinking the shell to match would
      // reflow the whole POS every time the cashier taps a search box, so the
      // keyboard is deliberately ignored and the last chrome-only height is
      // kept. On Android the layout viewport shrinks too, so the gap stays
      // small, the keyboard is not detected, and the shell resizes with it —
      // which is the native behaviour there.
      const keyboardOpen = layout - visual > KEYBOARD_THRESHOLD_PX;
      if (keyboardOpen) return;

      // Never taller than the visible area, whichever measure is smaller.
      lastStable = Math.min(visual, layout);

      const next = Math.round(lastStable);
      if (next === written) return;
      written = next;
      root.style.setProperty("--app-h", `${next}px`);
    };

    // Coalesce to one measurement per frame. A URL-bar retraction fires
    // `scroll` and `resize` in the same frame, and reading `innerHeight` /
    // `visualViewport.height` forces a layout flush — doing that twice per
    // frame is a guaranteed forced reflow on the platform (Android) where
    // this component exists in the first place.
    const apply = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };

    // Synchronous on mount: the shell needs a height for its first paint, and
    // waiting a frame for it means one frame at the dvh fallback.
    measure();

    vv?.addEventListener("resize", apply);
    // The URL bar sliding away fires scroll on the visual viewport, not resize.
    vv?.addEventListener("scroll", apply);
    window.addEventListener("resize", apply);
    window.addEventListener("orientationchange", apply);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      vv?.removeEventListener("resize", apply);
      vv?.removeEventListener("scroll", apply);
      window.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", apply);
    };
  }, []);

  return null;
}
