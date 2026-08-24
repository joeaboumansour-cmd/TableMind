/**
 * warmAppShell — put real HTML documents into the `app-shell` cache.
 *
 * Why this exists:
 *   The app-shell cache is populated by the service worker as a side effect of
 *   navigating, so a route the cashier has never opened is not there when the
 *   internet goes. The POS used to try to pre-warm it like this:
 *
 *     fetch("/checkout", { method: "HEAD", cache: "force-cache" })
 *
 *   That never worked. Every Workbox route is registered with "GET" as its
 *   third argument, so a HEAD request is not intercepted at all — and a HEAD
 *   response has no body, so it could not serve a navigation even if it were.
 *   The warm was silently a no-op for as long as it existed.
 *
 *   Writing to the Cache Storage API directly does work: the cache is keyed by
 *   URL, so an entry we put in `app-shell` ourselves is exactly what the
 *   NetworkFirst handler looks for when the network is gone.
 *
 * Keep CACHE_NAME in step with the `app-shell` rule in next.config.ts.
 */

/** Must match next.config.ts → workboxOptions.runtimeCaching → cacheName. */
const CACHE_NAME = "app-shell";

/**
 * Routes a cashier must be able to reach cold with no internet.
 *
 * /pos is the manifest start_url and matters most. /checkout is deliberately
 * outside the (shell) route group but is the other half of every sale.
 */
const SHELL_ROUTES = [
  "/pos",
  "/checkout",
  "/pos/products",
  "/pos/cash",
  "/transactions",
] as const;

let warmedThisSession = false;

/**
 * Fetch each shell route and store it in the app-shell cache.
 *
 * Deliberately NOT cache.addAll(): that is all-or-nothing, so one route
 * failing (a permission redirect, a slow response) would throw away the whole
 * warm. Each route is added independently and a failure on one is logged and
 * skipped — a partial warm is strictly better than none.
 *
 * `force` re-warms even if this session already did, for callers that know the
 * shell changed.
 */
export async function warmAppShell(force = false): Promise<{ warmed: number; failed: number }> {
  const result = { warmed: 0, failed: 0 };

  if (warmedThisSession && !force) return result;
  if (typeof caches === "undefined") return result;

  try {
    const cache = await caches.open(CACHE_NAME);

    await Promise.all(
      SHELL_ROUTES.map(async (route) => {
        try {
          // Explicitly bypass the HTTP cache so we store a genuinely fresh
          // document rather than re-storing whatever the browser already held.
          const response = await fetch(route, {
            credentials: "same-origin",
            cache: "no-cache",
          });

          // Only cache a real document. A redirect to /login or a 500 would
          // otherwise become the thing the till opens to when offline.
          if (!response.ok || response.redirected) {
            result.failed++;
            return;
          }

          await cache.put(route, response);
          result.warmed++;
        } catch {
          result.failed++;
        }
      })
    );

    warmedThisSession = true;
    console.log(
      `[AppShell] Warmed ${result.warmed}/${SHELL_ROUTES.length} routes for offline cold start` +
        (result.failed ? ` (${result.failed} failed)` : "")
    );
  } catch (e) {
    console.warn("[AppShell] Warm failed:", e);
  }

  return result;
}

/**
 * Which shell routes are currently cached. Used by the offline drill in the
 * plan's verification section, and useful from the console on a real device.
 */
export async function getWarmedRoutes(): Promise<string[]> {
  if (typeof caches === "undefined") return [];
  try {
    const cache = await caches.open(CACHE_NAME);
    const keys = await cache.keys();
    return keys.map((r) => new URL(r.url).pathname);
  } catch {
    return [];
  }
}
