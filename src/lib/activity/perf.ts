/**
 * Field performance measurement.
 *
 * Step 0.2 of docs/PERF-REFACTOR-PLAN.md. Four timings, emitted from real
 * devices in real shops on real Lebanese connections — the only measurement
 * that reflects what a cashier actually experiences, and the only one that
 * keeps working after the refactor's harness is gone.
 *
 *   perf.boot   navigation start  → POS interactive
 *   perf.scan   barcode resolved  → line in cart
 *   perf.sale   payment confirmed → receipt painted
 *   perf.route  route change      → paint
 *
 * FOUR RULES, all load-bearing:
 *
 * 1. **Every duration ends at a PAINT, not at a callback.** The right-hand
 *    side of all four above is something a person sees. Stopping the clock
 *    when React's commit returns would report a number that is reliably a
 *    frame or more optimistic, which is precisely the gap Phase 5 exists to
 *    attack — so measuring it away would hide the work.
 *
 * 2. **The measurement is never part of what it measures.** The emit happens
 *    inside the post-paint callback, after the frame the user was waiting for.
 *    `logActivity` is a synchronous in-memory push and cannot throw, but
 *    "cheap" is not "free" and the money path does not pay for its own
 *    instrumentation.
 *
 * 3. **Platform and display-mode ride on every event.** A 4-second boot is
 *    alarming on warm desktop Chrome and unremarkable on a cold iOS WebView,
 *    which is killed and relaunched from scratch every time. Aggregated
 *    together they produce a number describing nobody. Display mode matters
 *    twice over: on iOS, being *installed* is what exempts the origin from the
 *    7-day storage clear, so it is a durability signal as well as a speed one.
 *
 * 4. **Durations use `performance.now()`, never `Date.now()`.** It is
 *    monotonic. A wall-clock jump — NTP correction, someone fixing a till
 *    whose clock is wrong — would otherwise yield negative or absurd
 *    durations, and these tills routinely have wrong clocks.
 *
 * Emission is behind the `activity_logging` feature flag for free, because
 * `logActivity()` no-ops when logging is off for the store.
 */

import { isAndroid, isIOS } from "@/lib/device";
import { logActivity } from "./logger";

export type PerfPlatform = "ios" | "android" | "desktop";
export type PerfDisplayMode = "standalone" | "browser";

type PerfAction = "perf.boot" | "perf.scan" | "perf.sale" | "perf.route";

/** Monotonic clock reading. Capture this at the START of anything timed. */
export function perfNow(): number {
  return typeof performance !== "undefined" ? performance.now() : 0;
}

/**
 * Which of the three first-class platforms this is (invariant #24).
 *
 * iOS is checked before Android because `isIOS()` also catches iPadOS, which
 * reports a desktop-Mac user agent and would otherwise fall through to
 * "desktop" and quietly corrupt the iOS percentiles.
 */
export function perfPlatform(): PerfPlatform {
  if (isIOS()) return "ios";
  if (isAndroid()) return "android";
  return "desktop";
}

/**
 * Installed PWA, or a browser tab.
 *
 * `display-mode: standalone` is the reliable cross-platform signal.
 * `navigator.standalone` is the iOS-only legacy one and is still needed —
 * older iOS reports it when the media query does not.
 */
export function perfDisplayMode(): PerfDisplayMode {
  if (typeof window === "undefined") return "browser";
  try {
    if (window.matchMedia?.("(display-mode: standalone)")?.matches) return "standalone";
    // iOS legacy flag, absent from the Navigator type.
    if ((window.navigator as Navigator & { standalone?: boolean }).standalone) {
      return "standalone";
    }
  } catch {
    // matchMedia can throw in exotic embeddings. "browser" is the safe default:
    // it under-claims durability rather than over-claiming it.
  }
  return "browser";
}

/**
 * Run `cb` after the browser has painted the next frame.
 *
 * Two rAFs, not one: the first fires *before* the upcoming paint, the second
 * after it. That is what makes "→ receipt painted" honest rather than
 * "→ React finished rendering".
 *
 * Falls back to a timeout when rAF is unavailable or the tab is hidden — a
 * hidden tab never paints, so rAF would never fire and the measurement would
 * be silently dropped rather than merely approximate.
 */
function afterPaint(cb: (painted: boolean) => void): void {
  if (typeof window === "undefined") return;
  if (typeof requestAnimationFrame !== "function" || document.hidden) {
    setTimeout(() => cb(false), 0);
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => cb(true)));
}

/** Milliseconds, rounded — sub-millisecond precision is noise at this scale. */
function toMs(value: number): number {
  return Math.max(0, Math.round(value));
}

/**
 * Stop the clock at the next paint and record it.
 *
 * `painted: false` is carried through rather than dropped: it means the tab
 * was hidden and the number is a lower bound, which a percentile over
 * background tabs would otherwise flatter.
 */
