#!/usr/bin/env node
// Which hot path gets tested next.
//
// Arithmetic, not judgement. Asking a model to choose would cost a round trip
// every tick and drift toward whatever it looked at last; a score keeps the
// tester off the same three screens all night without anyone paying for the
// decision.
//
//   node .testing-loop/next-charter.mjs                  -> the winner
//   node .testing-loop/next-charter.mjs --record 001     -> mark it tested now
//   node .testing-loop/next-charter.mjs --fail 001       -> it found something
//   node .testing-loop/next-charter.mjs --all            -> the whole ranking
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const LEDGER = resolve(process.cwd(), ".testing-loop/ledger.json");
const CHARTERS = resolve(process.cwd(), ".testing-loop/charters");

const rest = process.argv.slice(2);
const arg = (n) => {
  const i = rest.indexOf("--" + n);
  return i === -1 ? undefined : rest[i + 1];
};

const ledger = JSON.parse(readFileSync(LEDGER, "utf8"));
const save = () => writeFileSync(LEDGER, JSON.stringify(ledger, null, 2) + "\n");

/**
 * risk x staleness x recent trouble.
 *
 * Staleness is logarithmic so a path untested for a week does not permanently
 * outrank the money path; risk stays the dominant term, which is the intent.
 * A path that has produced findings is worth revisiting — bugs cluster.
 */
function score(p) {
  const hours = p.lastTested ? (Date.now() - Date.parse(p.lastTested)) / 3.6e6 : 24 * 30;
  return p.risk * Math.log2(2 + hours) * (1 + (p.failures ?? 0));
}

const find = (id) => {
  const p = ledger.paths.find((x) => x.id === id);
  if (!p) throw new Error("no such path: " + id);
  return p;
};

if (arg("record")) {
  const p = find(arg("record"));
  p.lastTested = new Date().toISOString();
  save();
  console.log(JSON.stringify({ ok: true, id: p.id, lastTested: p.lastTested }));
} else if (arg("fail")) {
  const p = find(arg("fail"));
  p.failures = (p.failures ?? 0) + 1;
  save();
  console.log(JSON.stringify({ ok: true, id: p.id, failures: p.failures }));
} else {
  const ranked = ledger.paths
    .map((p) => ({ ...p, score: Number(score(p).toFixed(1)) }))
    .sort((a, b) => b.score - a.score);

  if (rest.includes("--all")) {
    console.log(JSON.stringify(ranked, null, 2));
  } else {
    const top = ranked[0];
    // A ledger row without a written charter is a gap the tester fills by
    // authoring one — reported here rather than silently skipped.
    const file = existsSync(CHARTERS)
      ? readdirSync(CHARTERS).find((f) => f.startsWith(top.id + "-"))
      : undefined;
    console.log(
      JSON.stringify(
        {
          id: top.id,
          path: top.path,
          score: top.score,
          charter: file ? ".testing-loop/charters/" + file : null,
          action: file ? "run" : "author",
        },
        null,
        2
      )
    );
  }
}
