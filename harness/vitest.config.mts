// =============================================
// Vitest configuration for the characterization harness.
//
// Lives under harness/ with everything else, so removal stays a `git rm` of
// one folder (Phase 1 quarantine rule).
//
// The unit suite is PURE LOGIC ONLY: no database, no network, no browser. That
// is what keeps it under the 10s budget the plan sets and free of flake, and
// it is why the environment is `node` rather than jsdom — nothing here should
// need a DOM, and requiring one would be a signal the test is reaching too far.
// =============================================

import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

export default defineConfig({
  resolve: {
    alias: { "@": resolve(root, "src") },
  },
  test: {
    root,
    include: ["harness/unit/**/*.test.ts"],
    environment: "node",
    setupFiles: ["harness/unit/setup.ts"],
    // Fail rather than hang: a pure-logic test that takes a second is broken.
    testTimeout: 5_000,
    reporters: ["default"],
  },
});
