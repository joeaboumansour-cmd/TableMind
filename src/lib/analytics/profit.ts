// =============================================
// Profit calculation — ONE implementation, used by both sides
// =============================================
//
// Profit was previously computed only inside GET /api/transactions/analytics,
// which meant the History screen showed "—" for Profit whenever the till was
// offline. Every other figure on that screen (revenue, item count, average
// sale) is derived on-device from the local caches; profit was the single
// stat that needed the network.
//
// The device already holds everything required: products_cache carries
// cost_price and currency for the whole catalogue. What it lacked was the
// join key — CachedTransactionItem did not store product_id. It does now.
//
// This module exists so the server route and the offline screen run the SAME
// arithmetic. Two copies of a money calculation is precisely how this codebase
// ended up with four disagreeing LL↔USD conversions (audit P1-6); a shared
// pure function is the only way the two can be guaranteed to agree.
//
// See CLAUDE.md §3 for the money rules this follows.

import { convertUsdToLl } from "@/lib/utils/format";

/** Minimum shape of a sold line needed to price its cost. */
export interface ProfitLineItem {
  product_id?: string | null;
  quantity: number;
  /** LL. Used as the cost fallback when the product is unknown — see below. */
  unit_price: number;
}

/** Minimum shape of a sale needed for revenue. */
export interface ProfitTransaction {
  /** LL. Transaction amounts are ALWAYS stored in LL. */
  total_amount: number;
  items: ProfitLineItem[];
}

/** What we know about a product's cost. */
export interface ProductCost {
  cost_price: number;
  /** The currency `cost_price` is denominated in — 'LL' or 'USD'. */
  currency?: string | null;
}

export interface ProfitTotals {
  totalRevenue: number;
  totalCost: number;
  totalProfit: number;
  /** Percent. Zero when there is no revenue. */
  profitMargin: number;
}

/**
 * A product's cost expressed in LL.
 *
 * `cost_price` is stored in the product's OWN currency, while every
 * transaction amount is in LL. Subtracting a raw USD cost from LL revenue
 * makes the cost vanish against the much larger LL number and reports profit
 * ≈ revenue, so the conversion is mandatory.
 *
 * Uses the sell rate, matching what the cart does when turning a USD
 * selling_price into LL, so cost and revenue are priced on the same basis.
 */
export function productCostInLL(product: ProductCost | undefined | null): number | undefined {
  if (!product) return undefined;
  const cost = Number(product.cost_price) || 0;
  return product.currency === "USD" ? convertUsdToLl(cost) : cost;
}

/**
 * Revenue, cost and profit over a set of sales.
 *
 * `lookupCost` returns the product's cost record, or undefined when the
 * product is unknown (deleted, or not in the local cache yet).
 *
 * FALLBACK, deliberately preserved from the original server implementation:
 * when a product's cost cannot be resolved, the line's `unit_price` is used as
 * its cost — which books that line at zero profit rather than counting its
 * full revenue as profit. Overstating profit on missing data would be the more
 * damaging error, so this stays.
 */
export function computeProfit(
  transactions: ProfitTransaction[],
  lookupCost: (productId: string) => ProductCost | undefined
): ProfitTotals {
  let totalRevenue = 0;
  let totalCost = 0;

  for (const txn of transactions) {
    totalRevenue += Number(txn.total_amount) || 0;

    for (const item of txn.items) {
      const resolved = item.product_id ? productCostInLL(lookupCost(item.product_id)) : undefined;
      const cost = resolved ?? (Number(item.unit_price) || 0);
      totalCost += cost * (Number(item.quantity) || 0);
    }
  }

  const totalProfit = totalRevenue - totalCost;
  return {
    totalRevenue,
    totalCost,
    totalProfit,
    profitMargin: totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0,
  };
}
