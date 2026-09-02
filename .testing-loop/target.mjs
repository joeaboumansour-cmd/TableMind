#!/usr/bin/env node
// Which app a charter runs against.
//
//   node .testing-loop/target.mjs local
//   node .testing-loop/target.mjs prod
//   node .testing-loop/target.mjs --charter .testing-loop/charters/002-....json
//
// Three targets, and the split is deliberate:
//
//   local   a PRODUCTION BUILD on :3000 (`npm run start`). `next dev` emits no
//           service worker at all, so on dev the loop is blind to the entire
//           PWA layer — the NetworkOnly rule on /api/health, the precache
//           contents, offline cold start, the P0-10 credential-cache purge.
//           Service workers are allowed on localhost without HTTPS, so a local
//           production build reaches nearly all of it, and can be killed
//           mid-sale to produce a real outage.
//
//   prod    the deployed app. The only place Edge /api/health answers at real
//           PoPs and the CDN behaves like the CDN. Cannot be taken offline,
//           and cannot serve a coder's branch.
//
//   verify  a coder's worktree on :3001. Always local, by necessity — a fix
//           under test is a branch, and prod serves main.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertConfined } from "./lib/env.mjs";

const cfg = JSON.parse(readFileSync(resolve(process.cwd(), ".testing-loop/config.json"), "utf8"));

const rest = process.argv.slice(2);
const arg = (n) => {
  const i = rest.indexOf("--" + n);
  return i === -1 ? undefined : rest[i + 1];
};

let name = rest.find((a) => !a.startsWith("--"));
if (arg("charter")) {
  name = JSON.parse(readFileSync(arg("charter"), "utf8")).target ?? "local";
}
name = name ?? "local";

const url = cfg.targets?.[name];

if (!url) {
  console.error(
    "[target] '" + name + "' has no URL in .testing-loop/config.json.\n" +
      (name === "prod"
        ? "  Set targets.prod to the deployed app's URL before running a prod charter.\n" +
          "  Refusing rather than silently falling back to localhost — a charter that\n" +
          "  believes it is testing production and is not is worse than no charter."
        : "  Known targets: " + Object.keys(cfg.targets ?? {}).join(", "))
  );
  process.exit(1);
}

// The harness store is the containment on EVERY target, prod included. Sales
// rung on the deployed app go to the same database dev already writes to; the
// store id is what keeps them out of real shops' books.
const storeId = assertConfined();

console.log(
  JSON.stringify(
    {
      target: name,
      url,
      storeId,
      canGoOffline: name === "local",
      note:
        name === "prod"
          ? "Deployed app. It cannot be taken offline — outage charters must run on 'local'. Never sign in as anything but the harness store."
          : undefined,
    },
    null,
    2
  )
);
