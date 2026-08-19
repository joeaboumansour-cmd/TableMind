// =============================================
// Browser baseline
//
// Windows 7 tills are the reason this file exists. Chrome 109 (Jan 2023) is the
// LAST Chrome Google ever shipped for Windows 7 / 8.1, and Edge 109 is the last
// Edge. There is no route around that ceiling: Electron 22 (Chromium 108) was
// the last Electron with Windows 7 support, and WebView2 dropped it in the same
// era. So 109 is not a compromise, it is the maximum engine those machines can
// ever run — which makes it the baseline for the legacy build.
//
// Chrome 109 runs this app's JavaScript fine. What it cannot do is parse
// oklch() / color-mix(), which is why the legacy build exists at all. See
// scripts/verify-legacy-css.mjs and src/app/globals.css.
// =============================================

/** Newest Chrome/Edge that exists for Windows 7. The legacy build's floor. */
export const MIN_LEGACY_CHROME = 109;

/**
 * First Chrome that understands oklch()/color-mix(), i.e. the floor for the
 * MODERN build. Anything below this renders the modern build black and white.
 */
export const MIN_MODERN_CHROME = 111;

/** True when this bundle was produced by `npm run build:legacy`. */
export const IS_LEGACY_BUILD = process.env.NEXT_PUBLIC_BUILD_VARIANT === "legacy";

/** Origin of the legacy deployment, or "" when not configured. */
export const LEGACY_URL = process.env.NEXT_PUBLIC_LEGACY_URL || "";

/** Query flag that bypasses every redirect and block, for debugging. */
export const BYPASS_FLAG = "nolegacy";

/**
 * Chromium major version from a user-agent string, or 0 when it is not
 * Chromium at all. Edge and Opera both carry a `Chrome/<n>` token, so this
 * reports the underlying engine rather than the brand — which is what the
 * CSS support question actually depends on.
 */
export function chromiumMajor(userAgent: string): number {
  const m = /(?:Chrome|CriOS|Chromium)\/(\d+)/.exec(userAgent);
  return m ? parseInt(m[1], 10) : 0;
}
