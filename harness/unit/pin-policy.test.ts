// =============================================
// Characterization: src/lib/auth/pinPolicy.ts
//
// The PIN is the fast way back into a live till, and it is compared on the
// device. The throttle is therefore the only thing standing between an
// unattended counter and someone walking through 10,000 combinations, so the
// properties pinned here are the ones that would be expensive to get wrong:
//
//   - a cooldown must not be an oracle (a CORRECT guess while cold still fails)
//   - a cooldown must expire, and expiring must restore a full set of attempts
//   - a device clock moving backwards must not brick the PIN forever
//
// Pure: no storage, no DOM, `now` is always injected.
// =============================================

import { describe, it, expect } from "vitest";
import {
  evaluatePin,
  isWeakPin,
  isWellFormedPin,
  cooldownRemaining,
  attemptsRemaining,
  PIN_MAX_ATTEMPTS,
  PIN_COOLDOWN_MS,
  PIN_LENGTH,
  type PinState,
} from "@/lib/auth/pinPolicy";

const NOW = 1_756_000_000_000;
const PIN = "8317";

const withPin = (extra: Partial<PinState> = {}): PinState => ({ pin: PIN, ...extra });

describe("isWellFormedPin", () => {
  it("accepts exactly four digits", () => {
    expect(isWellFormedPin("0000")).toBe(true);
    expect(isWellFormedPin(PIN)).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isWellFormedPin("123")).toBe(false);
    expect(isWellFormedPin("12345")).toBe(false);
    expect(isWellFormedPin("12a4")).toBe(false);
    expect(isWellFormedPin("")).toBe(false);
    expect(isWellFormedPin(" 123")).toBe(false);
  });

  it("agrees with PIN_LENGTH", () => {
    expect(isWellFormedPin("9".repeat(PIN_LENGTH))).toBe(true);
    expect(isWellFormedPin("9".repeat(PIN_LENGTH + 1))).toBe(false);
  });
});

describe("isWeakPin", () => {
  it("blocks what a stranger tries first", () => {
    for (const weak of ["0000", "1111", "1234", "4321", "1212", "2580"]) {
      expect(isWeakPin(weak)).toBe(true);
    }
  });

  it("leaves an ordinary PIN alone", () => {
    expect(isWeakPin(PIN)).toBe(false);
    expect(isWeakPin("4907")).toBe(false);
  });
});

describe("evaluatePin — the happy path", () => {
  it("accepts the right PIN and clears the counters", () => {
    const { verdict, next } = evaluatePin(
      withPin({ pinFailedAttempts: 3 }),
      PIN,
      NOW
    );
    expect(verdict.ok).toBe(true);
    expect(next.pinFailedAttempts).toBe(0);
    expect(next.pinLockedUntil).toBeUndefined();
    expect(next.pin).toBe(PIN);
  });

  it("reports no_entry when the device has never seen the account", () => {
    const { verdict } = evaluatePin(null, PIN, NOW);
    expect(verdict).toEqual({ ok: false, reason: "no_entry" });
  });

  it("reports no_pin when the account is cached but has no PIN", () => {
    const { verdict } = evaluatePin({}, PIN, NOW);
    expect(verdict).toEqual({ ok: false, reason: "no_pin" });
  });
});

