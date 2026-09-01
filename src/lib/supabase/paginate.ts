// =============================================
// Reading more than 1,000 rows out of PostgREST
// =============================================
// **`.limit(n)` does not do what it looks like it does.** Supabase configures
// PostgREST with `db-max-rows = 1000`, and that is a CEILING, not a default: an
// explicit `.limit(5000)` still returns 1,000 rows. Measured against the live
// project on 2026-09-01 — a table with 2,492 matching rows returned exactly
// 1,000 for no limit, `.limit(2500)` and `.limit(5000)` alike.
//
// That makes a whole shape of code silently wrong:
//
// ```ts
// .limit(RECIPE_CAP)                       // RECIPE_CAP = 5000
// ...
// truncated: rows.length >= RECIPE_CAP     // can NEVER be true
// ```
//
// The guard reads as careful and cannot fire. `/api/recipes` and `/api/combos`
// both shipped this, so a store past 1,000 recipe components served a truncated
// recipe set flagged as complete — and the till under-deducted stock on
// whatever fell off the end, which is the exact harm the flag was written to
// prevent.
//
// The only way past the ceiling is to ASK REPEATEDLY. `fetchAllProducts()` in
// products/refresh.ts has always done this correctly with `.range()`; this is
// that loop, extracted so the next caller cannot get it wrong.
// =============================================

/**
 * PostgREST's hard ceiling on rows per request, as configured by Supabase.
 *
 * Not a suggestion and not overridable from the client. A page larger than this
 * is silently trimmed to it.
 */
export const POSTGREST_MAX_ROWS = 1000;

export interface PagedResult<T> {
  rows: T[];
  /**
   * True when `cap` was reached and there may be more.
   *
   * Unlike the `.limit()` version this can actually happen, so a caller that
   * refuses a partial answer now gets the chance to.
   */
  truncated: boolean;
  /** The first page error, if any. `rows` is then whatever arrived before it. */
  error: string | null;
}

/**
 * Read every row a query matches, one PostgREST page at a time.
 *
 * `page(from, to)` must apply a **stable total order** — an `.order()` on a
 * non-unique column is not enough, because rows that compare equal can move
 * between requests and be skipped or duplicated across a page boundary. Add the
 * primary key as a tiebreaker, the way `fetchAllProducts()` orders by name THEN
 * id.
 *
 * Stops at `cap` and says so rather than looping forever on a store nobody
 * anticipated.
 *
 * `startAt` is for the common shape where the FIRST page has already been read
 * — `callerAndRead` fetches it alongside auth — and only the rest is wanted.
 * It defaults to 0. Getting this wrong is not subtle in production but is very
 * subtle in review: passing 0 after a first page has been read re-reads rows
 * 0..999 and the caller silently returns them twice. It did exactly that once,
 * and a seeded 1,304-row read came back as 2,304.
 *
 * `cap` counts from `startAt`, so it is "how many MORE rows may be read".
 */
export async function fetchAllPages<T>(
  page: (
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  cap: number,
  startAt = 0
): Promise<PagedResult<T>> {
  const rows: T[] = [];
  let from = startAt;
  const end = startAt + cap;

  while (from < end) {
    const to = Math.min(from + POSTGREST_MAX_ROWS, end) - 1;
    const { data, error } = await page(from, to);

    if (error) return { rows, truncated: false, error: error.message };
    if (!data || data.length === 0) break;

    rows.push(...data);

    // A short page is the last page. Comparing against the REQUESTED size, not
    // against POSTGREST_MAX_ROWS, so the final partial window at `cap` is read
    // correctly too.
    if (data.length < to - from + 1) break;

    from = to + 1;
  }

  return { rows, truncated: rows.length >= cap, error: null };
}
