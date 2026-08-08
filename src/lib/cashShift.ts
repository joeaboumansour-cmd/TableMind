// Cash Register - Drawer Math (shared utility)
// Single source of truth for expected drawer and variance
import { SELL_RATE, roundToNearest5k } from "./utils/format";

/**
 * Combine LL and USD amounts into a single LL-equivalent total.
 * USD is converted at the store's SELL_RATE.
 * The USD→LL conversion is rounded to the nearest 5,000 LL so that all
 * cash-register totals stay on real bill denominations.
 */
export function combineCurrencyTotals(ll: number, usd: number): number {
  return (ll || 0) + roundToNearest5k((usd || 0) * SELL_RATE);
}

/**
 * Compute the expected end-of-day drawer total (LL-equivalent).
 * Expected = opening + cash_in - change_out + adj_in - adj_out
 */
export function computeExpectedDrawer(params: {
  openingTotal: number;
  cashInTotal: number;
  changeOutTotal: number;
  adjustmentsIn: number;
  adjustmentsOut: number;
}): number {
  const { openingTotal, cashInTotal, changeOutTotal, adjustmentsIn, adjustmentsOut } = params;
  return openingTotal + cashInTotal - changeOutTotal + adjustmentsIn - adjustmentsOut;
}

/**
 * Compute the variance between the counted closing amount and expected.
 * Positive = overage, negative = shortage. Null when no closing recorded.
 */
export function computeVariance(
  closingTotal: number | null | undefined,
  expectedTotal: number
): number | null {
  if (closingTotal == null) return null;
  return closingTotal - expectedTotal;
}