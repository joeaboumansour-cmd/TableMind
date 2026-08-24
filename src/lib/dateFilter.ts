/**
 * Date-range filters shared by the History feed and the analytics endpoint.
 *
 * The important asymmetry: every option except "today" is a ROLLING window
 * (`now − duration`), which is a pure arithmetic offset and therefore means
 * the same instant in any timezone. "today" is the only one anchored to a
 * CALENDAR-DAY boundary, so it depends on whose midnight you mean.
 *
 * That is exactly why "today" was the only broken filter: the server computed
 * the boundary with `new Date(y, m, d)`, i.e. midnight in the SERVER's zone
 * (UTC on Vercel), while the store — and the feed on the cashier's phone —
 * means midnight in Beirut. The two windows are three hours apart, so the
 * profit figure and the listed sales were measuring different sets.
 *
 * The fix is for the client to compute the window once and send the exact
 * instant to the server, so there is a single definition of "today": the one
 * on the device standing in the shop.
 */

export type DateFilter = "all" | "hour" | "today" | "week" | "month" | "90days";

/**
 * Start of the window for a filter, in the CALLER's timezone.
 * Returns null for "all" (no lower bound).
 */
export function getFilterCutoff(filter: DateFilter, from: Date = new Date()): Date | null {
  if (filter === "all") return null;

  const cutoff = new Date(from.getTime());
  switch (filter) {
    case "hour":
      cutoff.setHours(from.getHours() - 1);
      break;
    case "today":
      // Local midnight — the only calendar-anchored case.
      cutoff.setHours(0, 0, 0, 0);
      break;
    case "week":
      cutoff.setDate(from.getDate() - 7);
      break;
    case "month":
      cutoff.setMonth(from.getMonth() - 1);
      break;
    case "90days":
      cutoff.setDate(from.getDate() - 90);
      break;
  }
  return cutoff;
}

/**
 * The device's IANA timezone, e.g. "Asia/Beirut". Empty when the browser will
 * not say, which is rare enough that the server just falls back to the store's
 * own zone.
 */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

/**
 * Analytics query string for a filter. Carries the resolved window as `from`
 * so the server never has to guess a day boundary in its own timezone, and
 * `tz` so it does not have to guess a CLOCK either.
 *
 * `from` alone fixed which sales are counted; it did nothing for how they are
 * bucketed once counted. "Sales by hour" and "Revenue by day of week" were
 * still built from getHours()/getDay() on the server, i.e. UTC on Vercel, so
 * an 11am sale in Beirut appeared in the 8am column and a sale just after
 * midnight landed on the previous day. Same three-hour gap as the bug above,
 * one step further down the pipeline.
 */
export function analyticsQuery(filter: DateFilter | string): string {
  const params = new URLSearchParams({ dateFilter: String(filter) });
  const cutoff = getFilterCutoff(filter as DateFilter);
  if (cutoff) params.set("from", cutoff.toISOString());
  const tz = deviceTimeZone();
  if (tz) params.set("tz", tz);
  return params.toString();
}
