/**
 * ZARA V1.1 — Screen context awareness (Directive §4-6).
 *
 * ZARA notices what is happening on the user's screen ONLY through a
 * legitimate Android mechanism: an AccessibilityService reporting
 * window-state changes (app + window title + class) — structured metadata,
 * never screenshots, never OCR, never unrestricted surveillance.
 *
 * Pipeline (§5):
 *   Permission → Capture → Normalize → Diff → Meaningful Change Detector
 *   → SCREEN_CONTEXT_CHANGED event
 *
 * Privacy (§24): screen awareness is OFF by default. It activates only when
 * BOTH the user's ZARA toggle is on AND the Android accessibility service is
 * enabled. When either gate closes, no events flow and the provider reports
 * honestly (capability state), so the model can never assume it.
 */
import { EventBus } from "../core/events/EventBus";
import { Diagnostics } from "../core/logging/Diagnostics";
import {
  CapabilityState, PerceptionCapability,
  resolveScreenCapability
} from "./capabilities";

/** §6 structured screen context — never a raw screenshot. */
export interface ScreenContext {
  /** Human app label, e.g. "YouTube". */
  app: string;
  /** Android package, e.g. "com.google.android.youtube". */
  packageName: string;
  /** Coarse screen classification (heuristic, confidence-scored). */
  screenType:
    | "video" | "search" | "feed" | "article" | "chat"
    | "settings" | "game" | "home" | "unknown";
  /** Bounded window title / visible text fragment (≤200 chars). */
  visibleText: string;
  /** Entity-ish tokens extracted from the title (e.g. ["RTX 5090"]). */
  detectedEntities: string[];
  /** What the user is probably doing, one short phrase. */
  userActivity: string;
  /** 0..1 — how sure the provider is about this snapshot. */
  confidence: number;
  /** Epoch ms of the observation. */
  timestamp: number;
}

/** Raw observation arriving from the Android accessibility service. */
export interface ScreenObservation {
  packageName: string;
  appLabel: string;
  className: string;
  text: string;            // window title / event text, already bounded by Java side
  at: number;
}

/** Screen-change detection result (§5 — only meaningful changes surface). */
export interface ScreenChange {
  perceptionEventId: string;
  previous: ScreenContext | null;
  current: ScreenContext;
  reason: string;          // why this change counts as meaningful
}

const STOP_TOKENS = new Set([
  "the", "and", "for", "with", "you", "your", "this", "that", "from", "have",
  "has", "are", "was", "were", "new", "all", "how", "what", "why", "when",
  "com", "www", "http", "https", "app", "android", "google", "inc", "youtube"
]);

/** Extract entity-like tokens from a window title ("RTX 5090 Review — Best GPU?" → ["RTX 5090"]). */
export function extractEntities(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[|\-–—·•:()\[\]]+/)) {
    const seg = raw.trim();
    if (!seg || seg.length < 3 || seg.length > 40) continue;
    const words = seg.split(/\s+/);
    // Keep segments that look like names/products: capitalized, digits, ALLCAPS
    const looksEntity = words.some(w =>
      /^[A-Z0-9]/.test(w) && (w.length > 2 || /\d/.test(w)) || /^[A-Z0-9]{2,}$/.test(w)
    );
    if (!looksEntity) continue;
    if (words.every(w => STOP_TOKENS.has(w.toLowerCase()))) continue;
    out.push(seg.replace(/\s+/g, " ").slice(0, 40));
    if (out.length >= 5) break;
  }
  return out;
}

