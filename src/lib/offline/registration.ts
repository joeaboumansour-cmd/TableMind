// =============================================
// Service Worker Registration Hook
// =============================================

"use client";

import { useEffect, useState, useCallback } from "react";

interface ServiceWorkerState {
  isSupported: boolean;
  isRegistered: boolean;
  registration: ServiceWorkerRegistration | null;
  error: Error | null;
  needsRefresh: boolean;
  updateAvailable: boolean;
}

export function useServiceWorker() {
  const [state, setState] = useState<ServiceWorkerState>({
    isSupported: false,
    isRegistered: false,
    registration: null,
    error: null,
    needsRefresh: false,
    updateAvailable: false,
  });

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      setState((prev) => ({ ...prev, isSupported: false }));
      return;
    }

    setState((prev) => ({ ...prev, isSupported: true }));

    const registerSW = async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
        });

        console.log("[ServiceWorker] Registered:", registration);

        registration.addEventListener("updatefound", () => {
          console.log("[ServiceWorker] New update found");
          setState((prev) => ({ ...prev, updateAvailable: true, needsRefresh: true }));
        });

        setState((prev) => ({
          ...prev,
          isRegistered: true,
          registration,
        }));

        const waitingWorker = registration.waiting;
        if (waitingWorker) {
          console.log("[ServiceWorker] Update ready");
          setState((prev) => ({ ...prev, needsRefresh: true, updateAvailable: true }));
        }

        navigator.serviceWorker.addEventListener("message", (event) => {
          console.log("[ServiceWorker] Message:", event.data);
          if (event.data && event.data.type === "SKIP_WAITING") {
            setState((prev) => ({ ...prev, needsRefresh: true }));
          }
        });

        setInterval(() => {
          registration.update();
        }, 60 * 60 * 1000);
      } catch (error) {
        console.error("[ServiceWorker] Registration failed:", error);
        setState((prev) => ({ ...prev, error: error as Error }));
      }
    };

    registerSW();
  }, []);

  const update = useCallback(() => {
    if (state.registration?.waiting) {
      state.registration.waiting.postMessage({ type: "SKIP_WAITING" });
      window.location.reload();
    }
  }, [state.registration]);

  const unregister = useCallback(async () => {
    if (state.registration) {
      const unregistered = await state.registration.unregister();
      console.log("[ServiceWorker] Unregistered:", unregistered);
      setState((prev) => ({ ...prev, isRegistered: unregistered }));
    }
  }, [state.registration]);

  return { ...state, update, unregister };
}

// =============================================
// Offline Banner Config
// =============================================

export interface OfflineBannerConfig {
  variant: "warning" | "default" | "success";
  title: string;
  description: string;
  actionLabel: string | null;
  actionDisabled: boolean;
  icon: string;
}

export function getOfflineBannerConfig(
  isOnline: boolean,
  pendingCount: number,
  isSyncing: boolean
): OfflineBannerConfig | null {
  if (isOnline && pendingCount === 0) {
    return null;
  }

  if (isOnline) {
    return {
      variant: "default",
      title: "Sync Pending",
      description: `${pendingCount} changes waiting to sync`,
      actionLabel: isSyncing ? "Syncing..." : "Sync Now",
      actionDisabled: isSyncing,
      icon: "sync",
    };
  }

  return {
    variant: "warning",
    title: "You're Offline",
    description: "Changes will sync when connection is restored",
    actionLabel: null,
    actionDisabled: true,
    icon: "wifi_off",
  };
}
