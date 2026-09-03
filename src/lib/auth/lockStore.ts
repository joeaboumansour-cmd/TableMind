"use client";

// =============================================
// lockStore — "the till is locked" as module state.
//
// ## Why locking is not a route
//
// A /lock route would unmount the (shell) subtree. Zustand would persist the
// cart, but everything the lock exists to preserve is in memory: the scanner's
// MediaStream, the lane derivation done by onRehydrateStorage, checkout's typed
// amounts, open sheets, in-flight fetches. Lock must FREEZE the app, not
// navigate away from it — so it is an overlay (LockScreenHost, mounted in
// providers.tsx) over a tree that stays exactly where it was.
//
// ## Why module state and not a context
//
// Two reasons, both concrete:
//
//   1. Non-React code has to read it. The window-level keydown handlers on
//      /checkout and /pos stay mounted underneath the overlay, and one of them
//      completes a sale on F4. They call isLocked() directly.
//   2. A new context provider wrapping the app would re-render the entire tree
//      on lock, which is precisely the cost the overlay exists to avoid.
//
// Same idiom as connectivity, reloadGuard and useIsDesktop.
// =============================================

import { useSyncExternalStore } from "react";

const LOCK_KEY = "goldensquirrel_lock_v1";

export interface LockContext {
  /** Which store's roster the lock screen should offer. */
  storeUsername: string;
  /** Who locked it, so the PIN pad opens straight on them. */
  username: string;
  lockedAt: number;
}

type Listener = () => void;

const listeners = new Set<Listener>();

/** `undefined` means "not read from storage yet". `null` means "not locked". */
let state: LockContext | null | undefined = undefined;

function read(): LockContext | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LOCK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LockContext;
    if (parsed && typeof parsed.storeUsername === "string") return parsed;
    return null;
  } catch {
    // A lock we cannot parse is not a lock. Failing OPEN here is deliberate:
    // the app underneath is still gated by its own auth checks, whereas a lock
    // screen nobody can dismiss is a till that cannot sell.
    return null;
  }
}

function ensure(): LockContext | null {
  if (state === undefined) state = read();
  return state;
}

function notify() {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // One broken subscriber must not stop the others being told.
    }
  }
}

export function lockSession(ctx: Omit<LockContext, "lockedAt">): void {
  state = { ...ctx, lockedAt: Date.now() };
  try {
    localStorage.setItem(LOCK_KEY, JSON.stringify(state));
  } catch {
    // Storage full or blocked: the lock still holds for this page life, it
    // just will not survive a reload. Better than refusing to lock at all.
  }
  notify();
}

export function unlockSession(): void {
  state = null;
  try {
    localStorage.removeItem(LOCK_KEY);
  } catch {
    // ignore
  }
  notify();
}

/** Readable from outside React — the keydown guards depend on this. */
export function isLocked(): boolean {
  return ensure() !== null;
}

export function getLockContext(): LockContext | null {
  return ensure();
}

export function subscribeLock(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): boolean {
  return ensure() !== null;
}

// The server never knows about a device-local lock, so it renders unlocked.
//
// ORDERING NOTE, load-bearing: that means hydration paints one unlocked frame.
// It is safe only because AuthProvider hydrates the user in a MOUNT EFFECT —
// strictly after useSyncExternalStore has re-read this client snapshot — so the
// overlay is on screen before any user data is. If AuthProvider ever hydrates
// synchronously, revisit this. The matching note is in LockScreenHost.
const getServerSnapshot = () => false;

export function useIsLocked(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function subscribe(onChange: Listener): () => void {
  return subscribeLock(onChange);
}

/** The lock context, reactively. Null whenever the till is not locked. */
export function useLockContext(): LockContext | null {
  const locked = useIsLocked();
  return locked ? getLockContext() : null;
}
