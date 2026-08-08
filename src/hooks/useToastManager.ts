"use client";

import { toast } from "sonner";

type ToastOptions = {
  /** Unique key for deduplication. Defaults to the message itself. */
  key?: string;
  /** Minimum milliseconds before the same toast can be shown again. */
  throttleMs?: number;
  /** Sonner toast id for updating/dismissing a specific toast */
  id?: string | number;
};

type PendingToast = {
  id: string;
  message: string;
  timestamp: number;
};

const DEFAULT_THROTTLE = 1500;

/**
 * Wraps `sonner` toast calls with per-message throttling so identical
 * toasts (e.g. "Product X is already in cart") cannot spam the UI.
 *
 * Usage:
 *   const { toast } = useToastManager({ throttleMs: 1000 });
 *   toast.info("already in cart"); // shows
 *   toast.info("already in cart"); // suppressed for 1s
 */
export function useToastManager(options: { throttleMs?: number } = {}) {
  const throttleMs = options.throttleMs ?? DEFAULT_THROTTLE;
  const seen = new Map<string, PendingToast>();
  const tickerRef = { current: null as ReturnType<typeof setTimeout> | null };

  const cleanExpired = () => {
    const now = Date.now();
    for (const [key, entry] of seen.entries()) {
      if (now - entry.timestamp > throttleMs) {
        seen.delete(key);
      }
    }
  };

  const buildToast = (
    type: "success" | "error" | "info" | "warning" | "loading",
    message: string,
    opts: ToastOptions = {}
  ) => {
    const key = opts.key ?? message;
    cleanExpired();

    const now = Date.now();
    const last = seen.get(key);

    if (last && now - last.timestamp < throttleMs) {
      // Same toast fired too soon — silently ignore.
      // If it was a loading toast, keep dismissing so we don't leave stale spinners.
      if (type === "loading") {
        toast.dismiss(last.id);
      }
      return last.id;
    }

    const id = crypto.randomUUID?.() ?? String(now);

    // Persist the toast id so we can update/dismiss it later.
    seen.set(key, { id, message, timestamp: now });

    // Auto-clean from the seen map once it's allowed to re-fire.
    if (tickerRef.current) clearTimeout(tickerRef.current);
    tickerRef.current = setTimeout(() => {
      const entry = seen.get(key);
      if (entry && entry.id === id) {
        seen.delete(key);
      }
    }, throttleMs);

    const result = (toast[type] as any)(message, { id });

    return result;
  };

  return {
    toast: {
      success: (message: string, opts?: ToastOptions) =>
        buildToast("success", message, opts),
      error: (message: string, opts?: ToastOptions) =>
        buildToast("error", message, opts),
      info: (message: string, opts?: ToastOptions) =>
        buildToast("info", message, opts),
      warning: (message: string, opts?: ToastOptions) =>
        buildToast("warning", message, opts),
      loading: (message: string, opts?: ToastOptions) =>
        buildToast("loading", message, opts),
      dismiss: (toastId?: string | number) => toast.dismiss(toastId),
    },
  };
}