import withPWAInit from "@ducanh2912/next-pwa";
import withBundleAnalyzer from "@next/bundle-analyzer";
import type { NextConfig } from "next";

// `npm run analyze` opens a treemap of the client bundles.
// Worth checking before adding a dependency to a hot route — this app had
// ~800KB of ZXing + recharts sitting in the POS and transactions first paint
// with no way to notice.
const withAnalyzer = withBundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

const withPWA = withPWAInit({
  dest: "public",

  disable: process.env.NODE_ENV === "development",
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  // Do NOT force a reload when the browser fires 'online'. On flaky
  // connectivity this reloads the page mid-sale. Reconnect is already
  // handled by the connectivity heartbeat + sync engine.
  reloadOnOnline: false,
  // NO fallbacks.document — we NEVER want to show an offline blocking page.
  // Pages are served via a NetworkFirst runtime handler, which always fetches
  // fresh HTML when online and falls back to cache offline.
  // We do NOT precache HTML routes with static revisions — doing so would
  // freeze users on stale content forever (Workbox skips re-fetching when
  // the revision string hasn't changed). Static JS/CSS/font chunks are still
  // precached automatically because their filenames are content-hashed.
  //
  // CRITICAL: that runtime cache is the ONLY cached document, so its
  // expiration IS the offline shelf life of the whole app. The default `pages`
  // rule ships with maxAgeSeconds: 86400 — Workbox treats an entry past its
  // age as a miss AND deletes it, so on day 2 of an outage a cold launch found
  // no document and died on the browser's offline page. The `app-shell` rule
  // below fixes that; see the long comment on it.
  //
  // CRITICAL: Exclude /api/health from the service worker 'apis' cache.
  // The connectivity heartbeat probes this endpoint to detect real
  // internet connectivity. If the SW serves a cached 200 response, the
  // app always thinks it's online (offline banners never show, sync never
  // triggers on reconnect). Health checks MUST always hit the real network.
  //
  // CRITICAL: extendDefaultRuntimeCaching MUST stay true.
  // @ducanh2912/next-pwa REPLACES the default runtimeCaching table when a
  // custom array is supplied (resolveRuntimeCaching: `if (!extend) return
  // custom`). Without this flag, supplying the single /api/health rule below
  // silently drops all 19 defaults — including the `pages` NetworkFirst rule
  // that caches HTML navigations. Since we deliberately do not precache HTML
  // (see above), that leaves NO cached document at all and the POS cannot
  // open with no internet.
  // With extend on, custom rules are pushed FIRST and defaults are appended
  // only when their cacheName is not already taken, so the /api/health
  // NetworkOnly rule keeps priority over the default `apis` rule.
  extendDefaultRuntimeCaching: true,
  // Keep the precache to things needed at runtime. The PWA manifest
  // screenshots (~265KB combined) are only ever read by the OS install
  // dialog, which fetches them from the network — precaching them just
  // makes every install download a quarter-megabyte it will never use.
  //
  // `splash` is the same argument, harder: the iOS launch screens are 864 KB
  // across 15 device resolutions, of which any one device uses exactly ONE,
  // and iOS displays the startup image BEFORE the web app runs — so the
  // service worker is not alive to serve it and has no say in the matter.
  // See scripts/generate-splash.mjs.
  //
  // NOTE this is `publicExcludes`, NOT `workboxOptions.exclude` below. That
  // one filters WEBPACK assets, which is why `pdf-export` belongs there, and
  // it never sees files copied out of public/. Putting `/splash/` there
  // instead silently did nothing; `verify:budgets` caught it, reporting the
  // precache 864 KB heavier, which is exactly what that gate is for.
  //
  // The leading "!" entries are exclusion globs (next-pwa convention), and
  // supplying this REPLACES next-pwa's default — `!noprecache/**/*` must stay.
  publicExcludes: ["!noprecache/**/*", "!screenshots/**/*", "!splash/**/*"],
  workboxOptions: {
    // CRITICAL: supplying `exclude` REPLACES next-pwa's defaults, exactly like
    // runtimeCaching above. The first three entries ARE those defaults and
    // must stay:
    //   * the non-preloaded .woff2 files (the preloaded ones end in `.p.woff2`)
    //   * source maps, which are megabytes nobody's browser asks for
    //   * the build's own manifest-*.js
    // Dropping them silently re-adds all of that to every install.
    //
    // `pdf-export` is ours. The PDF exporter (html2pdf.js -> jsPDF +
    // html2canvas + canvg, with their bundled core-js) is 918 KB — 22% of the
    // entire precache — and it serves ONE button, on /receipt/[id], which is
    // the public page a CUSTOMER opens from a receipt QR. The till never loads
    // it, and it cannot work offline anyway because the page fetches the
    // receipt from the API. Precaching it meant every shop downloaded most of
    // a megabyte, on every deploy, for a page they never open.
    //
    // Excluded from the PRECACHE only: it is still served (and then runtime
    // cached) by the default `next-static-js-assets` rule when someone
    // actually presses Download. The chunk is named by the splitChunks group
    // in `nextConfig.webpack` below, because content-hashed chunk names cannot
    // be matched by a stable pattern.

    exclude: [
      /\/_next\/static\/.*(?<!\.p)\.woff2/,
      /\.map$/,
      /^manifest.*\.js$/,
      /pdf-export/,
      /charts/,
    ],
    runtimeCaching: [
      // CRITICAL: Exclude /api/health from the service worker 'apis' cache.
      // The connectivity heartbeat probes this endpoint to detect real
      // internet connectivity. If the SW serves a cached 200 response, the
      // app always thinks it's online (offline banners never show, sync never
      // triggers on reconnect). Health checks MUST always hit the real network.
      {
        urlPattern: ({ url }: { url: URL }) => url.pathname === "/api/health",
        handler: "NetworkOnly" as const,
        method: "GET",
      },
      // CRITICAL: never cache the credential reads.
      //
      // Login is hand-rolled: the browser SELECTs the row and compares the
      // password itself (AuthContext.login). So the response body to
      // `/rest/v1/stores?select=*&username=eq.X` CONTAINS `password_hash`, and
      // `password_hash` is not a hash — it is the password.
      //
      // Without this rule the default `cross-origin` runtime handler stores
      // that response in Cache Storage, ON DISK, where:
      //
      //   * it survives logout — `clearUserFromStorage()` clears localStorage
      //     and NOTHING in this codebase has ever called `caches.delete()`;
      //   * it survives a browser restart;
      //   * any script on the origin, or anyone holding the till, can read it.
      //
      // Found on the live deployment 2026-09-01: two entries for `stores`,
      // both carrying the store owner's plaintext password. On a shared till
      // that means signing out does not sign you out of anything that matters.
      //
      // NetworkOnly, not NetworkFirst: a stale cached credential is never
      // preferable to a failed request. **This does not affect offline login.**
      // That path is `loginOffline()` -> `validateCachedCredentials()` in
      // src/lib/auth/offlineAuth.ts, which reads localStorage and never touches
      // the network — and which deliberately survives logout so a cashier who
      // signs off during an outage can get back in.
      //
      // Scoped to the two credential-bearing tables. `products` and everything
      // else keeps its cross-origin caching.
      {
        urlPattern: ({ url }: { url: URL }) =>
          /(^|\.)supabase\.co$/.test(url.hostname) &&
          /^\/rest\/v1\/(stores|store_users|admin_users)\b/.test(url.pathname),
        handler: "NetworkOnly" as const,
      },
      // CRITICAL: the app shell must survive an outage of ANY length.
      //
      // HTML is deliberately not precached (see above), so a runtime cache is
      // the only cached document. The default `pages` rule that used to serve
      // that role carries `maxAgeSeconds: 86400` from next-pwa's defaults, and
      // Workbox's ExpirationPlugin returns null for — and deletes — an entry
      // past its age. So the POS opened fine on day 1 of an outage and failed
      // on day 2, which is exactly the scenario this app exists for.
      //
      // This rule has NO maxAgeSeconds. A cached shell is kept until it is
      // evicted for space or pushed out by maxEntries. Staleness is not a risk:
      // NetworkFirst always prefers the network, so a stale shell is only ever
      // served when there is no network — which is precisely when we want it.
      //
      // Two deliberate choices:
      //
      //  * A NEW cacheName ("app-shell"), not "pages". extendDefaultRuntimeCaching
      //    appends a default only when its cacheName is not already taken, so
      //    claiming "pages" would DELETE the default rule. Using a new name
      //    leaves it in place beneath this one, so this can only add coverage.
      //
      //  * request.mode === "navigate" keeps this rule NARROWER than the
      //    default `pages` rule. Custom rules are registered FIRST, so a broad
      //    pattern here would shadow the asset rules (next-static-js-assets,
      //    static-image-assets, …) that are registered after it.
      //
      // networkTimeoutSeconds is the other half of the offline promise. Without
      // it, NetworkFirst waits for the browser's own timeout (30-90s) before
      // consulting the cache — and this app's signature failure is wifi that is
      // associated with no upstream, where the fetch hangs rather than failing.
      //
      // It is ALSO a tax on every healthy launch, which is why it is 2s and not
      // 3s. An installed iOS PWA is a cold WebView on a cold connection every
      // single time it is opened, so it pays this wait on every launch while a
      // perfectly good shell sits in the cache. Lowering it costs nothing in
      // freshness: Workbox races the timeout against the network but does not
      // abandon the request, so the fresh document still lands in the cache for
      // the next launch. All that changes is that a slow link opens the till
      // from cache a second sooner.
      {
        urlPattern: ({
          request,
          sameOrigin,
        }: {
          request: Request;
          sameOrigin: boolean;
        }) => sameOrigin && request.mode === "navigate",
        handler: "NetworkFirst" as const,
        method: "GET",
        options: {
          cacheName: "app-shell",
          networkTimeoutSeconds: 2,
          // maxEntries only. Adding maxAgeSeconds here would reintroduce the
          // exact bug this rule exists to fix — scripts/verify-sw.mjs asserts
          // its absence in the generated worker.
          expiration: { maxEntries: 64 },
        },
      },
    ],
  },
});

