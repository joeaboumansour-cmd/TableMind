// =============================================
// Characterization: src/lib/pos/lineKey.ts
//
// Invariant #18 — lineKey() is the ONLY way to address a cart line.
//
// The property that matters: for a plain retail line the key IS the product
// id, so a retail store cannot observe any difference from before lanes and
// made-to-order existed. That is what let `line_uid` stay optional and the
// persist version stay at 1.
// =============================================

import { describe, it, expect } from "vitest";
import { lineKey, newLineUid, isConfiguredLine } from "@/lib/pos/lineKey";

describe("lineKey", () => {
  it("is the product id for a plain line", () => {
    expect(lineKey({ product_id: "prod-1", line_uid: undefined })).toBe("prod-1");
  });

  it("is the line_uid when one is present", () => {
    expect(lineKey({ product_id: "prod-1", line_uid: "line:abc" })).toBe("line:abc");
  });

  // Two configured lines of the SAME product must be separately addressable,
  // or editing one edits the other.
  it("distinguishes two lines of the same product", () => {
    const a = { product_id: "menu", line_uid: "line:a" };
    const b = { product_id: "menu", line_uid: "line:b" };
    expect(lineKey(a)).not.toBe(lineKey(b));
  });

  it("falls back to product_id when line_uid is explicitly undefined", () => {
    // `??` not `||`, so an empty string would be kept — but nothing mints one.
    expect(lineKey({ product_id: "p", line_uid: undefined })).toBe("p");
  });
});

describe("newLineUid", () => {
  it("is prefixed so it can never collide with a product UUID", () => {
    const uid = newLineUid();
    expect(uid.startsWith("line:")).toBe(true);
  });

  it("is unique per call", () => {
    expect(newLineUid()).not.toBe(newLineUid());
  });
});

describe("isConfiguredLine", () => {
  it("is true by kind or by the presence of a uid", () => {
    expect(isConfiguredLine({ line_kind: "configured", line_uid: undefined })).toBe(true);
    expect(isConfiguredLine({ line_kind: undefined, line_uid: "line:x" })).toBe(true);
  });

  it("is false for a plain line", () => {
    expect(isConfiguredLine({ line_kind: undefined, line_uid: undefined })).toBe(false);
  });
});
