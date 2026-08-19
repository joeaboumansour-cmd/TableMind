// =============================================
// Legacy build: CSS downlevel pass
//
// Only loaded when NEXT_PUBLIC_BUILD_VARIANT=legacy (see postcss.config.mjs).
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

// ---------------------------------------------------------------------------
// Opacity-modifier fallbacks
//
// Tailwind emits every `bg-primary/10`-style utility as a PAIR:
//
//   .bg-primary\/10{background-color:var(--primary)}
//   @supports (color:color-mix(...)){.bg-primary\/10{background-color:color-mix(in oklab,var(--primary)10%,transparent)}}
//
// The first line is the old-browser fallback, and it is FULL OPACITY. On
// Chrome 109 a 10% amber wash therefore paints as solid amber — and where the
// design puts `text-primary` on top of `bg-primary/10`, the text becomes
// invisible. That is not the black-and-white bug; it is a second, quieter one
// that only shows up on the legacy build, and no @supports guard catches it
// because a fallback technically exists.
//
// Lightning CSS cannot fix this: it refuses to precompute color-mix() when an
// argument is a var(), and rightly so, since it cannot know the value.
//
// We can, because every design token is statically declared in globals.css.
// The app forces dark mode in three places and CLAUDE.md records that the
// :root light palette is dead, so tokens are resolved against `.dark` first
// and `:root` only as a backstop. Tokens carrying their own alpha (--border is
// rgba(255,255,255,0.1) in dark) are multiplied through, so the fallback lands
// on the true final colour rather than a bright line.
// ---------------------------------------------------------------------------

/** Parse #rgb/#rrggbb/#rrggbbaa/rgb()/rgba() into [r,g,b,a], or null. */
function parseColor(value) {
  const v = String(value).trim();
  let m = /^#([0-9a-f]{3,8})$/i.exec(v);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    const n = (i) => parseInt(h.substr(i, 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
  }
  m = /^rgba?\(([^)]+)\)$/i.exec(v);
  if (m) {
    const parts = m[1].split(/[,\s\/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const num = (x) => (x.indexOf("%") > -1 ? (parseFloat(x) / 100) * 255 : parseFloat(x));
    const a = parts[3] === undefined ? 1 : (parts[3].indexOf("%") > -1 ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]));
    return [Math.round(num(parts[0])), Math.round(num(parts[1])), Math.round(num(parts[2])), a];
  }
  return null;
}

/** Map of design token -> [r,g,b,a], preferring the .dark value. */
function buildTokenMap(root) {
  const map = {};
  root.walkRule = root.walkRule || null;
  root.walkRules((rule) => {
    const sel = rule.selector || "";
    const isRoot = sel.indexOf(":root") > -1;
    const isDark = sel.indexOf(".dark") > -1;
    if (!isRoot && !isDark) return;
    // Never read tokens out of the wide-gamut @supports layer: those are oklch
    // and are exactly what old Chrome cannot use.
    for (let p = rule.parent; p; p = p.parent) {
      if (p.type === "atrule" && p.name === "supports") return;
    }
    rule.walkDecls((decl) => {
      if (decl.prop.indexOf("--") !== 0) return;
      const c = parseColor(decl.value);
      if (!c) return;
      if (isDark || map[decl.prop] === undefined) map[decl.prop] = c;
    });
  });
  return map;
}

function rgbaString(c, pct) {
  const a = Math.round(c[3] * (pct / 100) * 1000) / 1000;
  return "rgba(" + c[0] + ", " + c[1] + ", " + c[2] + ", " + a + ")";
}

/**
 * Rewrite each full-opacity `var(--token)` fallback to the real translucent
 * colour its @supports partner intends.
 *
 * Two independent passes keyed on selector+property, rather than looking for
 * the fallback as a preceding sibling: Tailwind nests these @supports blocks
 * inside @layer, so the pair are not siblings of the same parent and any
 * index-based search silently finds nothing.
 */
function fixOpacityFallbacks(root, postcssRoot) {
  const tokens = buildTokenMap(root);
  const MIX = /^color-mix\(in [a-z]+,\s*var\((--[a-z0-9-]+)\)\s*([0-9.]+)%,\s*transparent\)$/i;
  const norm = (v) => String(v).replace(/\s+/g, " ").trim();

  // Pass 1: what does each selector+property WANT?
  const wanted = new Map();
  let seen = 0;
  root.walkAtRules("supports", (at) => {
    if (String(at.params).indexOf("color-mix") === -1) return;
    at.walkRules((rule) => {
      rule.walkDecls((decl) => {
        seen++;
        const m = MIX.exec(norm(decl.value));
        if (!m) return;
        wanted.set(rule.selector + "|" + decl.prop, { token: m[1], pct: parseFloat(m[2]) });
      });
    });
  });

  // Pass 2: fix the matching fallbacks, wherever they live.
  //
  // Tailwind often GROUPS the fallback, emitting one rule for the plain
  // utility and its opacity variants together:
  //
  //   .bg-primary,.bg-primary\/5{background-color:var(--primary)}
  //
  // That rule cannot simply be rewritten — `.bg-primary` genuinely wants full
  // opacity. So when the selector is shared, a dedicated override rule is
  // appended straight after it instead. Equal specificity, later in source, so
  // it wins for the /5 variant and leaves the plain utility alone. The
  // @supports copy still comes later again and wins on modern browsers.
  let fixed = 0;
  const unknown = new Set();
  const inserts = [];

  root.walkRules((rule) => {
    // Skip the @supports copies themselves.
    for (let p = rule.parent; p; p = p.parent) {
      if (p.type === "atrule" && p.name === "supports") return;
    }

    const parts = rule.selector.split(",").map((x) => x.trim()).filter(Boolean);

    rule.walkDecls((decl) => {
      const matched = [];
      for (const part of parts) {
        const want = wanted.get(part + "|" + decl.prop);
        if (want) matched.push({ part, want });
      }
      if (matched.length === 0) return;

      for (const { part, want } of matched) {
        if (norm(decl.value).replace(/\s/g, "") !== "var(" + want.token + ")") continue;
        const colour = tokens[want.token];
        if (!colour) { unknown.add(want.token); continue; }
        const value = rgbaString(colour, want.pct);

        if (parts.length === 1) {
          decl.value = value;
          fixed++;
        } else {
          inserts.push({ after: rule, selector: part, prop: decl.prop, value });
        }
      }
    });
  });

  // Applied after the walk so the new rules are not themselves revisited.
  for (const ins of inserts) {
    const clone = postcssRoot.rule({ selector: ins.selector });
    clone.append(postcssRoot.decl({ prop: ins.prop, value: ins.value }));
    ins.after.parent.insertAfter(ins.after, clone);
    fixed++;
  }

  return { fixed, seen, pairs: wanted.size, unknown: [...unknown] };
}

const TARGETS = browserslistToTargets(browserslist("chrome 109, edge 109"));

module.exports = () => ({
  postcssPlugin: "legacy-downlevel",
  OnceExit(root, { result, postcss }) {
    const from = (result.opts && result.opts.from) || "globals.css";

    const stats = fixOpacityFallbacks(root, postcss);
    if (stats.pairs) {
      console.log(
        "[legacy-downlevel] opacity fallbacks: " + stats.fixed + " rewritten of " +
        stats.pairs + " candidate pair(s)" +
        (stats.unknown.length
          ? " (left alone, value not statically known: " + stats.unknown.join(", ") + ")"
          : "")
      );
    }
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
