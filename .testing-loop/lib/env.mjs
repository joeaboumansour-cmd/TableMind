// Read .env.test without a dependency. The harness store id in here is the
// ONLY thing confining an unattended tester to a disposable tenant on a live
// database, so every consumer reads it from one place.
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const FILE = resolve(process.cwd(), ".env.test");

export const env = existsSync(FILE)
  ? Object.fromEntries(
      readFileSync(FILE, "utf8")
        .split("\n")
        .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
        .map((l) => {
          const i = l.indexOf("=");
          return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
        })
    )
  : {};

export const STORE_ID = env.HARNESS_STORE_ID;

/** Fail closed: never let a tester run without knowing which tenant it owns. */
export function assertConfined() {
  if (!STORE_ID) {
    console.error("[testing-loop] HARNESS_STORE_ID is unset in .env.test. Refusing.");
    process.exit(1);
  }
  return STORE_ID;
}
