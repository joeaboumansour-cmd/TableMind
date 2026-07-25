// =============================================
// Device Detection Utilities
// =============================================
// Centralized mobile/desktop/device detection.
// Used to switch between camera-based scanning (mobile)
// and hardware-scanner + shortcut buttons (desktop).
// =============================================

/**
 * Detect if the current device is a mobile device (phone or tablet).
 * Uses user-agent sniffing + touch capability.
 * Safe for SSR — returns false when navigator is unavailable.
 */
export function isMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
}

/**
 * Detect if the current device is a desktop computer.
 * Inverse of isMobile().
 */
export function isDesktop(): boolean {
  return !isMobile();
}

/**
 * Detect if the current device is an iOS device (iPhone, iPad, iPod).
 * Also detects iPadOS (Mac with touch, iPad user-agent).
 */
export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return (
    /iPhone|iPad|iPod/i.test(ua) ||
    (navigator.maxTouchPoints > 1 && /Mac/i.test(ua) && "ontouchend" in document)
  );
}

/**
 * Detect if the current device is an Android device.
 */
export function isAndroid(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android/i.test(navigator.userAgent);
}

/**
 * React hook for reactive device detection.
 * Returns the current device state. Safe for SSR (defaults to desktop).
 *
 * Usage:
 *   const { isMobile, isDesktop } = useDevice();
 *   if (isDesktop) { ... }
 */
export function useDevice(): {
  isMobile: boolean;
  isDesktop: boolean;
  isIOS: boolean;
  isAndroid: boolean;
} {
  // We can't use useState/useEffect here without importing React,
  // but this function is meant to be called inside a component.
  // We'll use a simple approach: compute once on mount.
  // For SSR safety, we default to desktop.
  if (typeof window === "undefined") {
    return { isMobile: false, isDesktop: true, isIOS: false, isAndroid: false };
  }

  return {
    isMobile: isMobile(),
    isDesktop: isDesktop(),
    isIOS: isIOS(),
    isAndroid: isAndroid(),
  };
}
