// =============================================
// Legacy build: CSS downlevel pass
//
// Only loaded when NEXT_PUBLIC_BUILD_VARIANT=legacy (see postcss.config.mjs).
//
// Opacity-modifier fallbacks live in scripts/postcss-opacity-fallback.cjs and
// run in BOTH builds -- see the note at the top of that file.
//
// src/app/globals.css already hand-writes sRGB fallbacks for OUR design tokens,
// because Lightning CSS cannot downlevel a colour that lives inside an
// unregistered custom property — `--primary: oklch(...)` is just an opaque token
// stream to it.
//
// This pass exists for the colours we do NOT control: Tailwind's own built-in
// palette. `bg-amber-500` and friends come out of `@import "tailwindcss"` as
// oklch(), and the codebase uses those utilities in ~40 places. Lightning CSS
// rewrites them to rgb() for Chrome 109.
//
// It runs at OnceExit, i.e. after Tailwind has expanded @theme/@apply, so what
// it sees is plain compiled CSS. It runs INSIDE PostCSS rather than as a
// postbuild rewrite of .next/static/css/*.css on purpose: content hashes and the
// next-pwa precache manifest are computed downstream of this point, so rewriting
// here keeps them consistent. Rewriting the emitted file would desynchronise the
// Workbox revisions and break offline loading.
//
// Guarded by scripts/verify-legacy-css.mjs, which fails the build if anything
// Chrome 109 cannot parse survives.
// =============================================

const { transform, browserslistToTargets } = require("lightningcss");
const browserslist = require("browserslist");

// Matches the BROWSERSLIST env the legacy build script sets. Edge 109 is the
// last Edge for Windows 7 as well. Kept explicit
// rather than read from env so this file is meaningful on its own.

const TARGETS = browserslistToTargets(browserslist("chrome 109, edge 109"));

module.exports = () => ({
  postcssPlugin: "legacy-downlevel",
  OnceExit(root, { result, postcss }) {
    const from = (result.opts && result.opts.from) || "globals.css";

    const { code, warnings } = transform({
      filename: from,
      code: Buffer.from(root.toString()),
      targets: TARGETS,
      minify: false,
      // Tailwind emits some at-rules Lightning CSS does not model; recover
      // rather than fail the whole build over a rule it can pass through.
      errorRecovery: true,
    });

    if (warnings && warnings.length) {
      for (const w of warnings.slice(0, 10)) {
        console.warn("[legacy-downlevel] " + w.type + ": " + w.message);
      }
    }

    const parsed = postcss.parse(code.toString("utf8"), { from });
    root.removeAll();
    root.append(parsed.nodes);
  },
});

module.exports.postcss = true;
