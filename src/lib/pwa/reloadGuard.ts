/**
 * reloadGuard — a registry of "do not reload the page right now" holds.
 *
 * Why this exists:
 *   A new service worker can take control at any moment (see PWAUpdateListener),
 *   and applying it means a full `location.reload()`. That is fine on an idle
 *   screen and destructive in the middle of a task: it wiped a cashier's bulk
 *   selection on the inventory screen, because the only guard was "is the cart
 *   empty" — and on inventory the cart is ALWAYS empty.
 *
 *   "Is the cart empty" was the wrong question. The right one is "is anybody
 *   part-way through something", and only each screen can answer that. So
 *   screens register a hold while they are busy, and the update waits.
 *
 * Deliberately plain module state, not React state: the update listener needs
 * to read the answer from an event handler, and non-component code may need to
 * hold too. Holds are keyed by an opaque id so two screens holding for the same
 * reason cannot release each other.
 */

type Listener = () => void;

const holds = new Map<number, string>();
const listeners = new Set<Listener>();
let nextId = 1;

function notify() {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // A broken listener must not stop the others from being told.
    }
  }
}

/**
 * Hold off any pending page reload. Returns the release function — call it when
 * the task finishes. Releasing twice is safe and does nothing the second time.
 */
export function holdReload(reason: string): () => void {
  const id = nextId++;
  holds.set(id, reason);
  return () => {
    if (holds.delete(id) && holds.size === 0) {
      notify();
    }
  };
}

/** True while any screen is mid-task and a reload would lose work. */
export function isReloadHeld(): boolean {
  return holds.size > 0;
}

/** The reasons currently blocking a reload. For debugging from the console. */
export function heldReasons(): string[] {
  return Array.from(holds.values());
}

/**
 * Notified when the LAST hold clears — i.e. the moment a deferred reload
 * becomes safe to apply. Not called for intermediate releases while other
 * holds remain.
 */
export function subscribeReloadGuard(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