/** Coarse screen classification from package/class/title signals. */
export function classifyScreen(obs: ScreenObservation): {
  screenType: ScreenContext["screenType"];
  userActivity: string;
  confidence: number;
} {
  const pkg = obs.packageName.toLowerCase();
  const cls = obs.className.toLowerCase();
  const text = obs.text.toLowerCase();
  let confidence = 0.55;

  // Package-level knowledge (honest heuristics, not special access)
  const videoApps = ["youtube", "netflix", "primevideo", "hotstar", "jiocinema", "mxplayer", "vimeo"];
  const chatApps = ["whatsapp", "telegram", "discord", "slack", "instagram", "messenger", "signal"];
  const gameApps = ["game", "playgend", "supercell", "krafton", "activision"];

  if (videoApps.some(a => pkg.includes(a))) {
    if (cls.includes("search") || text.includes("search")) {
      return { screenType: "search", userActivity: "searching videos", confidence: 0.8 };
    }
    if (cls.includes("player") || cls.includes("video") || text.includes("now playing")) {
      return { screenType: "video", userActivity: "watching a video", confidence: 0.9 };
    }
    return { screenType: "feed", userActivity: "browsing videos", confidence: 0.75 };
  }
  if (chatApps.some(a => pkg.includes(a))) {
    return { screenType: "chat", userActivity: "messaging", confidence: 0.85 };
  }
  if (gameApps.some(a => pkg.includes(a))) {
    return { screenType: "game", userActivity: "playing a game", confidence: 0.8 };
  }
  if (pkg.includes("settings") || pkg.includes("calculator") || pkg.includes("clock")) {
    return { screenType: "settings", userActivity: "in device settings", confidence: 0.8 };
  }
  // Class-name signals for anything else
  if (cls.includes("search")) { confidence = 0.7; return { screenType: "search", userActivity: "searching", confidence }; }
  if (cls.includes("browser") || cls.includes("webview") || pkg.includes("browser") || pkg.includes("chrome")) {
    if (cls.includes("article") || text.length > 40) {
      return { screenType: "article", userActivity: "reading an article", confidence: 0.65 };
    }
    return { screenType: "search", userActivity: "browsing the web", confidence: 0.6 };
  }
  if (pkg.includes("launcher") || pkg.includes("home")) {
    return { screenType: "home", userActivity: "on the home screen", confidence: 0.85 };
  }
  return { screenType: "unknown", userActivity: `using ${obs.appLabel}`, confidence: 0.5 };
}

/** Word-set similarity used by the meaningful-change detector. */
export function textSimilarity(a: string, b: string): number {
  const ta = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const tb = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const w of ta) if (tb.has(w)) inter++;
  return inter / (ta.size + tb.size - inter);
}

/** Normalize a raw observation into the §6 structured contract. */
export function normalizeScreenContext(obs: ScreenObservation): ScreenContext {
  const { screenType, userActivity, confidence } = classifyScreen(obs);
  const visibleText = obs.text.replace(/\s+/g, " ").trim().slice(0, 200);
  return {
    app: obs.appLabel || obs.packageName,
    packageName: obs.packageName,
    screenType,
    visibleText,
    detectedEntities: extractEntities(visibleText),
    userActivity,
    confidence,
    timestamp: obs.at
  };
}

/**
 * §5 SCREEN CHANGE DETECTOR — decides whether a new observation is a
 * MEANINGFUL change worth an event. Suppressed as noise:
 *   - changes to the same screen (scroll/refresh) within the quiet window
 *   - same package + same screenType + near-identical title text
 *   - the companion's own app (she doesn't watch herself)
 *   - keyboard/IME and system UI packages
 */
export class ScreenChangeDetector {
  /** Same-screen suppression window (ms) — scroll/typing noise. */
  sameScreenQuietMs = 3000;
  /** Jaccard threshold above which titles count as "the same screen". */
  sameTextThreshold = 0.62;
  /** Packages never observed (privacy + noise). */
  static IGNORED_PACKAGES = new Set([
    "com.android.systemui", "com.android.inputmethod", "com.zara.companion"
  ]);
  /** Keyboard/IME package prefixes never observed (they vary by vendor). */
  static IGNORED_PACKAGE_PREFIXES = [
    "com.google.android.inputmethod",
    "com.android.inputmethod",
    "com.iflytek.inputmethod",
    "com.samsung.android.honeyboard",
    "com.touchtype.swiftkey"
  ];

  private last: ScreenContext | null = null;
  private lastEventAt = 0;

  constructor(private ownPackage = "com.zara.companion") {}