const nextConfig: NextConfig = {
  experimental: {
    serverMinification: true,
  },
  // Give the PDF exporter's libraries one predictable chunk name.
  //
  // html2pdf.js pulls in jsPDF, html2canvas, canvg and their bundled core-js —
  // 918 KB across two chunks, and by far the largest thing in the build. It is
  // reached from exactly one place: the Download button on /receipt/[id], the
  // public page a customer opens from a receipt QR. It is already behind a
  // dynamic import, so it never enters the till's bundle — but the service
  // worker was PRECACHING it, so every shop downloaded it on every deploy.
  //
  // Webpack names split chunks by content hash, which cannot be matched by a
  // stable pattern in workboxOptions.exclude. Naming the group fixes that. The
  // group is `chunks: "async"` so it can only ever collect dynamically imported
  // code — it cannot pull anything into the initial bundle.
  webpack: (config, { isServer }) => {
    if (!isServer && typeof config.optimization?.splitChunks === "object") {
      const groups = (config.optimization.splitChunks.cacheGroups ??= {});
      groups.pdfExport = {
        test: /[\\/]node_modules[\\/](html2pdf\.js|jspdf|html2canvas|canvg|dompurify)[\\/]/,
        name: "pdf-export",
        chunks: "async",
        // Above Next's own `lib`/`commons` groups, which would otherwise claim
        // these first and give them a hashed name again.
        priority: 50,
        reuseExistingChunk: true,
        enforce: true,
      };
      // Same treatment for the charting stack, for the same reason and with one
      // extra one.
      //
      // recharts + victory-vendor + d3 is 345 KB precached, and EVERY screen
      // that renders a chart gets its data from the network: the cash page's
      // register performance comes from `get_register_performance`, and the
      // analytics panel from /api/transactions/analytics. So offline there is
      // nothing to plot, and precaching the plotting library buys a shop
      // exactly nothing — it just costs 345 KB on every device on every deploy.
      // Runtime caching picks it up on first use, which is necessarily online.
      //
      // This is NOT the same call as ZXing (560 KB, also precached, also behind
      // next/dynamic). Mobile is camera-first and scanning offline is core, so
      // that one stays precached deliberately.
      //
      // The package list is exactly what recharts 3 pulls in — nothing in src/
      // imports redux, immer, d3-*, victory-vendor, es-toolkit or
      // decimal.js-light directly. `clsx` and `use-sync-external-store` are
      // recharts dependencies too and are deliberately NOT here: they are
      // shared with the app. `chunks: "async"` is the backstop either way —
      // it can only collect dynamically imported code.
      groups.charts = {
        test: /[\\/]node_modules[\\/](recharts|victory-vendor|d3-[a-z-]+|decimal\.js-light|@reduxjs[\\/]toolkit|react-redux|reselect|immer|es-toolkit)[\\/]/,
        name: "charts",
        chunks: "async",
        priority: 50,
        reuseExistingChunk: true,
        enforce: true,
      };
    }
    return config;
  },
  // Ensure the service worker is never cached by the browser/CDN so that
  // update checks always fetch the latest version. This is critical for
  // PWA auto-updates — without it, users may be stuck on an old SW.
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=0, must-revalidate",
          },
        ],
      },
      {
        source: "/workbox-:hash.js",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=0, must-revalidate",
          },
        ],
      },
    ];
  },
  // Note: Turbopack is currently incompatible with many PWA plugins.
  // If you see errors during 'next dev', you may need to disable turbopack.
  // turbopack: {}, 
};

export default withAnalyzer(withPWA(nextConfig));