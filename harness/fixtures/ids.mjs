// =============================================
// Fixed identifiers for the fixture set.
//
// Every id is DERIVED, never random. Snapshots are worthless if the data
// moves, so a re-seed must produce byte-identical ids — that is what lets an
// API contract snapshot or a visual diff mean anything across runs.
//
// The prefix encodes what a row is, so a failing test's id is readable at a
// glance instead of being an opaque uuid you have to look up:
//
//   f0000001-…  product          f0000005-…  transaction
//   f0000002-…  category         f0000006-…  transaction item
//   f0000003-…  store user       f0000007-…  recipe component
//   f0000004-…  cash register    f0000008-…  combo component
//   f0000009-…  cash shift
// =============================================

/**
 * A valid v4-shaped uuid built from a kind and an index.
 *
 * The version nibble (4) and variant nibble (8) are fixed so Postgres accepts
 * it as a uuid and so nothing downstream can mistake these for real ids.
 */
export function fixtureId(kind, index) {
  const k = String(kind).padStart(8, "0");
  const i = index.toString(16).padStart(12, "0");
  return `${k}-0000-4000-8000-${i}`;
}

export const KIND = {
  PRODUCT: "f0000001",
  CATEGORY: "f0000002",
  STORE_USER: "f0000003",
  REGISTER: "f0000004",
  TRANSACTION: "f0000005",
  TXN_ITEM: "f0000006",
  RECIPE: "f0000007",
  COMBO: "f0000008",
  SHIFT: "f0000009",
};

export const productId = (i) => fixtureId(KIND.PRODUCT, i);
export const categoryId = (i) => fixtureId(KIND.CATEGORY, i);
export const userId = (i) => fixtureId(KIND.STORE_USER, i);
export const registerId = (i) => fixtureId(KIND.REGISTER, i);
export const transactionId = (i) => fixtureId(KIND.TRANSACTION, i);
export const txnItemId = (i) => fixtureId(KIND.TXN_ITEM, i);
export const recipeId = (i) => fixtureId(KIND.RECIPE, i);
export const comboId = (i) => fixtureId(KIND.COMBO, i);
export const shiftId = (i) => fixtureId(KIND.SHIFT, i);

/**
 * Deterministic PRNG (mulberry32).
 *
 * `Math.random()` would make every seed run produce different prices and
 * therefore different totals, which defeats the entire point of recording
 * behaviour as a specification.
 */
export function rng(seed = 20260830) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The DST boundary the transaction set spans.
 *
 * Lebanon moves to summer time at 00:00 on the last Sunday of March; in 2026
 * that is the 29th. Sales either side of it are what catch a report that
 * groups by calendar day using UTC, or a shift whose window is computed in the
 * wrong zone — both of which are real bugs this codebase could have, since
 * `business_date` is a DATE and shift resolution matches on `created_at`.
 */
export const DST_BOUNDARY_UTC = "2026-03-28T22:00:00.000Z"; // 2026-03-29 00:00 Beirut
export const TXN_WINDOW_START_UTC = "2026-03-26T06:00:00.000Z";
