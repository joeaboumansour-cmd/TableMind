/**
 * Pull a readable message out of an unknown thrown value.
 *
 * `catch (e)` gives `unknown`, which is correct — anything can be thrown, and
 * `catch (e: any)` (the pattern in most of this codebase) quietly allows
 * `e.message` on a thrown string, producing "undefined" in a log or a toast at
 * exactly the moment someone needs to read it.
 */
export function errorMessage(error: unknown, fallback = "Something went wrong"): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  if (error && typeof error === "object" && "message" in error) {
    const m = (error as { message?: unknown }).message;
    if (typeof m === "string" && m) return m;
  }
  return fallback;
}
