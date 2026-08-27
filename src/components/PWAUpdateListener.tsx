"use client";

import { useEffect, useRef } from "react";
import { useCartStore, hasAnyLaneItems } from "@/lib/stores/cartStore";
import { isReloadHeld, subscribeReloadGuard } from "@/lib/pwa/reloadGuard";

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
 *      the update is applied with a one-time reload — but only once the app is
 *      IDLE, so a deploy can never interrupt work in progress. If it isn't, the
 *      reload is deferred and retried the moment it becomes safe. (We also skip
 *      the reload on the very first install — no SW was controlling yet — to
 *      avoid an unnecessary refresh.)
 *   2. On `visibilitychange` (user switches back to the PWA / unlocks phone),
 *      call `registration.update()`. This is the key fix for iOS: it forces
 *      a byte-compare of sw.js every time the app is foregrounded, bypassing
 *      iOS's slow default update check.
 *   3. As a fallback, call `registration.update()` every 60 minutes while the
 *      app stays open.
 *
 * What counts as "idle":
 *   - The cart is empty (a sale is the most obvious in-flight work), AND
 *   - nothing has taken a hold via `@/lib/pwa/reloadGuard`.
 *
 *   The cart check alone used to be the whole guard, and it silently protected
 *   nothing outside the POS screen. A cashier building a bulk selection on the
 *   inventory page has an empty cart by definition, so a deploy landing mid-
 *   selection reloaded the page and threw the selection away. Screens now
 *   declare their own busy state; see reloadGuard.ts.
 *
 * Performance:
 *   `registration.update()` is a single HTTP request that byte-compares sw.js.
 *   It only runs on focus/visibility change + every 60 min — not continuously.
 *   No UI is rendered. IndexedDB / Dexie data survives the reload untouched.
 */
export default function PWAUpdateListener() {
  const reloadedRef = useRef(false);
  const updatePendingRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    // Only run in production — dev mode disables the SW via next-pwa config.
    if (process.env.NODE_ENV !== "production") return;

    const wasControlled = !!navigator.serviceWorker.controller;

    // 1) Auto-reload when a new SW takes control (skipWaiting + clientsClaim
    //    are already called in the generated sw.js).
    //    NEVER reload while work is in progress. skipWaiting() fires on
    //    install, not on a user gesture, so without this guard a deploy can
    //    hard-reload the cashier's tab mid-task. Zustand `persist` saves the
    //    cart, but in-flight state (a bulk selection, change due, an open
    //    modal, scanner focus, an in-flight POST) is lost.
    const applyUpdateIfIdle = () => {
      if (reloadedRef.current) return;
      if (!updatePendingRef.current) return;
      // EVERY lane, not just the active one: a parked lane holds a customer's
      // shopping just as much as the one on screen does.
      if (hasAnyLaneItems(useCartStore.getState())) return; // sale in progress
      if (isReloadHeld()) return; // a screen is mid-task
      reloadedRef.current = true;
      window.location.reload();
    };

    // Retry hooks, registered once when an update goes pending. Each of these
    // is a moment at which the app may have just become idle.
    let unsubscribeCart: (() => void) | null = null;
    let unsubscribeGuard: (() => void) | null = null;

    const watchForIdle = () => {
      if (unsubscribeCart || unsubscribeGuard) return;
      unsubscribeCart = useCartStore.subscribe((state) => {
        if (!hasAnyLaneItems(state)) applyUpdateIfIdle();
      });
      unsubscribeGuard = subscribeReloadGuard(applyUpdateIfIdle);
    };

    const handleControllerChange = () => {
      if (reloadedRef.current) return;
      if (!wasControlled) return; // first install — no reload needed

      updatePendingRef.current = true;
      applyUpdateIfIdle();
      if (reloadedRef.current) return;

      // Busy right now — wait for the cart to clear or the holds to release.
      watchForIdle();
    };

    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);

    // 2) Force an update check whenever the PWA is foregrounded.
    //    This is critical for iOS, which otherwise checks very rarely.
    //    Foregrounding is also a natural between-tasks moment, so it doubles as
    //    a retry point for an update that was deferred while the app was busy.
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        applyUpdateIfIdle();
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
      unsubscribeGuard?.();
    };
  }, []);

  return null;
}
