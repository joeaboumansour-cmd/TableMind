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

/**
 * Cross-tab connectivity channel.
 *
 * Connectivity used to be strictly per-tab: each tab ran its own heartbeat and
 * kept its own answer. But the offline QUEUE is shared — every tab reads the
 * same IndexedDB — so one tab could sit showing "Offline" with sales it
 * believed were queued while another tab, on the same device and the same
 * network, had already pushed them. Observed live during the 2026-08-25 drill.
 *
 * Tabs now share what they learn. A probe result is broadcast, and a tab that
 * hears a fresher result than its own adopts it instead of waiting up to 15s
 * for its own heartbeat. The network belongs to the device, not to a tab.
 */
const CONNECTIVITY_CHANNEL = "goldensquirrel_connectivity";

/** Ignore broadcasts older than this; a stale verdict is worse than none. */
const BROADCAST_MAX_AGE_MS = 20000;

class Connectivity {
  private _status: ConnectivityStatus = "online";
  private listeners: Set<ConnectivityListener> = new Set();
  private heartbeatId: ReturnType<typeof setInterval> | null = null;
  private probing = false;
  private initialized = false;
  private channel: BroadcastChannel | null = null;
  /** When this tab last established status by its OWN probe. */
  private lastProbeAt = 0;

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

    // Adopt what sibling tabs have already learned about the device's network.
    if (typeof BroadcastChannel !== "undefined") {
      try {
        this.channel = new BroadcastChannel(CONNECTIVITY_CHANNEL);
        this.channel.onmessage = (event) => {
          const msg = event.data as { status?: ConnectivityStatus; at?: number };
          if (!msg?.status || typeof msg.at !== "number") return;
          // Only adopt a verdict that is fresh AND newer than our own probe —
          // otherwise two tabs could flip each other back and forth.
          if (Date.now() - msg.at > BROADCAST_MAX_AGE_MS) return;
          if (msg.at <= this.lastProbeAt) return;
          this.lastProbeAt = msg.at;
          this.setStatus(msg.status, { broadcast: false });
        };
      } catch {
        this.channel = null; // not fatal — fall back to per-tab heartbeats
      }
    }

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

    // Suspend the heartbeat while the app is backgrounded. A POS runs all day
    // on a battery-powered handheld; polling /api/health every 15s while the
    // screen is off is pure drain and tells us nothing, because we re-probe
    // immediately on becoming visible anyway.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        this.startHeartbeat();
        this.probe();
      } else {
        this.stopHeartbeat();
      }
    });

    // Start periodic heartbeat (only if we're actually in the foreground)
    if (document.visibilityState === "visible") {
      this.startHeartbeat();
    }

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

  private setStatus(
    status: ConnectivityStatus,
    opts: { broadcast?: boolean } = {}
  ): void {
    const { broadcast = true } = opts;
    if (this._status === status) return;
    const previous = this._status;
    this._status = status;
    console.log(`[Connectivity] Status changed: ${previous} -> ${status}`);
    this.notify();

    // Tell the other tabs, so the whole device agrees rather than each tab
    // discovering the outage on its own schedule.
    if (broadcast && this.channel) {
      try {
        this.channel.postMessage({ status, at: this.lastProbeAt || Date.now() });
      } catch {
        // a closed channel is not worth failing over
      }
    }
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
      // The response body is irrelevant — reaching the server at all is the
      // signal, so even a 5xx counts as "the network is up".
      await fetch(cacheBustedUrl, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
        // Prevent the browser from using a cached response
        headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
      });

      clearTimeout(timeout);

      // Either way a response came back, so the network is reachable.
      this.lastProbeAt = Date.now();
      this.setStatus("online");
    } catch {
      // Network error / timeout / abort => offline
      this.lastProbeAt = Date.now();
      this.setStatus("offline");
    } finally {
      this.probing = false;
    }

    return this._status;
  }

  destroy(): void {
    this.stopHeartbeat();
    this.listeners.clear();
    try { this.channel?.close(); } catch { /* already closed */ }
    this.channel = null;
  }
}

// Singleton instance
export const connectivity = new Connectivity();