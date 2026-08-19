"use client";

// =============================================
// Reactive desktop detection
//
// src/lib/device.ts answers a DIFFERENT question: isMobile()/isDesktop() there
// sniff the user agent, which is the right tool for "is there a camera worth
// scanning with, or is this a till with a hardware scanner". Keep using those
// for hardware decisions.
//
// This hook answers "is there room for a desktop layout", which is a viewport
// question, and it stays correct when the window is resized or the app is
// dragged to another monitor — the UA never changes, so the old helpers cannot.
//
// The breakpoint matches Tailwind's `md`, so `useIsDesktop()` and the `md:`
// utilities can never disagree about which layout is showing.
// =============================================

import { useSyncExternalStore } from "react";

/** Tailwind's `md` breakpoint. Keep in step with the `md:` utilities. */
export const DESKTOP_MIN_WIDTH = 768;
const QUERY = `(min-width: ${DESKTOP_MIN_WIDTH}px)`;

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia(QUERY);
  // Chrome 109 (the legacy build's baseline) supports addEventListener on
  // MediaQueryList, but Safari only got it in 14 — addListener is the fallback
  // that works everywhere this app runs.
  if (mql.addEventListener) {
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }
  mql.addListener(onChange);
  return () => mql.removeListener(onChange);
}

function getSnapshot(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(QUERY).matches;
}

// Server renders the mobile layout, matching how the app already behaves: the
// POS swaps to its desktop branch in an effect after mount.
const getServerSnapshot = () => false;

export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
