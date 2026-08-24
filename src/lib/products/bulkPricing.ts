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

export type BulkMode = "profit" | "discount" | "currency";

/** Which way a currency conversion runs. */
export type CurrencyDirection = "to-LL" | "to-USD";

/** DECIMAL(5,2) — the column the profit trigger writes into. */
export const MAX_PROFIT_PERCENT = 999;

export const MAX_DISCOUNT_PERCENT = 100;

/** DECIMAL(10,2) on `products.selling_price`. */
export const MAX_SELLING_PRICE = 99_999_999.99;

/**
 * Bounds on the operator-typed conversion rate.
 *
 * Deliberately wide — Lebanon's rate has moved by orders of magnitude and the
 * owner may be pricing against something other than the till's own rate. These
 * exist to catch a blank field or a slipped keystroke, not to second-guess the
 * figure.
 */
export const MIN_RATE = 1;
export const MAX_RATE = 10_000_000;

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
  /**
   * Ids of this product's variant rows.
   *
   * Variants carry cost 0 / price 0 and a `currency` copied from the parent at
   * creation, so they are never repriced — but a currency conversion has to
   * take their `currency` along or the list shows a USD variant under an LL
   * parent. Empty for everything except the currency planner.
   */
  variantIds: string[];
}

export type BulkSkipReason =
  | "no-cost"
  | "overflow"
  | "unchanged"
  /** Currency mode: the product is already denominated in the target currency. */
  | "already-target"
  /** Currency mode: converting would round a real price down to 0.00. */
  | "rounds-to-zero";

export interface BulkSkip {
  id: string;
  name: string;
  reason: BulkSkipReason;
}

export interface BulkChange {
  id: string;
  name: string;
  /** The currency `before` is written in. */
  currency: "LL" | "USD";
  /**
   * The currency `after` is written in, when it differs from `currency`.
   * Only currency mode sets this; everything else stays in one denomination.
   */
  toCurrency?: "LL" | "USD";
  before: number;
  after: number;
}

/** One PostgREST `.update(patch).in("id", ids)` call. */
export interface BulkBatch {
  /** `currency` is a string column; every other patched column is numeric. */
  patch: Record<string, number | string>;
  ids: string[];
}

export interface BulkPlan {
  mode: BulkMode;
  /** The percentage in profit/discount mode; the conversion rate in currency mode. */
  value: number;
  /** Set in currency mode only. */
  direction: CurrencyDirection | null;
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
  // Currency conversion is `planCurrencyConversion` below. Narrowing here means
  // a caller cannot fall into the discount branch by passing "currency".
  mode: Exclude<BulkMode, "currency">,
  value: number
): BulkPlan {
  const base: BulkPlan = {
    mode,
    value,
    direction: null,
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
 * Convert every selected product's prices into the other currency.
 *
 * A sibling of `planBulkPricing` rather than a third branch inside it: the
 * profit/discount logic is live and load-bearing, and there is no test suite to
 * catch a regression in it (CLAUDE.md §8).
 *
 * BOTH price columns are converted by the same factor, and that is not
 * optional. `trigger_calculate_profit` (migration 005) recomputes
 * `profit_percentage` as ((selling - cost) / cost) * 100 on every UPDATE:
 *
 *   - scaling both leaves the ratio identical, so the profit percentage comes
 *     out unchanged and cannot overflow its DECIMAL(5,2) column;
 *   - scaling `selling` alone would send a $2.00 price against an untouched
 *     $1.50 cost to a profit of ~11,999,900%, which THROWS at the database.
 *
 * No 5,000 LL rounding, per the note at the top of this file — the stored price
 * stays exact and `cartStore.getTotal()` remains the only place 5k is applied.
 */
export function planCurrencyConversion(
  targets: BulkTarget[],
  direction: CurrencyDirection,
  rate: number
): BulkPlan {
  const to: "LL" | "USD" = direction === "to-LL" ? "LL" : "USD";

  const base: BulkPlan = {
    mode: "currency",
    value: rate,
    direction,
    valid: false,
    error: null,
    changes: [],
    skipped: [],
    batches: [],
  };

  if (!Number.isFinite(rate)) {
    return { ...base, error: "Enter a rate." };
  }
  if (rate < MIN_RATE || rate > MAX_RATE) {
    return {
      ...base,
      error: `Enter a rate between ${MIN_RATE.toLocaleString("en-US")} and ${MAX_RATE.toLocaleString("en-US")}.`,
    };
  }

  const convert = (amount: number): number =>
    round2(direction === "to-LL" ? amount * rate : amount / rate);

  const changes: BulkChange[] = [];
  const skipped: BulkSkip[] = [];
  const batches: BulkBatch[] = [];

  // Products landing on the same pair of prices go out in one request. A shop
  // prices a lot of things identically, so this collapses hard in practice.
  const byPrices = new Map<string, string[]>();
  const variantIds: string[] = [];

  for (const target of targets) {
    if (target.currency === to) {
      skipped.push({ id: target.id, name: target.name, reason: "already-target" });
      continue;
    }

    const nextCost = convert(target.cost_price);
    const nextSelling = convert(target.selling_price);

    if (nextCost > MAX_SELLING_PRICE || nextSelling > MAX_SELLING_PRICE) {
      skipped.push({ id: target.id, name: target.name, reason: "overflow" });
      continue;
    }

    // Never let a conversion silently wipe a price. Only reachable going to
    // USD, where a small LL figure divides below half a cent.
    if (target.selling_price > 0 && nextSelling === 0) {
      skipped.push({ id: target.id, name: target.name, reason: "rounds-to-zero" });
      continue;
    }

    changes.push({
      id: target.id,
      name: target.name,
      currency: target.currency,
      toCurrency: to,
      before: target.selling_price,
      after: nextSelling,
    });

    const key = `${nextCost}|${nextSelling}`;
    const bucket = byPrices.get(key);
    if (bucket) bucket.push(target.id);
    else byPrices.set(key, [target.id]);

    variantIds.push(...target.variantIds);
  }

  for (const [key, ids] of byPrices) {
    const [cost_price, selling_price] = key.split("|").map(Number);
    batches.push({ patch: { cost_price, selling_price, currency: to }, ids });
  }

  // Variants follow their parent's denomination but keep their 0 prices, so
  // they get their own patch. Folding them into the price patches above would
  // overwrite that 0 with the parent's converted price.
  if (variantIds.length > 0) {
    batches.push({ patch: { currency: to }, ids: variantIds });
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
  // In currency mode `before` and `after` are in different denominations, so
  // their difference is a meaningless number — an LL figure minus a USD one.
  // Rank by the existing price instead: the most valuable stock is what an
  // owner needs to see before agreeing to reprice it.
  const weight =
    plan.mode === "currency"
      ? (change: BulkChange) => change.before
      : (change: BulkChange) => Math.abs(change.after - change.before);

  return [...plan.changes].sort((a, b) => weight(b) - weight(a)).slice(0, limit);
}

/** How many of each skip reason, for the dialog's summary line. */
export function countSkips(plan: BulkPlan): Record<BulkSkipReason, number> {
  const counts: Record<BulkSkipReason, number> = {
    "no-cost": 0,
    overflow: 0,
    unchanged: 0,
    "already-target": 0,
    "rounds-to-zero": 0,
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
