/**
 * ZARA V1.0 — Perception service (Directive §25-27).
 *
 * Permission-aware, battery-conscious device signals ONLY. ZARA never
 * claims perception she does not have (§27): V1.0 signals are battery,
 * connectivity, time, and own-app lifecycle — all obtainable with normal
 * permissions. No fabricated screen awareness, no notification spying.
 */
import { EventBus } from "../core/events/EventBus";
import { Diagnostics } from "../core/logging/Diagnostics";

export interface PerceptionSnapshot {
  batteryLevel: number | null;
  charging: boolean | null;
  online: boolean;
  foreground: boolean;
  localTime: string;
  lastUserInteraction: number;   // epoch ms of last user interaction with ZARA
}

export class PerceptionService {
  private snap: PerceptionSnapshot = {
    batteryLevel: null,
    charging: null,
    online: typeof navigator !== "undefined" ? navigator.onLine : true,
    foreground: true,
    localTime: new Date().toISOString(),
    lastUserInteraction: Date.now()
  };
  private started = false;
  private unsubscribers: (() => void)[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private awaySince: number | null = null;

  constructor(private bus: EventBus, private diag: Diagnostics) {}

  get snapshot(): Readonly<PerceptionSnapshot> { return this.snap; }

  /** Human-readable perception lines for the avatar/UX. */
  describe(): string[] {
    const out: string[] = [];
    if (this.snap.batteryLevel !== null) {
      out.push(`Battery ${Math.round(this.snap.batteryLevel)}%${this.snap.charging ? " (charging)" : ""}`);
    }
    out.push(this.snap.online ? "Online" : "Offline");
    out.push(this.snap.foreground ? "In foreground" : "In background");
    return out;
  }

  noteUserInteraction(): void {
    const wasAway = this.awaySince !== null;
    this.snap.lastUserInteraction = Date.now();
    if (wasAway) {
      const awayMs = Date.now() - (this.awaySince as number);
      this.awaySince = null;
      if (awayMs > 60000) this.bus.emit("USER_RETURNED", { awayMs });
    }
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    // --- Battery (real Battery Status API where available) ---
    const nav = navigator as Navigator & {
      getBattery?: () => Promise<{ level: number; charging: boolean;
        addEventListener(ev: string, fn: () => void): void }>;
    };
    if (nav.getBattery) {
      try {
        const b = await nav.getBattery();
        this.snap.batteryLevel = b.level;
        this.snap.charging = b.charging;
        const sync = () => {
          const levelChanged = this.snap.batteryLevel !== b.level;
          const chargingChanged = this.snap.charging !== b.charging;
          this.snap.batteryLevel = b.level;
          this.snap.charging = b.charging;
          if (levelChanged || chargingChanged) {
            this.bus.emit("BATTERY_CHANGED", { level: b.level, charging: b.charging });
          }
        };
        b.addEventListener("levelchange", sync);
        b.addEventListener("chargingchange", sync);
        this.unsubscribers.push(() => { /* browser API has no removal in shim */ });
      } catch { /* battery API unavailable → stays null (honest) */ }
    }

    // --- Connectivity (browser APIs only where they exist — §44 honest degradation) ---
    const onOnline = () => { this.snap.online = true; this.bus.emit("NETWORK_CHANGED", { online: true }); };
    const onOffline = () => { this.snap.online = false; this.bus.emit("NETWORK_CHANGED", { online: false }); };
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener("online", onOnline);
      window.addEventListener("offline", onOffline);
      this.unsubscribers.push(() => {
        window.removeEventListener("online", onOnline);
        window.removeEventListener("offline", onOffline);
      });
    }

    // --- App lifecycle (Capacitor App plugin on device; page visibility on web) ---
    try {
      const { App } = await import("@capacitor/app");
      const handle = await App.addListener("appStateChange", ({ isActive }) => {
        const wasForeground = this.snap.foreground;
        this.snap.foreground = isActive;
        if (isActive && !wasForeground) this.bus.emit("APP_CHANGED", { foreground: true });
        if (!isActive && wasForeground) {
          this.bus.emit("APP_CHANGED", { foreground: false });
          this.awaySince = Date.now();
        }
        this.diag.log("perception", "APP_STATE", { foreground: isActive });
      });
      this.unsubscribers.push(() => { void handle.remove(); });
    } catch { /* web preview → visibility API fallback below */ }

    const onVis = () => {
      const fg = document.visibilityState === "visible";
      const was = this.snap.foreground;
      this.snap.foreground = fg;
      if (fg !== was) this.bus.emit("APP_CHANGED", { foreground: fg });
    };
    if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
      document.addEventListener("visibilitychange", onVis);
      this.unsubscribers.push(() => document.removeEventListener("visibilitychange", onVis));
    }

    // --- Clock + idle detection (1-minute tick, cheap) ---
    this.timer = setInterval(() => {
      this.snap.localTime = new Date().toISOString();
      const idleMs = Date.now() - this.snap.lastUserInteraction;
      if (idleMs > 5 * 60000 && !this.idleEmitted) {
        this.idleEmitted = true;
        this.bus.emit("USER_IDLE", { idleMs });
      }
      if (idleMs < 5 * 60000) this.idleEmitted = false;
      if (this.awaySince === null && idleMs > 60000) this.awaySince = Date.now() - idleMs;
    }, 60000);

    this.diag.log("perception", "STARTED", {
      batteryApi: this.snap.batteryLevel !== null,
      signals: ["battery", "network", "lifecycle", "time", "idle"]
    });
  }

  private idleEmitted = false;

  stop(): void {
    for (const u of this.unsubscribers) { try { u(); } catch { /* noop */ } }
    this.unsubscribers = [];
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.started = false;
  }
}
