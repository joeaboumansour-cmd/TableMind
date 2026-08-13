// =============================================
// Connectivity Module
// Detects real internet connectivity using a
// heartbeat probe, because navigator.onLine is
// unreliable on desktop (it only reflects whether
// the OS has ANY active network interface, not
// whether the internet is actually reachable).
// =============================================

type ConnectivityStatus = "online" | "offline";
type ConnectivityListener = (status: ConnectivityStatus) => void;

const HEARTBEAT_INTERVAL_MS = 15000; // Check every 15s
const HEARTBEAT_TIMEOUT_MS = 5000; // Abort probe after 5s
const HEARTBEAT_URL = "/api/health";

class Connectivity {
  private _status: ConnectivityStatus = "online";
  private listeners: Set<ConnectivityListener> = new Set();
  private heartbeatId: ReturnType<typeof setInterval> | null = null;
  private probing = false;
  private initialized = false;

  constructor() {
    if (typeof window !== "undefined") {
      this.init();
    }
  }

  private init(): void {
    if (this.initialized) return;
    this.initialized = true;

    // Initial status from navigator (best guess until first probe completes)
    this._status = navigator.onLine ? "online" : "offline";

    // Browser events are a hint, not authoritative — always verify with a probe
    window.addEventListener("online", () => {
      console.log("[Connectivity] Browser 'online' event — verifying with probe...");
      this.probe();
    });
    window.addEventListener("offline", () => {
      console.log("[Connectivity] Browser 'offline' event — verifying with probe...");
      this.probe();
    });

    // Re-check when the tab regains focus or becomes visible
    window.addEventListener("focus", () => this.probe());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") this.probe();
    });

    // Start periodic heartbeat
    this.startHeartbeat();

    // Run an initial probe to establish true status
    this.probe();
  }

  get status(): ConnectivityStatus {
    return this._status;
  }

  get isOnline(): boolean {
    return this._status === "online";
  }

  get isOffline(): boolean {
    return this._status === "offline";
  }

  subscribe(listener: ConnectivityListener): () => void {
    this.listeners.add(listener);
    // Immediately notify with current status
    listener(this._status);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    this.listeners.forEach((l) => l(this._status));
  }

  private setStatus(status: ConnectivityStatus): void {
    if (this._status === status) return;
    const previous = this._status;
    this._status = status;
    console.log(`[Connectivity] Status changed: ${previous} -> ${status}`);
    this.notify();
  }

  private startHeartbeat(): void {
    if (this.heartbeatId) return;
    this.heartbeatId = setInterval(() => this.probe(), HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatId) {
      clearInterval(this.heartbeatId);
      this.heartbeatId = null;
    }
  }

  /**
   * Perform a real network probe. Derives status from whether the
   * request succeeds, not from navigator.onLine.
   */
  async probe(): Promise<ConnectivityStatus> {
    if (this.probing) return this._status;
    this.probing = true;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), HEARTBEAT_TIMEOUT_MS);

      // Cache-busting query param is CRITICAL — it defeats BOTH the browser
      // HTTP cache AND any service worker Cache Storage interception.
      // Without this, a cached /api/health response could make the app think
      // it's online when it's actually offline.
      const cacheBustedUrl = `${HEARTBEAT_URL}?_=${Date.now()}`;
      const response = await fetch(cacheBustedUrl, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
        // Prevent the browser from using a cached response
        headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
      });

      clearTimeout(timeout);

      if (response.ok) {
        this.setStatus("online");
      } else {
        // A response (even an error) means we have connectivity
        this.setStatus("online");
      }
    } catch {
      // Network error / timeout / abort => offline
      this.setStatus("offline");
    } finally {
      this.probing = false;
    }

    return this._status;
  }

  destroy(): void {
    this.stopHeartbeat();
    this.listeners.clear();
  }
}

// Singleton instance
export const connectivity = new Connectivity();