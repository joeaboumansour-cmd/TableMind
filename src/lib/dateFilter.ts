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
 * Analytics query string for a filter. Carries the resolved window as `from`
 * so the server never has to guess a day boundary in its own timezone.
 */
export function analyticsQuery(filter: DateFilter | string): string {
  const params = new URLSearchParams({ dateFilter: String(filter) });
  const cutoff = getFilterCutoff(filter as DateFilter);
  if (cutoff) params.set("from", cutoff.toISOString());
  return params.toString();
}
