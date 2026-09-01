// =============================================
// Vitest configuration for the API contract suite.
//
// Separate from the unit config because this one needs a RUNNING SERVER and a
// SEEDED DATABASE, so it cannot be part of the suite people run on every save.
// Keeping them apart is what lets `harness:unit` stay under a second and free
// of any reason to be skipped.
//
// Run against a PRODUCTION build (`npm run start`), not `next dev`: dev
// compiles on demand, so the first request to each route pays multi-second
// compilation and the timings — and occasionally the behaviour — differ.
// =============================================

import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");

export default defineConfig({
  resolve: { alias: { "@": resolve(root, "src") } },
  test: {
    root,
    include: ["harness/contract/**/*.test.ts"],
    environment: "node",
    // Real HTTP against a real database. Generous, but still bounded: a route
    // that takes 20s is a finding, not something to wait quietly for.
    testTimeout: 20_000,
    hookTimeout: 30_000,
    // Routes share one store's rows; parallel files would race on the writes
    // in the transaction contract.
    fileParallelism: false,
    reporters: ["default"],
  },
});
