// =============================================
// Initials for the login roster's avatar chips.
//
// Pure and tiny, but kept out of the components because two surfaces need the
// same answer (the roster chip and the account dialog) and a person whose tile
// says "DS" in one place and "D" in the other reads as two different people.
// =============================================

/**
 * One or two letters standing in for a person or a store.
 *
 *   "Sara Khoury"    -> "SK"
 *   "downtown_store" -> "DS"     (usernames are snake/kebab in this app)
 *   "daoud"          -> "DA"
 *   ""               -> "?"
 *
 * Digits count as characters worth showing — "till2" is a real display name
 * here — but a leading digit never becomes the whole tile on its own if a
 * letter is available.
 */
export function initialsFor(name: string): string {
  const trimmed = (name || "").trim();
  if (!trimmed) return "?";

  // Split on the separators this app's names actually use.
  const words = trimmed.split(/[\s_\-.]+/).filter(Boolean);

  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }

  const word = words[0] ?? trimmed;

  // A single camelCase word still carries two initials worth showing.
  const camel = word.match(/^([a-z])[a-z0-9]*([A-Z])/);
  if (camel) return (camel[1] + camel[2]).toUpperCase();

  return word.slice(0, 2).toUpperCase();
}
