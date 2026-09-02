#!/usr/bin/env node
// The tester's and orchestrator's interface to the ledger. Deterministic, so
// dedupe and state transitions never depend on a model remembering to check.
//
//   node .testing-loop/cli.mjs report --file finding.json
//   node .testing-loop/cli.mjs move --id bug-0001 --to fixing
//   node .testing-loop/cli.mjs state
import { readFileSync } from "node:fs";
import { report, move, digest, listBugs, getBug } from "./lib/store.mjs";

const [cmd, ...rest] = process.argv.slice(2);
const arg = (name) => {
  const i = rest.indexOf("--" + name);
  return i === -1 ? undefined : rest[i + 1];
};

try {
  switch (cmd) {
    case "report": {
      const file = arg("file");
      const raw = file ? readFileSync(file, "utf8") : arg("json");
      if (!raw) throw new Error("report needs --file <path> (or --json)");
      console.log(JSON.stringify(report(JSON.parse(raw))));
      break;
    }
    case "move": {
      const bug = move(arg("id"), arg("to"), arg("note"));
      console.log(JSON.stringify({ ok: true, id: bug.id, status: bug.status }));
      break;
    }
    case "state":
      console.log(JSON.stringify(digest(), null, 2));
      break;
    case "show":
      console.log(JSON.stringify(getBug(arg("id")), null, 2));
      break;
    case "list":
      for (const b of listBugs()) {
        console.log(b.id + "  " + String(b.status).padEnd(13) + " [" + b.class + "] " + b.title);
      }
      break;
    default:
      console.log("usage: cli.mjs report|move|state|show|list");
      process.exit(1);
  }
} catch (e) {
  console.error("[testing-loop] " + e.message);
  process.exit(1);
}
