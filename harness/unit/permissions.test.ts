// =============================================
// Characterization: src/lib/auth/permissions.ts and src/lib/features.ts
//
// Both share one property worth pinning: an unreadable or absent value must
// resolve to the SAFE direction. For a permission that is "deny"; for a
// feature flag it is the flag's declared default.
// =============================================

import { describe, it, expect } from "vitest";
import {
  SECTIONS,
  parsePermissions,
  getDefaultPermissions,
  getFullPermissions,
  canAccess,
  type StoreUser,
} from "@/lib/auth/permissions";
import { FEATURES, FEATURE_PRESETS, mergeFeaturesWithDefaults } from "@/lib/features";

const SECTION_KEYS = Object.keys(SECTIONS);

describe("SECTIONS", () => {
  it("has the six sections the app guards on", () => {
    expect(SECTION_KEYS.sort()).toEqual(
      ["cash_register", "inventory", "kitchen", "pos", "receipts", "transactions"].sort()
    );
  });
});

describe("parsePermissions", () => {
  it("reads an object, keeping only exact true", () => {
    const p = parsePermissions({ pos: true, inventory: false });
    expect(p.pos).toBe(true);
    expect(p.inventory).toBe(false);
  });

  it("accepts a JSON string (the column is JSONB but arrives as text)", () => {
    const p = parsePermissions('{"pos":true,"kitchen":true}');
    expect(p.pos).toBe(true);
    expect(p.kitchen).toBe(true);
    expect(p.inventory).toBe(false);
  });

  // Truthiness is NOT enough. "true", 1 and "yes" all mean an upstream bug,
  // and granting on them would hand out the pricing permission by accident.
  it("requires the literal boolean true — truthy values do NOT grant", () => {
    const p = parsePermissions({ pos: "true", inventory: 1, receipts: "yes" });
    expect(p.pos).toBe(false);
    expect(p.inventory).toBe(false);
    expect(p.receipts).toBe(false);
  });

  it("returns all-false for anything unparseable, rather than throwing", () => {
    for (const bad of ["{not json", null, undefined, 42, "", []]) {
      const p = parsePermissions(bad);
      expect(SECTION_KEYS.every((k) => p[k] === false)).toBe(true);
    }
  });

  // The bug this function exists to prevent: three hand-written copies of the
  // key list meant a NEW section arrived as undefined at any copy not updated.
  it("always returns a value for EVERY section, never undefined", () => {
    const p = parsePermissions({ pos: true });
    for (const key of SECTION_KEYS) {
      expect(typeof p[key]).toBe("boolean");
    }
  });

  it("ignores keys that are not sections", () => {
    const p = parsePermissions({ pos: true, admin: true, superuser: true });
    expect(p.pos).toBe(true);
    expect(p.admin).toBeUndefined();
  });
});

describe("default / full permissions", () => {
  it("defaults deny every section", () => {
    const d = getDefaultPermissions();
    expect(SECTION_KEYS.every((k) => d[k] === false)).toBe(true);
  });

  it("full grants every section", () => {
    const f = getFullPermissions();
    expect(SECTION_KEYS.every((k) => f[k] === true)).toBe(true);
  });
});

describe("canAccess", () => {
  const user = (perms: Record<string, boolean>) =>
    ({ id: "u", storeId: "s", username: "u", displayName: "U", isOwner: false, permissions: perms } as StoreUser);

  it("denies a null user", () => {
    expect(canAccess(null, "pos")).toBe(false);
  });

  it("grants only on exact true", () => {
    expect(canAccess(user({ pos: true }), "pos")).toBe(true);
    expect(canAccess(user({ pos: false }), "pos")).toBe(false);
    expect(canAccess(user({}), "pos")).toBe(false);
  });
});

describe("mergeFeaturesWithDefaults", () => {
  it("fills every registered flag, so a new flag has a value for existing stores", () => {
    const merged = mergeFeaturesWithDefaults({});
    for (const key of Object.keys(FEATURES)) {
      expect(typeof merged[key]).toBe("boolean");
    }
  });

  it("keeps a stored boolean, including an explicit false", () => {
    const merged = mergeFeaturesWithDefaults({ pos: false });
    expect(merged.pos).toBe(false);
  });

  it("falls back to the declared default for non-boolean stored values", () => {
    const merged = mergeFeaturesWithDefaults({ pos: "yes" as unknown as boolean });
    expect(merged.pos).toBe(FEATURES.pos.default);
  });

  it("handles null and undefined", () => {
    for (const input of [null, undefined]) {
      const merged = mergeFeaturesWithDefaults(input);
      expect(Object.keys(merged).sort()).toEqual(Object.keys(FEATURES).sort());
    }
  });

  it("drops unregistered keys", () => {
    const merged = mergeFeaturesWithDefaults({ not_a_flag: true } as Record<string, boolean>);
    expect(merged.not_a_flag).toBeUndefined();
  });
});

describe("FEATURE_PRESETS", () => {
  // CLAUDE.md §7: handlePresetChange overwrites the WHOLE flags object, so a
  // preset that omits a key silently means something other than it reads as.
  it("EVERY preset enumerates EVERY registered flag", () => {
    const all = Object.keys(FEATURES).sort();
    for (const [name, preset] of Object.entries(FEATURE_PRESETS)) {
      expect({ preset: name, keys: Object.keys(preset.features).sort() })
        .toEqual({ preset: name, keys: all });
    }
  });
});
