// =============================================
// Tactile / audible feedback
//
// Lives outside BarcodeScanner.tsx on purpose. The POS page needs the scan
// beep, but BarcodeScanner statically imports @zxing/library (~420KB), so
// importing the sound from there would drag the whole decoder into the
// critical bundle and defeat lazy-loading the scanner.
// =============================================

/**
 * A single shared AudioContext, created lazily on first use.
 *
 * This used to construct `new AudioContext()` on every scan and never close
 * it. Browsers cap concurrent contexts (~6 in Chrome), so after a short
 * scanning burst every subsequent beep threw and was swallowed — the audible
 * scan confirmation silently died exactly when a cashier is scanning fastest.
 */
let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;

  try {
    if (!audioCtx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return null;
      audioCtx = new Ctor();
    }

    // Autoplay policy: a context created before any user gesture starts
    // "suspended". Every call attempts a resume, so the first tap or scan
    // after load unlocks audio for the rest of the session.
    if (audioCtx.state === "suspended") {
      void audioCtx.resume().catch(() => {});
    }

    return audioCtx;
  } catch {
    return null;
  }
}

/** Short square-wave blip. `frequency` in Hz, `duration` in seconds. */
function beep(frequency: number, duration: number, volume = 0.1): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);
    gainNode.gain.setValueAtTime(volume, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
    oscillator.start();
    oscillator.stop(ctx.currentTime + duration);
  } catch (e) {
    console.warn("Audio feedback failed:", e);
  }
}

/** Haptic pulse. Silently ignored where unsupported (all of iOS Safari). */
export function vibrate(pattern: number | number[]): void {
  try {
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate(pattern);
    }
  } catch {
    // Some browsers throw if called without a user gesture.
  }
}

/**
 * Unlock audio on the first user gesture.
 * Call this from a real interaction (tap/keydown) so the very first scan
 * beeps instead of being swallowed by the autoplay policy.
 */
export function primeFeedback(): void {
  getAudioContext();
}

/** Item successfully scanned and added to the cart. */
export function playSuccessSound(): void {
  beep(1500, 0.07);
  vibrate(60);
}

/** Scan matched no product, or an action failed. Lower and longer than success. */
export function playErrorSound(): void {
  beep(320, 0.18, 0.12);
  vibrate([50, 40, 50]);
}

/** Sale completed. A two-tone rise, distinct from a per-item scan. */
export function playCompleteSound(): void {
  beep(880, 0.09);
  setTimeout(() => beep(1320, 0.12), 90);
  vibrate([40, 30, 80]);
}
