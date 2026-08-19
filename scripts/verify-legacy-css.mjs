#!/usr/bin/env node
// =============================================
// Legacy build CSS verification
//
// Runs only for `npm run build:legacy`, the build that serves Windows 7 tills.
//
// Chrome 109 is the newest Chrome that exists for Windows 7, and it does not
// understand oklch()/oklab()/lab()/lch() or color-mix(). Those are not a
// graceful degradation: an unregistered custom property STORES the value fine,
// but substituting it into `color:` makes the declaration invalid at
// computed-value time, so it resolves to `unset` — inherited black text,
// transparent backgrounds, no borders. That is the "black and white on Windows
// 7" bug this whole build variant exists to fix.
//
// Like public/sw.js, the stylesheet is generated and gitignored, so it never
// appears in a diff and there is no test suite to catch a regression. A Tailwind
// or shadcn upgrade reintroducing a bare oklch() would silently break every
// Windows 7 client again. This asserts it cannot.
//
// A modern colour function is acceptable in exactly two shapes:
//   1. inside an @supports block, or
//   2. immediately preceded by a fallback declaration of the same property in
//      the same rule (old Chrome keeps the first and drops the second).
// =============================================

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import postcss from "postcss";

const CSS_DIR = resolve(process.cwd(), ".next/static/css");
const MODERN = /(^|[^-\w])(oklch|oklab|lab|lch|color-mix)\s*\(/;

if (!existsSync(CSS_DIR)) {
  console.error("\n[verify-legacy-css] FAIL: .next/static/css does not exist.");
  console.error("    Run `npm run build:legacy` first — the stylesheet is generated at build time.\n");
  process.exit(1);
}

const files = readdirSync(CSS_DIR).filter((f) => f.endsWith(".css"));
if (files.length === 0) {
  console.error("\n[verify-legacy-css] FAIL: no stylesheet found in .next/static/css.\n");
  process.exit(1);
}

const violations = [];
let checked = 0;

for (const file of files) {
  const css = readFileSync(join(CSS_DIR, file), "utf8");
  const root = postcss.parse(css, { from: file });

  root.walkDecls((decl) => {
    if (!MODERN.test(decl.value)) return;
    checked++;

    // Guard 1: any @supports ancestor.
    for (let p = decl.parent; p; p = p.parent) {
      if (p.type === "atrule" && p.name === "supports") return;
    }

    // Guard 2: an earlier declaration of the same property in the same rule,
    // whose value old Chrome CAN parse.
    const siblings = decl.parent && decl.parent.nodes ? decl.parent.nodes : [];
    for (const node of siblings) {
      if (node === decl) break;
      if (node.type === "decl" && node.prop === decl.prop && !MODERN.test(node.value)) return;
    }

    const value = decl.value.length > 90 ? decl.value.slice(0, 90) + "..." : decl.value;
    const selector =
      decl.parent && decl.parent.selector ? decl.parent.selector : "(unknown rule)";
    violations.push({
      file,
      selector: selector.length > 70 ? selector.slice(0, 70) + "..." : selector,
      prop: decl.prop,
      value,
    });
  });
}

console.log(
  "[verify-legacy-css] scanned " + files.length + " stylesheet(s), " +
  checked + " modern-colour declaration(s)"
);

if (violations.length > 0) {
  console.error(
    "\n[verify-legacy-css] FAIL: " + violations.length +
    " declaration(s) Chrome 109 cannot parse, with no fallback:\n"
  );
  for (const v of violations.slice(0, 25)) {
    console.error("  " + v.selector);
    console.error("    " + v.prop + ": " + v.value + "\n");
  }
  if (violations.length > 25) {
    console.error("  ...and " + (violations.length - 25) + " more.\n");
  }
  console.error("Each needs EITHER an @supports guard OR a preceding sRGB fallback");
  console.error("declaration of the same property. For our own design tokens that is");
  console.error("done by hand in src/app/globals.css; for Tailwind's built-in palette");
  console.error("it is done by scripts/postcss-legacy-downlevel.cjs.");
  console.error("\nDo not ship this build — Windows 7 clients will render black and white.\n");
  process.exit(1);
}

console.log("[verify-legacy-css] Stylesheet is Chrome 109 safe.");