  /** Feed the next raw observation; returns a meaningful change or null. */
  observe(obs: ScreenObservation): ScreenChange | null {
    if (ScreenChangeDetector.IGNORED_PACKAGES.has(obs.packageName)) return null;
    if (ScreenChangeDetector.IGNORED_PACKAGE_PREFIXES.some(p => obs.packageName.startsWith(p))) return null;
    if (obs.packageName === this.ownPackage) return null;

    const current = normalizeScreenContext(obs);

    if (!this.last) {
      this.last = current;
      this.lastEventAt = obs.at;
      return {
        perceptionEventId: "pe_" + obs.at.toString(36) + "_" + Math.random().toString(36).slice(2, 6),
        previous: null,
        current,
        reason: "first screen observation of the session"
      };
    }

    const prev = this.last;
    const pkgChanged = prev.packageName !== current.packageName;
    const typeChanged = prev.screenType !== current.screenType;
    const sameScreenQuiet = obs.at - this.lastEventAt < this.sameScreenQuietMs;
    const textSim = textSimilarity(prev.visibleText, current.visibleText);
    const textChanged = !current.visibleText && !prev.visibleText
      ? false
      : textSim < this.sameTextThreshold;

    let reason: string | null = null;
    if (pkgChanged) reason = `app changed (${prev.app} → ${current.app})`;
    else if (typeChanged && !sameScreenQuiet) reason = `screen type changed (${prev.screenType} → ${current.screenType})`;
    else if (textChanged && !sameScreenQuiet) reason = "new screen content in the same app";

    if (!reason) {
      // Not meaningful: keep fresher text/timestamp but do not emit.
      this.last = current;
      return null;
    }

    this.last = current;
    this.lastEventAt = obs.at;
    return {
      perceptionEventId: "pe_" + obs.at.toString(36) + "_" + Math.random().toString(36).slice(2, 6),
      previous: prev,
      current,
      reason
    };
  }

  /** Current known screen context (null before the first observation). */
  get current(): ScreenContext | null { return this.last; }

  reset(): void { this.last = null; this.lastEventAt = 0; }
}

/**
 * ScreenContextProvider — owns the permission-gated pipeline and exposes the
 * §4 capability state. Observations from the Android accessibility service
 * are DROPPED unless the capability is genuinely "active".
 */
export class ScreenContextProvider {
  readonly detector = new ScreenChangeDetector();
  private capability: PerceptionCapability = {
    id: "screen_awareness",
    label: "Screen awareness",
    state: "unavailable",
    detail: "Not initialized."
  };
  private platformSupported = false;
  private permissionGranted = false;
  private userEnabled = false;
  private lastChange: ScreenChange | null = null;

  constructor(private bus: EventBus, private diag: Diagnostics) {}

  /** Configure from real probe results (platform + OS permission + setting). */
  configure(input: {
    platformSupported: boolean;
    permissionGranted: boolean;
    userEnabled: boolean;
  }): void {
    this.platformSupported = input.platformSupported;
    this.permissionGranted = input.permissionGranted;
    this.userEnabled = input.userEnabled;
    this.updateCapability("reconfigured");
  }

  private updateCapability(why: string): void {
    const state: CapabilityState = resolveScreenCapability({
      platformSupported: this.platformSupported,
      userEnabled: this.userEnabled,
      permissionGranted: this.permissionGranted
    });
    if (state === this.capability.state) return;
    const detail = capabilityDetail(state);
    this.capability = { ...this.capability, state, detail };
    this.bus.emit("CAPABILITY_CHANGED", {
      capability: this.capability.id, state, detail
    });
    this.diag.log("perception", "CAPABILITY", {
      capability: this.capability.id, state, why
    });
    if (state !== "active") this.detector.reset();
  }

  get screenCapability(): PerceptionCapability { return this.capability; }
  get isEnabled(): boolean { return this.capability.state === "active"; }
  get current(): ScreenContext | null { return this.detector.current; }
  get lastScreenChange(): ScreenChange | null { return this.lastChange; }

  /** Feed one raw observation (from the native plugin). Permission-gated. */
  observe(obs: ScreenObservation): ScreenChange | null {
    if (!this.isEnabled) return null; // hard privacy gate — events dropped
    const change = this.detector.observe(obs);
    if (!change) return null;
    this.lastChange = change;
    this.bus.emit("SCREEN_CONTEXT_CHANGED", {
      app: change.current.app,
      packageName: change.current.packageName,
      screenType: change.current.screenType,
      visibleText: change.current.visibleText,
      detectedEntities: change.current.detectedEntities,
      userActivity: change.current.userActivity,
      confidence: change.current.confidence,
      timestamp: change.current.timestamp,
      perceptionEventId: change.perceptionEventId
    });
    this.diag.log("perception", "SCREEN_CHANGE", {
      app: change.current.app, type: change.current.screenType,
      reason: change.reason, confidence: change.current.confidence
    });
    return change;
  }
}

function capabilityDetail(state: CapabilityState): string {
  switch (state) {
    case "unavailable":
      return "Not supported on this platform (Android accessibility service required).";
    case "off":
      return "Off by default — enable in Settings › Awareness (§24 privacy).";
    case "permission_required":
      return "Enabled in ZARA, but the Android accessibility permission is still needed.";
    case "active":
      return "Active — structured app/screen context events are flowing.";
  }
}
