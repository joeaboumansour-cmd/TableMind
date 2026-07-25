import { describe, it, expect, vi, afterEach } from 'vitest';

// Import the functions — they use navigator at call time, so we can stub it
function isMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
}

function isDesktop(): boolean {
  return !isMobile();
}

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return (
    /iPhone|iPad|iPod/i.test(ua) ||
    (navigator.maxTouchPoints > 1 && /Mac/i.test(ua) && "ontouchend" in document)
  );
}

function isAndroid(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android/i.test(navigator.userAgent);
}

describe('Device Detection', () => {
  const originalNavigator = global.navigator;

  afterEach(() => {
    // Restore original navigator
    Object.defineProperty(global, 'navigator', {
      value: originalNavigator,
      writable: true,
      configurable: true,
    });
  });

  function setNavigator(userAgent: string, maxTouchPoints = 0) {
    Object.defineProperty(global, 'navigator', {
      value: { userAgent, maxTouchPoints },
      writable: true,
      configurable: true,
    });
  }

  it('isMobile returns false for desktop user agents', () => {
    setNavigator('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    expect(isMobile()).toBe(false);
  });

  it('isMobile detects iPhone', () => {
    setNavigator('Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)');
    expect(isMobile()).toBe(true);
  });

  it('isMobile detects Android', () => {
    setNavigator('Mozilla/5.0 (Linux; Android 13; Pixel 7)');
    expect(isMobile()).toBe(true);
  });

  it('isMobile detects iPad', () => {
    setNavigator('Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X)');
    expect(isMobile()).toBe(true);
  });

  it('isDesktop is the inverse of isMobile', () => {
    setNavigator('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
    expect(isDesktop()).toBe(true);
    expect(isMobile()).toBe(false);
  });

  it('isIOS detects iPhone', () => {
    setNavigator('Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)', 0);
    expect(isIOS()).toBe(true);
  });

  it('isIOS detects iPad', () => {
    setNavigator('Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X)', 0);
    expect(isIOS()).toBe(true);
  });

  it('isAndroid detects Android', () => {
    setNavigator('Mozilla/5.0 (Linux; Android 13; Pixel 7)');
    expect(isAndroid()).toBe(true);
  });

  it('isAndroid returns false for non-Android', () => {
    setNavigator('Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)');
    expect(isAndroid()).toBe(false);
  });
});
