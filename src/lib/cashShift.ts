// Cash Register - Drawer Math (shared utility)
// Single source of truth for expected drawer and variance
import { SELL_RATE, roundToNearest5k } from "./utils/format";
import type { CashShift, CashAdjustment, ShiftSummary } from "./cash/types";

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

// ── Per-shift summary ────────────────────────────────────────────────────────

/**
 * The transaction figures for ONE shift, as stored on `transactions`.
 *
 * These are sums over `transactions WHERE shift_id = <this shift>`. Attributing
 * by shift rather than by calendar date is the whole point of migration 027: a
 * shift that runs past midnight reconciles correctly with no special-casing,
 * and registers running side by side do not mix their takings.
 */
export interface ShiftTransactionTotals {
  /** SUM(amount_paid) — GROSS tender in LL-equivalent, change not yet removed. */
  amountPaid: number;
  /** SUM(change_given) — LL handed back to customers. */
  changeGiven: number;
  /** SUM(usd_amount_paid) — the USD slice of amountPaid. DISPLAY ONLY. */
  usdAmountPaid: number;
  count: number;
}

/**
 * Reduce a shift, its adjustments and its sales to the figures the UI shows.
 *
 * One function so the register card, the close-shift dialog and the API cannot
 * disagree about what the drawer should hold.
 *
 * ## Two money bugs are fixed here — read before changing the arithmetic
 *
 * **1. `amount_paid` is GROSS tender, not net takings.**
 * `checkout/page.tsx:333-335` records `amount_paid` as everything the customer
 * handed over (`paidLL + convertUsdToLlForReturn(paidUSD)`) and `change_given`
 * separately as the difference over the total. The money that actually stayed
 * in the drawer is therefore `amount_paid - change_given`.
 *
 * The previous cash page summed `amount_paid` alone and set change to zero,
 * annotated "change is already netted into amount_paid per transaction". It is
 * not. On a 100,000 sale paid with a 200,000 note the old page counted 200,000
 * into the drawer and expected a figure 100,000 too high.
 *
 * **2. USD was double-counted (audit P1-2).**
 * `usd_amount_paid` is the dollar slice of a payment that `amount_paid` ALREADY
 * contains, converted at RETURN_RATE. The old `get_cash_shift_summary` added
 * both, overstating expected LL by the USD take on every mixed-currency sale.
 * `usd_change_given` is likewise the same change re-expressed in dollars.
 *
 * So: the LL total uses `amountPaid - changeGiven` and nothing else. The USD
 * figures are carried through for display, never added back in.
 */
export function summariseShift(
  shift: CashShift | null,
  adjustments: CashAdjustment[],
  totals: ShiftTransactionTotals
): ShiftSummary {
  const openingTotal = shift
    ? combineCurrencyTotals(shift.opening_ll || 0, shift.opening_usd || 0)
    : 0;

  const closingTotal =
    shift && shift.closing_ll != null
      ? combineCurrencyTotals(shift.closing_ll, shift.closing_usd || 0)
      : null;

  const inRows = adjustments.filter((a) => a.adjustment_type === "cash_in");
  const outRows = adjustments.filter((a) => a.adjustment_type === "cash_out");

  const adjustmentsIn = combineCurrencyTotals(
    inRows.reduce((s, a) => s + (a.amount_ll || 0), 0),
    inRows.reduce((s, a) => s + (a.amount_usd || 0), 0)
  );
  const adjustmentsOut = combineCurrencyTotals(
    outRows.reduce((s, a) => s + (a.amount_ll || 0), 0),
    outRows.reduce((s, a) => s + (a.amount_usd || 0), 0)
  );

  // Net cash that stayed in the drawer. See the note above on why this is a
  // subtraction and why no USD term appears.
  const cashReceived = (totals.amountPaid || 0) - (totals.changeGiven || 0);

  const expectedTotal = computeExpectedDrawer({
    openingTotal,
    cashInTotal: cashReceived,
    changeOutTotal: 0, // already removed from cashReceived — do not subtract twice
    adjustmentsIn,
    adjustmentsOut,
  });

  return {
    openingTotal,
    cashReceived,
    adjustmentsIn,
    adjustmentsOut,
    expectedTotal,
    closingTotal,
    variance: computeVariance(closingTotal, expectedTotal),
    transactionCount: totals.count || 0,
    usdCashReceived: totals.usdAmountPaid || 0,
  };
}
