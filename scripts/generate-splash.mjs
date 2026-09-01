// =============================================
// iOS launch screens (`apple-touch-startup-image`)
// =============================================
// An installed iOS PWA shows a BLANK WHITE SCREEN for its entire cold boot
// unless a startup image is supplied for the exact device resolution. iOS
// launches a cold WebView every time, so that blank screen is most of what
// "the app takes a long time to open" means on an iPhone.
//
// The images are a solid `#09090b` — the exact hex of `--background`, the same
// value as `themeColor` in the layout — with the launcher icon centred, so the
// launch reads as the app starting rather than as a page loading.
//
// ## Two things that are easy to get wrong
//
// **They must NOT be precached.** iOS displays the startup image BEFORE the web
// app runs, so the service worker is not alive to serve it — iOS keeps its own
// copy from when the app was added to the home screen. Precaching them would
// add megabytes to every install, on every deploy, for files the service worker
// can never answer. `/splash/` is in `workboxOptions.exclude` for exactly this,
// alongside `/pdf-export/`.
//
// **The size must match the device EXACTLY.** iOS matches on device-width,
// device-height and pixel ratio; anything else is ignored and you are back to
// white. That is why this is a generated list rather than a few hand-made
// files.
//
// Portrait only, deliberately: the till on a phone is camera-first and held
// upright, and a device launched in landscape simply falls back to today's
// behaviour rather than showing something wrong.
//
// Run: node scripts/generate-splash.mjs
// =============================================

import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const OUT_DIR = join(root, "public", "splash");
const SOURCE_ICON = join(root, "public", "icons", "launchericon-512x512.png");

/** The exact hex of `--background` in globals.css, and of `themeColor`. */
const BACKGROUND = { r: 0x09, g: 0x09, b: 0x0b, alpha: 1 };

/**
 * Every device this app is plausibly installed on.
 *
 * `w`/`h` are CSS pixels and `dpr` the pixel ratio — together they form the
 * media query. The PNG itself is w*dpr by h*dpr.
 */
const DEVICES = [
  { name: "iphone-se", w: 375, h: 667, dpr: 2 },
  { name: "iphone-8-plus", w: 414, h: 736, dpr: 3 },
  { name: "iphone-x", w: 375, h: 812, dpr: 3 },
  { name: "iphone-xr", w: 414, h: 896, dpr: 2 },
  { name: "iphone-xs-max", w: 414, h: 896, dpr: 3 },
  { name: "iphone-12", w: 390, h: 844, dpr: 3 },
  { name: "iphone-14-pro", w: 393, h: 852, dpr: 3 },
  { name: "iphone-16-pro", w: 402, h: 874, dpr: 3 },
  { name: "iphone-12-pro-max", w: 428, h: 926, dpr: 3 },
  { name: "iphone-14-pro-max", w: 430, h: 932, dpr: 3 },
  { name: "iphone-16-pro-max", w: 440, h: 956, dpr: 3 },
  { name: "ipad", w: 768, h: 1024, dpr: 2 },
  { name: "ipad-air", w: 820, h: 1180, dpr: 2 },
  { name: "ipad-pro-11", w: 834, h: 1194, dpr: 2 },
  { name: "ipad-pro-13", w: 1024, h: 1366, dpr: 2 },
];

/** Icon edge as a fraction of the SHORT side — roughly what a native splash uses. */
const ICON_FRACTION = 0.28;

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  let total = 0;
  const entries = [];

  for (const device of DEVICES) {
    const width = device.w * device.dpr;
    const height = device.h * device.dpr;
    // Even edge: an odd one makes the centring offset fractional, and sharp
    // rounds it, so the icon sits half a pixel off centre.
    const iconEdge = Math.round((Math.min(width, height) * ICON_FRACTION) / 2) * 2;

    const icon = await sharp(SOURCE_ICON)
      .resize(iconEdge, iconEdge, { fit: "contain", background: BACKGROUND })
      .toBuffer();

    const png = await sharp({
      create: { width, height, channels: 4, background: BACKGROUND },
    })
      .composite([
        {
          input: icon,
          top: Math.round((height - iconEdge) / 2),
          left: Math.round((width - iconEdge) / 2),
        },
      ])
      .png({ compressionLevel: 9, palette: true })
      .toBuffer();

    const file = `${device.name}-${width}x${height}.png`;
    await writeFile(join(OUT_DIR, file), png);
    total += png.length;

    entries.push({
      rel: "apple-touch-startup-image",
      url: `/splash/${file}`,
      media: `(device-width: ${device.w}px) and (device-height: ${device.h}px) and (-webkit-device-pixel-ratio: ${device.dpr}) and (orientation: portrait)`,
    });

    console.log(`[splash] ${file.padEnd(34)} ${(png.length / 1024).toFixed(1)} KB`);
  }

  console.log(
    `[splash] ${DEVICES.length} images, ${(total / 1024).toFixed(1)} KB total ` +
      `(NOT precached — see the header of this file)`
  );

  // PRINTED on request, never written into public/: the tags live in
  // `metadata.icons` in src/app/layout.tsx where they are typechecked, and a
  // stray JSON file in public/ would be served to the world for no reason.
  if (process.argv.includes("--tags")) {
    console.log("\n" + JSON.stringify(entries, null, 2));
  }
}

main().catch((error) => {
  console.error("[splash] failed:", error);
  process.exit(1);
});
