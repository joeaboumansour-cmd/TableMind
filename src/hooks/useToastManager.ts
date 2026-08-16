"use client";

import { useMemo } from "react";
import { toast as appToast, type ToastOptions } from "@/lib/toast";

/**
 * Thin hook wrapper over the shared throttled toast in `@/lib/toast`.
 *
 * The throttling itself deliberately does NOT live here. It used to, in a Map
 * created inside the hook body — which meant a fresh, empty map on every
 * render, so nothing was ever actually throttled on a screen that re-renders
 * on every scan. The state is module-level now; this hook only supplies a
 * default quiet period and a stable object identity.
 */
export function useToastManager(options: { throttleMs?: number } = {}) {
  const { throttleMs } = options;

  return useMemo(() => {
    const withDefault = (opts?: ToastOptions): ToastOptions => ({
      ...(throttleMs !== undefined ? { throttleMs } : null),
      ...opts,
    });

    return {
      toast: {
        success: (message: string, opts?: ToastOptions) =>
          appToast.success(message, withDefault(opts)),
        error: (message: string, opts?: ToastOptions) =>
          appToast.error(message, withDefault(opts)),
        info: (message: string, opts?: ToastOptions) =>
          appToast.info(message, withDefault(opts)),
        warning: (message: string, opts?: ToastOptions) =>
          appToast.warning(message, withDefault(opts)),
        loading: (message: string, opts?: ToastOptions) =>
          appToast.loading(message, withDefault(opts)),
        dismiss: (keyOrId?: string | number) => appToast.dismiss(keyOrId),
      },
    };
  }, [throttleMs]);
}