describe("evaluatePin — the throttle", () => {
  it("counts a wrong PIN and says how many are left", () => {
    const { verdict, next } = evaluatePin(withPin(), "0000", NOW);
    expect(verdict).toEqual({
      ok: false,
      reason: "wrong",
      attemptsRemaining: PIN_MAX_ATTEMPTS - 1,
      lockedUntil: null,
    });
    expect(next.pinFailedAttempts).toBe(1);
    expect(next.pinLockedUntil).toBeUndefined();
  });

  it("goes cold on the last allowed attempt", () => {
    let state: PinState = withPin();
    let last = evaluatePin(state, "0000", NOW);

    for (let i = 1; i < PIN_MAX_ATTEMPTS; i++) {
      state = last.next;
      last = evaluatePin(state, "0000", NOW);
    }

    expect(last.verdict).toEqual({
      ok: false,
      reason: "wrong",
      attemptsRemaining: 0,
      lockedUntil: NOW + PIN_COOLDOWN_MS,
    });
    expect(last.next.pinLockedUntil).toBe(NOW + PIN_COOLDOWN_MS);
  });

  it("refuses even the CORRECT pin while cold, and does not compare it", () => {
    // This is the property that stops the cooldown being an oracle: if a right
    // answer behaved differently from a wrong one during a cooldown, the
    // cooldown would tell an attacker when they had found the PIN.
    const cold = withPin({ pinLockedUntil: NOW + 30_000 });

    const right = evaluatePin(cold, PIN, NOW);
    const wrong = evaluatePin(cold, "0000", NOW);

    expect(right.verdict).toEqual({
      ok: false,
      reason: "cooldown",
      retryAfterMs: 30_000,
    });
    expect(right.verdict).toEqual(wrong.verdict);
    // And guessing while cold costs nothing — the deadline does not extend.
    expect(right.next.pinLockedUntil).toBe(NOW + 30_000);
    expect(wrong.next.pinLockedUntil).toBe(NOW + 30_000);
  });

  it("lets the right PIN through once the cooldown expires", () => {
    const expired = withPin({ pinLockedUntil: NOW - 1 });
    const { verdict, next } = evaluatePin(expired, PIN, NOW);
    expect(verdict.ok).toBe(true);
    expect(next.pinLockedUntil).toBeUndefined();
  });

  it("restores a FULL set of attempts after a cooldown, not a single one", () => {
    // The counter is zeroed alongside the deadline, so someone who waits out a
    // cooldown is not locked out again by their very next mistake.
    const expired = withPin({ pinLockedUntil: NOW - 1, pinFailedAttempts: 0 });
    const { verdict } = evaluatePin(expired, "0000", NOW);
    expect(verdict).toEqual({
      ok: false,
      reason: "wrong",
      attemptsRemaining: PIN_MAX_ATTEMPTS - 1,
      lockedUntil: null,
    });
  });
});

describe("evaluatePin — a clock that moved", () => {
  it("treats an impossible deadline as corrupt and lets the attempt through", () => {
    // A deadline further out than one whole cooldown cannot have been written
    // by this code: the device clock went BACKWARDS after it was stored. Left
    // alone, a mis-set year would lock the PIN out until the year arrived.
    const skewed = withPin({ pinLockedUntil: NOW + PIN_COOLDOWN_MS * 500 });
    const { verdict, next } = evaluatePin(skewed, PIN, NOW);
    expect(verdict.ok).toBe(true);
    expect(next.pinLockedUntil).toBeUndefined();
  });

  it("still applies the attempt counter on a skewed clock", () => {
    const skewed = withPin({ pinLockedUntil: NOW + PIN_COOLDOWN_MS * 500 });
    const { verdict } = evaluatePin(skewed, "0000", NOW);
    expect(verdict).toEqual({
      ok: false,
      reason: "wrong",
      attemptsRemaining: PIN_MAX_ATTEMPTS - 1,
      lockedUntil: null,
    });
  });
});

describe("the display helpers agree with the decision", () => {
  it("cooldownRemaining is zero when live and positive when cold", () => {
    expect(cooldownRemaining(withPin(), NOW)).toBe(0);
    expect(cooldownRemaining(withPin({ pinLockedUntil: NOW + 5_000 }), NOW)).toBe(5_000);
    expect(cooldownRemaining(withPin({ pinLockedUntil: NOW - 5_000 }), NOW)).toBe(0);
    // Same skew rule as evaluatePin, or the UI would show a countdown the pad
    // does not actually enforce.
    expect(
      cooldownRemaining(withPin({ pinLockedUntil: NOW + PIN_COOLDOWN_MS * 500 }), NOW)
    ).toBe(0);
  });

  it("attemptsRemaining counts down from the maximum", () => {
    expect(attemptsRemaining(null)).toBe(PIN_MAX_ATTEMPTS);
    expect(attemptsRemaining(withPin())).toBe(PIN_MAX_ATTEMPTS);
    expect(attemptsRemaining(withPin({ pinFailedAttempts: 2 }))).toBe(
      PIN_MAX_ATTEMPTS - 2
    );
    expect(attemptsRemaining(withPin({ pinFailedAttempts: 99 }))).toBe(0);
  });
});
