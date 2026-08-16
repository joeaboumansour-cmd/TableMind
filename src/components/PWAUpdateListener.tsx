"use client";

import { useEffect, useRef } from "react";
import { useCartStore } from "@/lib/stores/cartStore";

/**
 * PWAUpdateListener — silently keeps the installed PWA up to date.
 *
 * Why this exists:
 *   Browsers (especially iOS Safari) check for service-worker updates very
 *   infrequently — sometimes 24h+. This means users can be stuck on an old
 *   version for a long time after a deploy, with no way to "clear data" on
 *   iOS. This component forces an update check at the right moments so users
 *   always get the latest code without manually clearing cache.
 *
 * What it does (all silent, no UI, negligible cost):
 *   1. On first load, if a SW is already controlling the page, register a
 *      `controllerchange` listener. When a new SW activates via skipWaiting(),
 *      the listener reloads the page once so the user gets fresh content —
 *      but only while the cart is empty, so a deploy can never interrupt a
 *      sale in progress. If a sale is open, the reload is deferred until the
 *      cart clears. (We also skip the reload on the very first install — no
 *      SW was controlling yet — to avoid an unnecessary refresh.)
 *   2. On `visibilitychange` (user switches back to the PWA / unlocks phone),
 *      call `registration.update()`. This is the key fix for iOS: it forces
 *      a byte-compare of sw.js every time the app is foregrounded, bypassing
 *      iOS's slow default update check.
 *   3. As a fallback, call `registration.update()` every 60 minutes while the
 *      app stays open.
 *
 * Performance:
 *   `registration.update()` is a single HTTP request that byte-compares sw.js.
 *   It only runs on focus/visibility change + every 60 min — not continuously.
 *   No UI is rendered. IndexedDB / Dexie data survives the reload untouched.
 */
export default function PWAUpdateListener() {
  const reloadedRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    // Only run in production — dev mode disables the SW via next-pwa config.
    if (process.env.NODE_ENV !== "production") return;

    const wasControlled = !!navigator.serviceWorker.controller;

    // 1) Auto-reload when a new SW takes control (skipWaiting + clientsClaim
    //    are already called in the generated sw.js).
    //    NEVER reload while a sale is in progress. skipWaiting() fires on
    //    install, not on a user gesture, so without this guard a deploy can
    //    hard-reload the cashier's tab mid-transaction. Zustand `persist`
    //    saves the cart, but in-flight payment state (change due, open modal,
    //    scanner focus, an in-flight POST) is lost. If the cart is non-empty
    //    we defer and retry once it empties.
    const reloadIfIdle = () => {
      if (reloadedRef.current) return;
      if (useCartStore.getState().items.length > 0) return; // sale in progress
      reloadedRef.current = true;
      window.location.reload();
    };

    let unsubscribeCart: (() => void) | null = null;

    const handleControllerChange = () => {
      if (reloadedRef.current) return;
      if (!wasControlled) return; // first install — no reload needed

      reloadIfIdle();
      if (reloadedRef.current || unsubscribeCart) return;

      // Cart was non-empty — wait for it to clear, then apply the update.
      unsubscribeCart = useCartStore.subscribe((state) => {
        if (state.items.length === 0) reloadIfIdle();
      });
    };

    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);

    // 2) Force an update check whenever the PWA is foregrounded.
    //    This is critical for iOS, which otherwise checks very rarely.
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        navigator.serviceWorker.getRegistration().then((reg) => {
          if (reg) reg.update().catch(() => {});
        });
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    // 3) Periodic fallback — check every 60 minutes while the app stays open.
    const interval = setInterval(() => {
      navigator.serviceWorker.getRegistration().then((reg) => {
        if (reg) reg.update().catch(() => {});
      });
    }, 60 * 60 * 1000);

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearInterval(interval);
      unsubscribeCart?.();
    };
  }, []);

  return null;
}