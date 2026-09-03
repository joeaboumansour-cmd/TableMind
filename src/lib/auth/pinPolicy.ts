// =============================================
// PIN policy — pure decision logic for the quick-unlock PIN.
//
// No storage, no DOM, no clock of its own: `now` is always passed in. Every
// rule that would be expensive to get wrong lives here so it can be pinned by
// harness/unit/pin-policy.test.ts without a browser.
//
// ## What this protects against, and what it does not
//
// The PIN is compared in plaintext against a value in localStorage, sitting
// beside the plaintext password that offlineAuth.ts has always cached there
// (audit P0-4). Anyone who can read the PIN out of storage can read the
// password next to it, so hashing the PIN would buy nothing.
//
// The threat that IS real is a person tapping guesses on a till left
// unattended on a counter. Four digits is 10,000 combinations, which a patient
// stranger can walk through. That is what the throttle below is for, and why
// it is the load-bearing part of this file.
// =============================================

export const PIN_LENGTH = 4;

/** Wrong guesses allowed before the pad goes cold. */
export const PIN_MAX_ATTEMPTS = 5;

/**
 * How long the pad stays cold. Flat, with no escalation.
 *
 * 5 tries a minute against 10,000 combinations is roughly 33 hours to an even
 * chance, and the password path is open the whole time — so a longer or
 * escalating cooldown would buy almost nothing while making the till
 * unpredictable for the cashier who genuinely fat-fingered twice.
 */
export const PIN_COOLDOWN_MS = 60_000;

/**
 * The PINs a stranger actually tries first. Blocked outright at setup rather
 * than warned about: with only five attempts, allowing 1234 hands the till to
 * the first person who thinks of it, and the denylist is short enough that the
 * friction is negligible.
 */
export const WEAK_PINS: readonly string[] = [
  "0000", "1111", "2222", "3333", "4444",
  "5555", "6666", "7777", "8888", "9999",
  "1234", "2345", "3456", "4567", "5678", "6789",
  "4321", "9876", "0123",
  "1212", "2121", "1122", "1313", "6969", "2580",
];

const WEAK_SET = new Set(WEAK_PINS);

/** Exactly PIN_LENGTH characters, every one a digit. */
export function isWellFormedPin(pin: string): boolean {
  return typeof pin === "string" && new RegExp(`^[0-9]{${PIN_LENGTH}}$`).test(pin);
}

export function isWeakPin(pin: string): boolean {
  return WEAK_SET.has(pin);
}

/**
 * The throttle state carried on a cached credential entry. Every field is
 * optional — an entry written before PINs existed has none of them, and that
 * must read as "no PIN", never as an error.
 */
export interface PinState {
  pin?: string;
  pinFailedAttempts?: number;
  pinLockedUntil?: number;
}

export type PinVerdict =
  | { ok: true }
  /** No cached credential for this (store, person) at all. */
  | { ok: false; reason: "no_entry" }
  /** Cached, but this person has not set a PIN on this device. */
  | { ok: false; reason: "no_pin" }
  | { ok: false; reason: "cooldown"; retryAfterMs: number }
  | { ok: false; reason: "wrong"; attemptsRemaining: number; lockedUntil: number | null };

/**
 * Decide one PIN attempt and return the state to persist.
 *
 * Callers MUST write `next` back even on failure — that is where the attempt
 * counter and the cooldown deadline live. Returning them rather than mutating
 * keeps this function pure and testable.
 */
export function evaluatePin(
  state: PinState | null,
  pin: string,
  now: number
): { verdict: PinVerdict; next: PinState } {
  if (!state) {
    return { verdict: { ok: false, reason: "no_entry" }, next: {} };
  }

  const current: PinState = {
    pin: state.pin,
    pinFailedAttempts: state.pinFailedAttempts,
    pinLockedUntil: state.pinLockedUntil,
  };

  if (!current.pin) {
    return { verdict: { ok: false, reason: "no_pin" }, next: current };
  }

  // ---- Clock-skew guard -------------------------------------------------
  //
  // A deadline further out than one whole cooldown cannot have been written by
  // this code. It means the device clock moved BACKWARDS after the deadline
  // was stored — an NTP correction, a flat CMOS battery on an old till, a
  // manual date change. Without this the PIN would be bricked until the clock
  // caught up, which on a mis-set year is forever. Treat it as corrupt, clear
  // it, and let the attempt proceed; the attempt counter still applies.
  const skewed =
    typeof current.pinLockedUntil === "number" &&
    current.pinLockedUntil > now + PIN_COOLDOWN_MS;
  if (skewed) {
    current.pinLockedUntil = undefined;
  }

  // ---- Cooldown ---------------------------------------------------------
  //
  // The PIN is NOT compared here. Guessing during a cooldown must cost nothing
  // and reveal nothing — including when the guess happens to be right, which
  // would otherwise turn the cooldown into an oracle.
  if (typeof current.pinLockedUntil === "number" && current.pinLockedUntil > now) {
    return {
      verdict: {
        ok: false,
        reason: "cooldown",
        retryAfterMs: current.pinLockedUntil - now,
      },
      next: current,
    };
  }

  // An expired deadline is spent — drop it so it cannot be read as live later.
  if (typeof current.pinLockedUntil === "number") {
    current.pinLockedUntil = undefined;
  }

  if (current.pin === pin) {
    return {
      verdict: { ok: true },
      next: { pin: current.pin, pinFailedAttempts: 0, pinLockedUntil: undefined },
    };
  }

  const attempts = (current.pinFailedAttempts ?? 0) + 1;

  if (attempts >= PIN_MAX_ATTEMPTS) {
    const lockedUntil = now + PIN_COOLDOWN_MS;
    return {
      verdict: { ok: false, reason: "wrong", attemptsRemaining: 0, lockedUntil },
      // Counter zeroed alongside the deadline: once the cooldown expires the
      // person gets a fresh set of attempts rather than being locked out again
      // on their next single mistake.
      next: { pin: current.pin, pinFailedAttempts: 0, pinLockedUntil: lockedUntil },
    };
  }

  return {
    verdict: {
      ok: false,
      reason: "wrong",
      attemptsRemaining: PIN_MAX_ATTEMPTS - attempts,
      lockedUntil: null,
    },
    next: { pin: current.pin, pinFailedAttempts: attempts, pinLockedUntil: undefined },
  };
}

/** Milliseconds left on a cooldown, or 0 when the pad is live. */
export function cooldownRemaining(state: PinState | null, now: number): number {
  if (!state || typeof state.pinLockedUntil !== "number") return 0;
  if (state.pinLockedUntil > now + PIN_COOLDOWN_MS) return 0; // skewed clock
  return Math.max(0, state.pinLockedUntil - now);
}

/** Attempts left before the pad goes cold. PIN_MAX_ATTEMPTS when untouched. */
export function attemptsRemaining(state: PinState | null): number {
  const used = state?.pinFailedAttempts ?? 0;
  return Math.max(0, PIN_MAX_ATTEMPTS - used);
}