function emitFrom(action: PerfAction, startedAt: number, extra?: Record<string, unknown>): void {
  afterPaint((painted) => {
    try {
      logActivity(action, {
        details: {
          platform: perfPlatform(),
          display: perfDisplayMode(),
          ...extra,
          ms: toMs(perfNow() - startedAt),
          ...(painted ? {} : { painted: false }),
        },
      });
    } catch {
      // Deliberately silent. A measurement must never be visible to a cashier.
    }
  });
}

// ---- perf.boot --------------------------------------------------------------

let bootLogged = false;

/**
 * Navigation start → POS interactive. Call once, when the till is usable.
 *
 * "Usable" means the catalogue is in hand and a scan would resolve — not when
 * the component mounted. Measuring the mount would report a number no cashier
 * ever experiences.
 *
 * Guarded to fire once per JS context: reaching /pos again by client-side
 * navigation is a route change, not a boot, and counting it as one would drag
 * the boot percentiles down with numbers that never involved a launch.
 */
export function logPerfBoot(extra?: Record<string, unknown>): void {
  if (bootLogged || typeof window === "undefined") return;
  bootLogged = true;

  try {
    const nav = performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined;

    // A bfcache restore ("back_forward") reuses a live page: no parse, no
    // hydration, no catalogue read. Counting it as a cold start would make
    // boots look far faster than any real launch.
    const navType = nav?.type ?? "navigate";

    // Measured from the time origin, which for the initial document IS
    // navigation start — so this covers the whole boot, not just React.
    emitFrom("perf.boot", 0, {
      wasColdStart: navType !== "back_forward",
      navType,
      ...extra,
    });
  } catch {
    // Silent.
  }
}

/** Test seam: lets a fresh boot be measured after a simulated relaunch. */
export function resetPerfBootForTesting(): void {
  bootLogged = false;
}

// ---- perf.scan --------------------------------------------------------------

/**
 * Which path the last barcode lookup took.
 *
 * Reported by whoever resolves the code, because only that layer knows. The
 * alternative — widening `resolveBarcode`'s return type — would push a
 * measurement concern through a contract shared by both tills for no
 * behavioural reason.
 *
 * Inferring it from elapsed time was the other option and is rejected on
 * purpose: "it was fast so it must have been local" stops being true on
 * exactly the slow devices this exists to find.
 */
let lastScanSource: "local" | "server" | null = null;

/** Call from the barcode resolver, on whichever branch actually answered. */
export function markScanSource(source: "local" | "server"): void {
  lastScanSource = source;
}

/**
 * Barcode resolved → line visible in the cart.
 *
 * Separates a local barcode-index hit (should be ~instant) from the server
 * fallback on a miss (a round trip). Averaged together they describe neither,
 * and Phase 5 plans to change only the second.
 */
export function logPerfScan(startedAt: number, extra?: Record<string, unknown>): void {
  const source = lastScanSource ?? "unknown";
  lastScanSource = null;
  emitFrom("perf.scan", startedAt, { source, ...extra });
}

// ---- perf.sale --------------------------------------------------------------

/**
 * Payment confirmed → receipt painted.
 *
 * The most important number in the product: queue time with a customer
 * standing in it. Note it deliberately ends at the RECEIPT, not at the server
 * acknowledging the sale — the sale is durable in IndexedDB before the receipt
 * paints and the server push is fire-and-forget behind it, so waiting for the
 * server would measure something no cashier waits for.
 */
export function logPerfSale(startedAt: number, extra?: Record<string, unknown>): void {
  emitFrom("perf.sale", startedAt, extra);
}

// ---- perf.route -------------------------------------------------------------

/**
 * Set by whoever initiates a client-side navigation, so the clock starts at
 * the tap rather than at the commit. Without it the most interesting part of a
 * route change — everything before React renders the new screen — is invisible.
 */
let pendingNav: { at: number; to: string } | null = null;

/** Call immediately before `router.push()`. */
export function markRouteNavStart(to: string): void {
  pendingNav = { at: perfNow(), to };
}

/**
 * Call when the new route has committed; the clock stops at its paint.
 *
 * `measuredFrom` is carried on every event and matters when reading the data:
 *
 *   "nav_start" — the full journey from the tap. What a person experienced.
 *   "commit"    — render → paint only, because nothing marked the start
 *                 (browser back/forward, or a link that does not call
 *                 markRouteNavStart). A real number, but of a shorter span.
 *
 * Mixing the two silently would understate route timings, so they are labelled
 * rather than blended — and never fabricated, per the plan's rule that
 * perceived performance is a sequencing technique, not a persuasion one.
 */
export function logPerfRouteArrival(to: string, from?: string): void {
  const marker = pendingNav;
  pendingNav = null;

  const matched = marker?.to === to;
  emitFrom("perf.route", matched ? marker!.at : perfNow(), {
    to,
    from,
    measuredFrom: matched ? "nav_start" : "commit",
  });
}
