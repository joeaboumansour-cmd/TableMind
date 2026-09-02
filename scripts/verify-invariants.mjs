#!/usr/bin/env node
// =============================================
// The statically checkable §1 invariants, as a build gate.
//
//   npm run verify:invariants     (also runs inside `npm run build`)
//
// Phase 9.1 of docs/PERF-REFACTOR-PLAN.md. The plan's whole insurance policy is
// that whatever happens to the harness — kept, pruned, or deleted — what stands
// afterwards is a set of PERMANENT build-time gates. `verify:sw` and
// `verify:budgets` were the first two. This is the third, and unlike them it is
// about the source rather than the build output.
//
// ## What belongs here, and what does not
//
// Only invariants a machine can decide by READING THE CODE. "A sale is never
// blocked by cash-register state" is load-bearing and untestable this way; it
// belongs in the E2E suite. "The tenancy column is never `merchant_id`" is a
// grep, and a grep that survives the harness being deleted.
//
// Every check names the invariant, and every failure says what breaks in a real
// shop — because these fire on somebody else's afternoon, months from now, and
// a rule with no reason attached gets deleted rather than obeyed.
//
// Comments are STRIPPED before matching. This codebase documents its dead
// patterns constantly ("NOT `=== 'sellable'`", "the dead `x-restaurant-id`
// header"), and a gate that cannot tell a warning from a violation would punish
// exactly the comments that prevent the violation.
// =============================================

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const ROOT = resolve(process.cwd());
const SRC = join(ROOT, "src");

/** Every .ts/.tsx under src/, as { path, code } with comments removed. */
function sourceFiles() {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry)) continue;
      out.push({
        path: relative(ROOT, full).split(sep).join("/"),
        code: stripComments(readFileSync(full, "utf8")),
      });
    }
  };
  walk(SRC);
  return out;
}

/**
 * Remove comments and string-literal contents.
 *
 * Crude on purpose — it is not a parser, and it does not need to be. It only
 * has to stop a comment ABOUT a forbidden pattern from reading as a use of it.
 * Erring toward removing too much makes this gate miss things; it never makes
 * it fire wrongly, and a gate that cries wolf is a gate somebody deletes.
 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

const files = sourceFiles();

/** Lines matching `pattern`, as "path:line" — for a failure a person can act on. */
function hits(pattern, filter = () => true) {
  const found = [];
  for (const f of files) {
    if (!filter(f.path)) continue;
    f.code.split("\n").forEach((line, i) => {
      if (pattern.test(line)) found.push(`${f.path}:${i + 1}`);
    });
  }
  return found;
}

function fileCode(path) {
  const f = files.find((x) => x.path === path);
  return f ? f.code : null;
}

