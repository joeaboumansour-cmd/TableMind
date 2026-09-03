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

// =============================================
// Second pass: everything ELSE Chrome 109 cannot do.
//
// The colour check above was written for the bug that was actually reported —
// black-and-white tills — but colour is not the only way Tailwind or shadcn can
// hand Windows 7 something it will silently drop. A minor Tailwind release that
// starts emitting `text-wrap: balance` or native nesting would sail through the
// colour check and quietly break layout on every Windows 7 shop.
//
// Only features NEWER than Chrome 109 are listed. Things the tills DO support
// are deliberately absent so they never produce noise: :has() and @container
// (105), dvh units (108), @property (85), backdrop-filter (76), aspect-ratio
// (88), :is()/:where() (88), 8-digit hex (62), gap in flexbox (84).
//
// Same two exemptions as the colour pass: inside @supports, or preceded by a
// fallback declaration of the same property.
// =============================================

// Split by CONSEQUENCE, not by version.
//
// A feature Chrome 109 ignores harmlessly is not a reason to block a deploy —
// unsupported `text-wrap: balance` still wraps text, it just does not balance
// it. Failing the build on those trains everyone to skim past the gate, which
// is how a real one gets ignored. Those are reported as notes instead.
//
// BREAKING means the declaration or block is dropped and something the layout
// or the colour actually depends on goes with it.

/** Declaration values that BREAK when Chrome 109 drops them. */
const VALUE_HAZARDS = [
  [/(^|[^-\w])(rgb|rgba|hsl|hsla|hwb|oklch|oklab|lab|lch|color)\(\s*from[\s(]/, "relative colour syntax (Chrome 119)"],
  [/(^|[^-\w])light-dark\s*\(/, "light-dark() (Chrome 123)"],
  [/(^|[^-\w])(calc-size|anchor|anchor-size)\s*\(/, "anchor positioning (Chrome 125)"],
  [/(^|\s)subgrid(\s|$)/, "subgrid (Chrome 117)"],
];

/** Values Chrome 109 ignores WITHOUT breaking anything. Reported, not fatal. */
const VALUE_NOTES = [
  [/(^|\s)allow-discrete(\s|$)/, "transition-behavior: allow-discrete (Chrome 117)"],
];

/** Properties whose absence BREAKS layout or positioning. */
const PROPERTY_HAZARDS = [
  [/^(anchor-name|position-anchor|position-area|position-try.*)$/, "anchor positioning (Chrome 125)"],
];

/** Properties Chrome 109 simply ignores. Reported, not fatal. */
const PROPERTY_NOTES = [
  [/^text-wrap(-mode|-style)?$/, "text-wrap (Chrome 114)"],
  [/^field-sizing$/, "field-sizing (Chrome 123)"],
  [/^transition-behavior$/, "transition-behavior (Chrome 117)"],
  [/^(animation-timeline|scroll-timeline|timeline-scope|view-timeline.*)$/, "scroll-driven animations (Chrome 115)"],
  [/^view-transition-name$/, "view transitions (Chrome 111)"],
  [/^overlay$/, "overlay (Chrome 117)"],
  [/^interpolate-size$/, "interpolate-size (Chrome 129)"],
  [/^(text-box|text-box-trim|text-box-edge)$/, "text-box (Chrome 133)"],
];

/** At-rules whose whole BLOCK is dropped, taking real styles with it. */
const ATRULE_HAZARDS = [
  [/^scope$/, "@scope (Chrome 118)"],
  [/^position-try$/, "@position-try (Chrome 125)"],
];

/** At-rules that only carry enhancements. Reported, not fatal. */
const ATRULE_NOTES = [
  [/^starting-style$/, "@starting-style (Chrome 117)"],
  [/^view-transition$/, "@view-transition (Chrome 125)"],
];

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
const notes = [];
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
      why: "modern colour function",
    });
  });

  // ---- Second pass: non-colour features ----
  const inSupports = (node) => {
    for (let p = node.parent; p; p = p.parent) {
      if (p.type === "atrule" && p.name === "supports") return true;
    }
    return false;
  };

  root.walkDecls((decl) => {
    const note =
      PROPERTY_NOTES.find(([re]) => re.test(decl.prop)) ||
      VALUE_NOTES.find(([re]) => re.test(decl.value));
    if (note && !inSupports(decl)) {
      notes.push({ what: decl.prop, why: note[1] });
      return;
    }
    const hazard =
      PROPERTY_HAZARDS.find(([re]) => re.test(decl.prop)) ||
      VALUE_HAZARDS.find(([re]) => re.test(decl.value));
    if (!hazard) return;
    checked++;
    if (inSupports(decl)) return;

    // Same fallback rule as the colour pass: an earlier declaration of the same
    // property that Chrome 109 CAN use makes this a progressive enhancement
    // rather than a break.
    const siblings = decl.parent && decl.parent.nodes ? decl.parent.nodes : [];
    for (const node of siblings) {
      if (node === decl) break;
      if (node.type === "decl" && node.prop === decl.prop) return;
    }

    const sel =
      decl.parent && decl.parent.selector ? decl.parent.selector : "(unknown rule)";
    violations.push({
      file,
      selector: sel.length > 70 ? sel.slice(0, 70) + "..." : sel,
      prop: decl.prop,
      value: decl.value.length > 90 ? decl.value.slice(0, 90) + "..." : decl.value,
      why: hazard[1],
    });
  });

  root.walkAtRules((rule) => {
    const note = ATRULE_NOTES.find(([re]) => re.test(rule.name));
    if (note && !inSupports(rule)) {
      notes.push({ what: "@" + rule.name, why: note[1] });
      return;
    }
    const hazard = ATRULE_HAZARDS.find(([re]) => re.test(rule.name));
    if (!hazard) return;
    checked++;
    if (inSupports(rule)) return;
    violations.push({
      file,
      selector: "@" + rule.name + " " + (rule.params || ""),
      prop: "(at-rule)",
      value: "",
      why: hazard[1],
    });
  });

  // Native CSS nesting is Chrome 112. Tailwind ESCAPES `&` when it appears
  // inside a class name, so only an UNescaped leading `&` is real nesting.
  // Lightning CSS flattens it for the legacy target; this asserts that it did.
  root.walkRules((rule) => {
    if (!rule.selectors.some((sel) => /^\s*&/.test(sel))) return;
    checked++;
    if (inSupports(rule)) return;
    violations.push({
      file,
      selector: rule.selector.slice(0, 70),
      prop: "(nested rule)",
      value: "",
      why: "native CSS nesting (Chrome 112)",
    });
  });
}

console.log(
  "[verify-legacy-css] scanned " + files.length + " stylesheet(s), " +
  checked + " declaration(s)/rule(s) newer than Chrome 109"
);

if (notes.length > 0) {
  const seen = new Map();
  for (const n of notes) seen.set(n.why, (seen.get(n.why) || 0) + 1);
  console.log(
    "[verify-legacy-css] note: " + notes.length +
    " declaration(s) Chrome 109 ignores harmlessly (not a failure)"
  );
  for (const [why, count] of seen) console.log("    " + count + "x " + why);
}

if (violations.length > 0) {
  console.error(
    "\n[verify-legacy-css] FAIL: " + violations.length +
    " thing(s) Chrome 109 cannot parse, with no fallback:\n"
  );
  for (const v of violations.slice(0, 25)) {
    console.error("  " + v.selector);
    console.error("    " + v.prop + (v.value ? ": " + v.value : ""));
    console.error("    ^ " + v.why + "\n");
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
