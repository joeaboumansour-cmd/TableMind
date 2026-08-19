// =============================================
// Sub-baseline upgrade page
//
// Served by src/middleware.ts on the LEGACY deployment when the browser is
// older than MIN_LEGACY_CHROME. Deliberately server-rendered rather than done
// in client JS: a browser this old may not be able to parse the app bundle at
// all, and rewriting the DOM out from under React risks a blank screen instead
// of a message. Plain HTML with inline styles always renders.
// =============================================

import { MIN_LEGACY_CHROME } from "./browserSupport";

export function upgradePageHtml(detected: number): string {
  const version = detected > 0 ? "Chrome " + detected : "an unrecognised browser";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Please update your browser — Golden Squirrel POS</title>
</head>
<body style="margin:0;background:#09090b;color:#fafafa;font:16px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <div style="max-width:34rem;margin:0 auto;padding:3rem 1.5rem">
    <div style="color:#d9a514;font-size:0.8rem;letter-spacing:.14em;text-transform:uppercase;margin-bottom:1rem">Golden Squirrel POS</div>
    <h1 style="font-size:1.6rem;line-height:1.3;margin:0 0 1rem">Please update Chrome to continue</h1>
    <p style="margin:0 0 1rem;color:#9f9fa9">
      This till is running ${version}. The point of sale needs
      <strong style="color:#fafafa">Chrome ${MIN_LEGACY_CHROME} or newer</strong> to display correctly and take payments safely.
    </p>
    <p style="margin:0 0 1.5rem;color:#9f9fa9">
      Chrome ${MIN_LEGACY_CHROME} is free and still installs on Windows 7 — it is the last
      version Google released for it. Updating takes a few minutes and no data
      on this machine is affected.
    </p>
    <div style="background:#18181b;border:1px solid #27272a;border-radius:10px;padding:1.25rem;margin-bottom:1.5rem">
      <div style="font-weight:600;margin-bottom:.5rem">How to update</div>
      <ol style="margin:0;padding-left:1.2rem;color:#9f9fa9">
        <li>Open Chrome and go to the menu (three dots) &rarr; Help &rarr; About Google Chrome.</li>
        <li>Let it install any update it finds, then restart Chrome.</li>
        <li>If nothing happens, download Chrome again from
          <a href="https://www.google.com/chrome/" style="color:#d9a514">google.com/chrome</a>
          and reinstall it.</li>
      </ol>
    </div>
    <p style="margin:0;color:#71717b;font-size:.875rem">
      Sales already saved on this machine are safe. If you need to keep trading
      right now, use another till and call support.
    </p>
  </div>
</body>
</html>`;
}
