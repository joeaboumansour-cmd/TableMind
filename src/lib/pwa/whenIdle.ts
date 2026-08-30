/**
 * scheduleWhenIdle — run background work after the browser has finished the
 * work the user is actually waiting for.
 *
 * Why this exists:
 *   A cold PWA launch fires everything at once. On the POS that was ~16
 *   requests in one tick — the connectivity heartbeat, the feature flags, the
 *   category/recipe/combo refreshes, the product pull, three route prefetches
 *   and five app-shell warm fetches — all competing for the same connection
 *   pool and the same main thread. On a warm desktop nobody notices. On iOS,
 *   where every launch is a brand-new WebView on a brand-new connection, the
 *   heartbeat lost that race, timed out, and painted "Offline".
 *
 *   The prefetch/warm half of that burst is for a FUTURE offline launch. It
 *   has no reader on this launch at all, so it has no business racing the
 *   requests that do.
 *
 * The timeout is the important half: requestIdleCallback alone can be starved
 * indefinitely on a busy main thread, and this work still has to happen — a
 * shell that is never warmed is a till that cannot cold-open in an outage.
 * With a timeout the callback is guaranteed to run, just not first.
 *
 * Falls back to a plain setTimeout where requestIdleCallback is missing
 * (Safari only shipped it recently, and the tills run old WebViews).
 */
const IDLE_TIMEOUT_MS = 4000;

export function scheduleWhenIdle(
  fn: () => void,
  timeout: number = IDLE_TIMEOUT_MS
): () => void {
  if (typeof window === "undefined") return () => {};

  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(fn, { timeout });
    return () => window.cancelIdleCallback?.(id);
  }

  const id = window.setTimeout(fn, timeout);
  return () => window.clearTimeout(id);
}
