"use client";

// =============================================
// Toasts
//
// A drop-in replacement for sonner's `toast` that cannot spam.
//
// Two guards, because either one alone leaks:
//
//   1. A time window per group key. An identical message inside the window is
//      dropped outright — "Product not found" fired five times is one event,
//      not five.
//   2. A STABLE sonner id per group key. If two calls race past the time check
//      (or the message changes mid-burst), sonner updates the toast already on
//      screen instead of stacking a second one. Scanning ten items fast shows
//      one toast whose text keeps changing, not a wall of ten.
//
// The dedup state is module-level ON PURPOSE. The previous implementation kept
// it in a Map created inside the hook body, so every render produced a fresh
// empty map and nothing was ever throttled — which is exactly what the spam
// was. It also has to be shared: the user sees one toast stack, so throttling
// scoped per component would still let two components double up.
// =============================================

import { toast as sonner } from "sonner";
import type { ExternalToast } from "sonner";

/** Default quiet period for a repeat of the same toast. */
const DEFAULT_THROTTLE_MS = 1800;

/** Entries older than this are dropped so the map cannot grow unbounded. */
const FORGET_AFTER_MS = 15_000;

export type ToastOptions = ExternalToast & {
  /**
   * Group key. Toasts sharing a key replace each other rather than stacking.
   * Defaults to the message, which dedups identical text; pass an explicit key
   * to collapse a whole *class* of message (e.g. every "Added <product>").
   */
  key?: string;
  /** Override the quiet period for this call. */
  throttleMs?: number;
};

type ToastKind = "success" | "error" | "info" | "warning" | "loading";

type Tracked = { id: string | number; at: number; message: string };

const recent = new Map<string, Tracked>();

function prune(now: number): void {
  for (const [key, entry] of recent) {
    if (now - entry.at > FORGET_AFTER_MS) recent.delete(key);
  }
}

function emit(kind: ToastKind, message: string, options: ToastOptions = {}) {
  const { key, throttleMs = DEFAULT_THROTTLE_MS, ...rest } = options;
  const now = Date.now();
  prune(now);

  const groupKey = key ?? `${kind}:${message}`;
  const previous = recent.get(groupKey);

  // Identical message, still inside the quiet period — nothing new to say.
  if (previous && previous.message === message && now - previous.at < throttleMs) {
    return previous.id;
  }

  // Reuse the id so sonner treats this as an update of the toast already on
  // screen. A caller-supplied id always wins.
  const id = rest.id ?? previous?.id ?? `gs_${groupKey}`;

  recent.set(groupKey, { id, at: now, message });
  return sonner[kind](message, { ...rest, id });
}

export const toast = {
  success: (message: string, options?: ToastOptions) => emit("success", message, options),
  error: (message: string, options?: ToastOptions) => emit("error", message, options),
  info: (message: string, options?: ToastOptions) => emit("info", message, options),
  warning: (message: string, options?: ToastOptions) => emit("warning", message, options),
  loading: (message: string, options?: ToastOptions) => emit("loading", message, options),

  /**
   * Dismiss by group key OR by raw sonner id, so callers can dismiss the same
   * thing they created — `toast.loading(msg, { key: "scan" })` is cleared by
   * `toast.dismiss("scan")` without knowing the generated id.
   */
  dismiss: (keyOrId?: string | number) => {
    if (keyOrId === undefined) {
      recent.clear();
      return sonner.dismiss();
    }
    const tracked = recent.get(String(keyOrId));
    recent.delete(String(keyOrId));
    return sonner.dismiss(tracked?.id ?? keyOrId);
  },
};
