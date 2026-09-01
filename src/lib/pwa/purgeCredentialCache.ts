// =============================================
// Remove credential responses the service worker already cached
// =============================================
// The `runtimeCaching` rule in `next.config.ts` stops the worker caching
// `/rest/v1/stores` from now on. It does nothing for the devices that already
// did it, and those are all of them.
//
// Login is hand-rolled: the browser SELECTs the store row and compares the
// password itself, so the response body carries `password_hash` — which is not
// a hash, it is the password. The default `cross-origin` handler wrote that to
// Cache Storage, on disk. It survives logout, because `clearUserFromStorage()`
// clears localStorage and nothing here had ever called `caches.delete()`. It
// survives a browser restart. Any script on the origin can read it.
//
// Found on the live deployment on 2026-09-01, with two entries for `stores`.
//
// So this runs on every launch, forever — not once behind a flag. A till that
// has not been opened in a month still has the old entry, and the cost of
// running it is one `caches.keys()` against a handful of caches.
//
// **This is not the offline-login store.** That is
// `goldensquirrel_offline_credentials_v2` in localStorage, read by
// `validateCachedCredentials()`, and it is deliberately kept across logout so a
// cashier who signs off during an outage can sign back in. Deleting it here
// would strand exactly the person this app exists for.
// =============================================

/** Paths whose RESPONSE BODIES carry credentials. */
const CREDENTIAL_PATH = /\/rest\/v1\/(stores|store_users|admin_users)\b/;

export interface PurgeResult {
  /** Entries deleted. 0 is the expected steady state after the first run. */
  removed: number;
  /** Caches inspected — 0 means Cache Storage was unavailable, not that it was clean. */
  cachesInspected: number;
}

/**
 * Delete every cached response that carries a credential.
 *
 * Never throws and never rejects. It runs on the launch path of a till, and a
 * cache-housekeeping failure must not be able to stop a shop opening — the same
 * reason `logActivity` is fire-and-forget.
 */
export async function purgeCredentialCache(): Promise<PurgeResult> {
  const result: PurgeResult = { removed: 0, cachesInspected: 0 };

  // Absent in a private window, in some embedded webviews, and on http origins.
  if (typeof caches === "undefined") return result;

  try {
    const names = await caches.keys();
    for (const name of names) {
      let cache: Cache;
      try {
        cache = await caches.open(name);
      } catch {
        continue; // one unreadable cache must not abort the rest
      }
      result.cachesInspected++;

      let requests: readonly Request[];
      try {
        requests = await cache.keys();
      } catch {
        continue;
      }

      for (const request of requests) {
        if (!CREDENTIAL_PATH.test(request.url)) continue;
        try {
          if (await cache.delete(request)) result.removed++;
        } catch {
          // Deleting one entry failed; keep going. Partial cleanup beats none.
        }
      }
    }
  } catch {
    // Cache Storage unavailable or blocked. Nothing to do and nothing to say.
  }

  return result;
}