const CHECKS = [
  {
    name: "invariant 14 — the tenancy column is store_id, never merchant_id or restaurant_id",
    run: () => hits(/\b(merchant_id|restaurant_id)\b/),
    why: [
      "Those columns belong to TableMind, the abandoned restaurant product this",
      "repo was pivoted from. They do not exist in this database. Code using",
      "one is either dead or silently reading nothing — and a query that scopes",
      "by a column that does not exist is a query that is not scoped at all.",
    ],
  },
  {
    name: "invariant 2 — rounding to 5,000 LL happens in ONE place",
    run: () =>
      hits(
        /roundToNearest5k\s*\(/,
        (p) => p !== "src/lib/utils/format.ts" && p !== "src/lib/stores/cartStore.ts"
      ),
    why: [
      "Rounding belongs at the cart TOTAL — cartStore.getTotal() — and nowhere",
      "else. Per-line rounding compounds and drifts, so every basket is wrong by",
      "a little and no two tills agree. format.ts defines it; cartStore is the",
      "only caller. If you need a converted amount, call convertUsdToLl(), which",
      "is that rounding with the sell rate already applied.",
    ],
  },
  {
    name: "invariant 16 — isSellable() is `!== 'ingredient'`, never `=== 'sellable'`",
    run: () => {
      const code = fileCode("src/lib/products/kind.ts");
      if (code === null) return ["src/lib/products/kind.ts is missing"];
      return /kind\s*!==\s*["']ingredient["']/.test(code)
        ? []
        : ["src/lib/products/kind.ts"];
    },
    why: [
      "`kind` is OPTIONAL on CachedProduct: a device whose IndexedDB predates",
      "migration 030 has `undefined` on every row. The strict form would show an",
      "EMPTY CATALOGUE on the busiest screen in the app — a till that cannot",
      "sell anything. Default-sellable is the safe direction.",
    ],
  },
  {
    name: "invariant 17 — transaction modifiers use `?? null`, never `|| null`",
    run: () => hits(/modifiers[^\n]*\|\|\s*null/),
    why: [
      "`[]` and `null` mean different things to the kitchen board: NULL is an",
      "ordinary retail line, `[]` is a food order nobody changed. The board",
      "filters on `modifiers IS NOT NULL`, so collapsing `[]` to null with `||`",
      "makes a retail store see every sale as a ticket — and hides real tickets",
      "from a kitchen that is waiting for them.",
    ],
  },
  {
    name: "invariant 13 — the service-worker reload guard asks about ALL lanes",
    run: () => {
      const code = fileCode("src/components/PWAUpdateListener.tsx");
      if (code === null) return ["src/components/PWAUpdateListener.tsx is missing"];
      return /hasAnyLaneItems/.test(code) ? [] : ["src/components/PWAUpdateListener.tsx"];
    },
    why: [
      "A service-worker update RELOADS THE PAGE. Checking `items.length` asks",
      "only about the ACTIVE lane, and a parked lane holds a real customer's",
      "shopping — so an update lands mid-sale and throws it away. Ask",
      "hasAnyLaneItems(state).",
    ],
  },
  {
    name: "invariant 9 — the sync replay forwards stock_decrements",
    run: () => {
      const code = fileCode("src/lib/sync/engine.ts");
      if (code === null) return ["src/lib/sync/engine.ts is missing"];
      return /stock_decrements/.test(code) ? [] : ["src/lib/sync/engine.ts"];
    },
    why: [
      "Without it a queued MENU sale falls into the server's fallback and",
      "decrements the menu item's own meaningless stock instead of its",
      "ingredients. Silent, offline-only, and invisible until a stock take.",
    ],
  },
  {
    name: "invariant 19 — no PostgREST .limit() above the 1,000-row ceiling",
    run: () => {
      const found = [];
      for (const f of files) {
        f.code.split("\n").forEach((line, i) => {
          const m = /\.limit\(\s*(\d+)\s*\)/.exec(line);
          if (m && Number(m[1]) > 1000) found.push(`${f.path}:${i + 1}  .limit(${m[1]})`);
        });
      }
      return found;
    },
    why: [
      "Supabase configures PostgREST with db-max-rows = 1000, and that is a",
      "CEILING, not a default: `.limit(5000)` still returns 1,000 rows —",
      "measured against the live project. So the read is silently truncated AND",
      "any `truncated: rows.length >= CAP` guard computed from it can never",
      "fire, which reads as careful and is not. /api/recipes and /api/combos",
      "both shipped exactly this, serving short recipe and combo sets flagged",
      "as complete — the till then under-deducted stock on what fell off the",
      "end. Page it with .range() instead: see src/lib/supabase/paginate.ts.",
    ],
  },
  {
    name: "bundle rule — nothing imports from @/components/BarcodeScanner",
    run: () => hits(/from\s+["']@\/components\/BarcodeScanner["']/),
    why: [
      "That module pulls in @zxing/library — a ~420KB chunk — and importing it",
      "for the scan beep drags ZXing into the POS bundle for every store,",
      "including the ones whose till never opens a camera. Import the sound from",
      "@/lib/feedback. BarcodeScanner itself is loaded via next/dynamic.",
    ],
  },
  {
    name: "security — nothing outside src/app/api/ constructs a Supabase client",
    run: () => {
      // Server-side by construction, or the client factories themselves.
      const SERVER = [
        /^src\/app\/api\//,
        /^src\/lib\/supabase\//,
        /^src\/lib\/types\//,
        /^src\/middleware\.ts$/,
      ];
      // Value imports only. `import type` and `typeof` are erased at compile
      // time and ship nothing, so flagging them would make this cry wolf on a
      // file that is already correct. The dynamic form is listed because a real
      // offender used it INSIDE a function body, where no scan of the import
      // block would ever have found it.
      const BAD = [
        /(^|[^a-zA-Z])import\s+(?!type\b)[^;]*from\s+["']@\/lib\/supabase\/client["']/,
        /(^|[^a-zA-Z])import\s*\(\s*["']@\/lib\/supabase\/client["']\s*\)/,
        /createBrowserClient\s*\(/,
      ];
      const found = [];
      for (const f of files) {
        if (SERVER.some((re) => re.test(f.path))) continue;
        f.code.split("\n").forEach((line, i) => {
          if (BAD.some((re) => re.test(line))) found.push(`${f.path}:${i + 1}`);
        });
      }
      return found;
    },
    why: [
      "Anything prefixed NEXT_PUBLIC_ is compiled into the client bundle, so a",
      "browser Supabase client means shipping a database key to every till. For",
      "a long time that key was the SERVICE_ROLE one, which bypasses RLS: any",
      "visitor to the site could read and write every tenant's data, and the key",
      "was recoverable from the deployed JavaScript in under a minute.",
      "",
      "It could not simply be swapped for an anon key, because the browser was",
      "doing the authentication itself — login pulled password_hash down to the",
      "page and compared it there — so a properly-scoped key made login fail.",
      "That is why this rule is structural rather than a config note.",
      "",
      "RLS cannot rescue it either: auth is hand-rolled in localStorage, so",
      "Postgres has no identity to write a policy against. The browser talks to",
      "/api/*, which resolves the caller and scopes every query server-side.",
      "Keep it that way.",
    ],
  },
];

let failed = 0;
for (const check of CHECKS) {
  const problems = check.run();
  if (problems.length === 0) {
    console.log(`[verify-invariants] ok    ${check.name}`);
    continue;
  }
  failed++;
  console.error(`[verify-invariants] FAIL  ${check.name}`);
  for (const p of problems.slice(0, 12)) console.error(`    ${p}`);
  if (problems.length > 12) console.error(`    …and ${problems.length - 12} more`);
  console.error(`    ${check.why.join("\n    ")}`);
  console.error("");
}

if (failed > 0) {
  console.error(
    `[verify-invariants] ${failed} invariant${failed === 1 ? "" : "s"} broken. ` +
      "These are the rules in docs/PERF-REFACTOR-PLAN.md §1; each has already " +
      "cost a real shop money at least once."
  );
  process.exit(1);
}

console.log(`[verify-invariants] Invariants OK — ${CHECKS.length} checks.`);
