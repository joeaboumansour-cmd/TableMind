// =============================================
// Bulk pricing planner
//
// Pure: no React, no network, no Dexie. Everything the bulk-edit feature
// decides — what changes, what is skipped and why, and how the writes are
// batched — is worked out here so it can be reasoned about on its own. There
// is no test suite (CLAUDE.md §8), so keeping this separable is the substitute.
//
// Two rules from the schema shape every guard below:
//
//   1. `profit_percentage` is owned by a Postgres trigger.
//      `trigger_calculate_profit` (migration 005, re-created in 009) recomputes
//      it as ((selling_price - cost_price) / cost_price) * 100 on every INSERT
//      and UPDATE. Writing `profit_percentage` is a no-op the database
//      immediately overwrites, so "set profit to X%" is expressed as a write to
//      `selling_price` and the trigger derives the rest.
//
//   2. The columns are narrow. `selling_price` is DECIMAL(10,2) and
//      `profit_percentage` is DECIMAL(5,2), so a value that looks harmless in
//      JS can throw at the database. Both ceilings are enforced here.
//
// Deliberately NOT done: 5,000 LL rounding. The single-product edit form stores
// the raw computed price and CLAUDE.md §3 puts 5k rounding at the cart total
// only. If bulk rounded, the same product would price differently depending on
// which screen last touched it.
// =============================================

export type BulkMode = "profit" | "discount";

/** DECIMAL(5,2) — the column the profit trigger writes into. */
export const MAX_PROFIT_PERCENT = 999;

export const MAX_DISCOUNT_PERCENT = 100;

/** DECIMAL(10,2) on `products.selling_price`. */
export const MAX_SELLING_PRICE = 99_999_999.99;

/** How many ids go into one PostgREST `.in("id", …)` filter. */
export const ID_CHUNK_SIZE = 80;

/** The only fields the planner needs — a subset of the product row. */
export interface BulkTarget {
  id: string;
  name: string;
  currency: "LL" | "USD";
  cost_price: number;
  selling_price: number;
  discount_percentage: number;
}

export type BulkSkipReason = "no-cost" | "overflow" | "unchanged";

export interface BulkSkip {
  id: string;
  name: string;
  reason: BulkSkipReason;
}

export interface BulkChange {
  id: string;
  name: string;
  currency: "LL" | "USD";
  before: number;
  after: number;
}

/** One PostgREST `.update(patch).in("id", ids)` call. */
export interface BulkBatch {
  patch: Record<string, number>;
  ids: string[];
}

export interface BulkPlan {
  mode: BulkMode;
  value: number;
  /** False means nothing should be written — `error` says why. */
  valid: boolean;
  error: string | null;
  changes: BulkChange[];
  skipped: BulkSkip[];
  batches: BulkBatch[];
}

/** Two decimal places, matching the DECIMAL(x,2) columns. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Selling price for a given cost and profit percentage.
 *
 * Same formula as the single-product edit form
 * (`calculateSellingPrice` in the inventory page) — bulk must not drift from
 * what editing one product by hand produces.
 */
export function sellingPriceForProfit(costPrice: number, profitPercent: number): number {
  return round2(costPrice * (1 + profitPercent / 100));
}

/**
 * Work out exactly what a bulk apply would do, without doing any of it.
 *
 * Returns an invalid plan (with `error` set and no batches) rather than
 * throwing, so the dialog can render the reason live as the owner types.
 */
export function planBulkPricing(
  targets: BulkTarget[],
  mode: BulkMode,
  value: number
): BulkPlan {
  const base: BulkPlan = {
    mode,
    value,
    valid: false,
    error: null,
    changes: [],
    skipped: [],
    batches: [],
  };

  if (!Number.isFinite(value)) {
    return { ...base, error: "Enter a percentage." };
  }

  const max = mode === "profit" ? MAX_PROFIT_PERCENT : MAX_DISCOUNT_PERCENT;
  if (value < 0 || value > max) {
    return { ...base, error: `Enter a value between 0 and ${max}%.` };
  }

  const changes: BulkChange[] = [];
  const skipped: BulkSkip[] = [];
  const batches: BulkBatch[] = [];

  if (mode === "profit") {
    // Group by the resulting price so every product that ends up at the same
    // figure goes out in one request instead of one request each.
    const byPrice = new Map<number, string[]>();

    for (const target of targets) {
      if (!(target.cost_price > 0)) {
        // No cost means no margin to apply — and applying anyway would write a
        // selling price of 0, wiping the product's price. This also catches
        // every variant row, which carries cost 0 / price 0 by design.
        skipped.push({ id: target.id, name: target.name, reason: "no-cost" });
        continue;
      }

      const next = sellingPriceForProfit(target.cost_price, value);

      if (next > MAX_SELLING_PRICE) {
        skipped.push({ id: target.id, name: target.name, reason: "overflow" });
        continue;
      }
      if (next === round2(target.selling_price)) {
        skipped.push({ id: target.id, name: target.name, reason: "unchanged" });
        continue;
      }

      changes.push({
        id: target.id,
        name: target.name,
        currency: target.currency,
        before: target.selling_price,
        after: next,
      });

      const bucket = byPrice.get(next);
      if (bucket) bucket.push(target.id);
      else byPrice.set(next, [target.id]);
    }

    for (const [selling_price, ids] of byPrice) {
      batches.push({ patch: { selling_price }, ids });
    }
  } else {
    const next = round2(value);
    const ids: string[] = [];

    for (const target of targets) {
      const current = round2(target.discount_percentage || 0);
      if (current === next) {
        skipped.push({ id: target.id, name: target.name, reason: "unchanged" });
        continue;
      }
      changes.push({
        id: target.id,
        name: target.name,
        currency: target.currency,
        before: current,
        after: next,
      });
      ids.push(target.id);
    }

    // One patch for everyone — a discount is the same value on every row.
    if (ids.length > 0) {
      batches.push({ patch: { discount_percentage: next }, ids });
    }
  }

  return { ...base, valid: true, changes, skipped, batches };
}

/**
 * The changes with the largest movement first.
 *
 * The preview shows these rather than the first few in list order: a typo of
 * 300 instead of 30 is only obvious if the worst case is the one on screen.
 */
export function topChanges(plan: BulkPlan, limit: number): BulkChange[] {
  return [...plan.changes]
    .sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before))
    .slice(0, limit);
}

/** How many of each skip reason, for the dialog's summary line. */
export function countSkips(plan: BulkPlan): Record<BulkSkipReason, number> {
  const counts: Record<BulkSkipReason, number> = {
    "no-cost": 0,
    overflow: 0,
    unchanged: 0,
  };
  for (const skip of plan.skipped) counts[skip.reason]++;
  return counts;
}

/** Split ids into `.in()`-sized chunks — a long UUID list inflates the query string. */
export function chunkIds(ids: string[], size: number = ID_CHUNK_SIZE): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    chunks.push(ids.slice(i, i + size));
  }
  return chunks;
}

/** Total number of network round-trips a plan will take. */
export function countRequests(plan: BulkPlan): number {
  return plan.batches.reduce((total, batch) => total + chunkIds(batch.ids).length, 0);
}
