#!/usr/bin/env node
// The live dashboard. No dependencies, no build step, no tokens.
//
// It is deliberately a LOCAL server rather than a hosted page: the tester
// writes a finding to disk and this pushes it to the browser within ~100ms,
// whereas anything hosted could only be as fresh as the orchestrator's tick.
// Dragging a card writes the bug file straight back, so a delegation is
// visible to the orchestrator the instant you drop it.
import { createServer } from "node:http";
import { readFileSync, watch, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { listBugs, move } from "../lib/store.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BUGS = resolve(HERE, "..", "bugs");
const PORT = Number(process.env.TESTING_LOOP_PORT ?? 4000);

if (!existsSync(BUGS)) mkdirSync(BUGS, { recursive: true });

/** Open SSE responses. The tester's writes fan out to every open tab. */
const clients = new Set();

function broadcast() {
  const payload = "data: " + JSON.stringify(listBugs()) + "\n\n";
  for (const res of clients) {
    try {
      res.write(payload);
    } catch {
      clients.delete(res);
    }
  }
}

// Coalesce: writeJson does write-then-rename, so one logical save can fire
// several fs events. Without the debounce every finding would push twice.
let timer = null;
watch(BUGS, () => {
  clearTimeout(timer);
  timer = setTimeout(broadcast, 80);
});

const json = (res, code, body) => {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (url.pathname === "/api/stream") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write("data: " + JSON.stringify(listBugs()) + "\n\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  if (url.pathname === "/api/move" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const { id, to } = JSON.parse(body);
        move(id, to, "moved from dashboard");
        broadcast();
        json(res, 200, { ok: true });
      } catch (e) {
        json(res, 400, { ok: false, error: e.message });
      }
    });
    return;
  }

  if (url.pathname === "/api/bugs") return json(res, 200, listBugs());

  // Whether the watchdog is actually ticking. This exists because two
  // in-session schedulers reported success and never fired, and nothing on
  // screen said so — the board just quietly stopped moving. Liveness has to be
  // visible or "is it running?" is unanswerable.
  if (url.pathname === "/api/heartbeat") {
    const p = resolve(HERE, "..", "heartbeat.json");
    if (!existsSync(p)) return json(res, 200, { alive: false, reason: "watchdog has never run" });
    try {
      return json(res, 200, JSON.parse(readFileSync(p, "utf8")));
    } catch {
      return json(res, 200, { alive: false, reason: "heartbeat unreadable" });
    }
  }

  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(readFileSync(resolve(HERE, "index.html")));
}).listen(PORT, () => {
  console.log("[testing-loop] dashboard  http://localhost:" + PORT);
});
