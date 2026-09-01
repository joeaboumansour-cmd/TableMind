// =============================================
// Minimal browser shims for the pure-logic suite.
//
// The cart store is a zustand `persist` store, so importing it touches
// localStorage at module load. jsdom would supply that, but pulling in a whole
// DOM for one storage API is a lot of startup cost for a suite whose budget is
// 10 seconds — and needing a real DOM would be a signal a "pure logic" test is
// reaching too far.
//
// So: the smallest thing that satisfies the store, and nothing more. If a test
// ever needs more of the browser than this, it belongs in the E2E suite.
// =============================================

class MemoryStorage implements Storage {
  #map = new Map<string, string>();
  get length() { return this.#map.size; }
  clear() { this.#map.clear(); }
  getItem(key: string) { return this.#map.has(key) ? this.#map.get(key)! : null; }
  key(i: number) { return [...this.#map.keys()][i] ?? null; }
  removeItem(key: string) { this.#map.delete(key); }
  setItem(key: string, value: string) { this.#map.set(key, String(value)); }
}

const g = globalThis as unknown as {
  localStorage?: Storage;
  sessionStorage?: Storage;
  window?: unknown;
};

if (!g.localStorage) g.localStorage = new MemoryStorage();
if (!g.sessionStorage) g.sessionStorage = new MemoryStorage();

// The store guards on `typeof window === "undefined"` in places. Leaving window
// undefined would exercise the SSR path rather than the till's, so it is
// defined — but only as far as the storage the store actually reaches for.
if (!g.window) g.window = { localStorage: g.localStorage, sessionStorage: g.sessionStorage };
