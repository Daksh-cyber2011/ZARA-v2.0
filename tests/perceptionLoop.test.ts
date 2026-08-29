/**
 * ZARA V1.1 — §38 perception→memory loop + §3 pipeline integration tests.
 *
 * Covers:
 *  - meaningful screen events write temporary_context memories (30-min TTL)
 *  - repeated observation of the same topic promotes to semantic memory
 *  - the full coordinator pipeline: bus event → normalizer → significance
 *    gate → generator → onCandidates (with privacy toggles honored)
 *  - conversation-end detection after USER_SPOKE + idle
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventBus } from "../src/core/events/EventBus";
import { Diagnostics } from "../src/core/logging/Diagnostics";
import { MemoryStore } from "../src/memory/storage/MemoryStore";
import { MemoryRetriever } from "../src/memory/retrieval/MemoryRetriever";
import { PerceptionCoordinator } from "../src/perception/PerceptionCoordinator";
import { ScreenContextProvider, ScreenContext } from "../src/perception/ScreenContext";
import { DEFAULT_SETTINGS, ZaraSettings, SettingsStore } from "../src/core/configuration/Settings";
import { ProactiveCandidate } from "../src/proactivity/types";

class MemPersistence {
  data: string | null = null;
  async load() { return this.data; }
  async save(json: string) { this.data = json; }
}

class FakeSettings {
  cache: ZaraSettings;
  constructor(over: Partial<ZaraSettings> = {}) { this.cache = { ...DEFAULT_SETTINGS, ...over }; }
  get current() { return this.cache; }
}

const SCREEN: ScreenContext = {
  app: "YouTube",
  packageName: "com.google.android.youtube",
  screenType: "video",
  visibleText: "RTX 5090 Review — Best GPU",
  detectedEntities: ["RTX 5090"],
  userActivity: "watching a video",
  confidence: 0.9,
  timestamp: 1_000_000
};

function makeCoordinator(over: Partial<ZaraSettings> = {}) {
  const bus = new EventBus();
  const diag = new Diagnostics();
  const store = new MemoryStore(new MemPersistence(), diag);
  const retriever = new MemoryRetriever(store);
  const settings = new FakeSettings(over);
  const coordinator = new PerceptionCoordinator({
    bus, diag,
    settings: () => settings.current,
    memory: store,
    retriever
  });
  return { bus, diag, store, retriever, settings, coordinator };
}

describe("§38 perception → memory loop", () => {
  it("a meaningful screen context writes a temporary_context memory with 30-min TTL", async () => {
    const { bus, coordinator, store } = makeCoordinator({ screenAwareness: true });
    // Active capability required for the §38 path.
    coordinator.screen.configure({ platformSupported: true, userEnabled: true, permissionGranted: true });
    coordinator.start();

    bus.emit("SCREEN_CONTEXT_CHANGED", { ...SCREEN, perceptionEventId: "pe_1" });
    await new Promise(r => setTimeout(r, 20)); // async memory write

    const ctx = store.active().filter(m => m.type === "temporary_context");
    expect(ctx).toHaveLength(1);
    expect(ctx[0].content).toContain("RTX 5090");
    expect(ctx[0].source).toBe("perception");
    const ttl = (ctx[0].expiresAt ?? 0) - ctx[0].createdAt;
    expect(ttl).toBeGreaterThan(29 * 60 * 1000);
    expect(ttl).toBeLessThanOrEqual(31 * 60 * 1000);
    coordinator.stop();
  });

  it("repeated observation promotes to a semantic memory (7-day TTL)", async () => {
    const { bus, coordinator, store } = makeCoordinator({ screenAwareness: true });
    coordinator.screen.configure({ platformSupported: true, userEnabled: true, permissionGranted: true });
    coordinator.start();

    // Three distinct meaningful observations of the SAME topic: the user
    // searches RTX, watches an RTX video, then browses the RTX feed. Each
    // has a distinct dedupe key (package + screenType) so all three survive
    // the normalizer; the §38 loop keys on package + entity.
    bus.emit("SCREEN_CONTEXT_CHANGED", { ...SCREEN, screenType: "video", perceptionEventId: "pe_1" });
    await new Promise(r => setTimeout(r, 10));
    bus.emit("SCREEN_CONTEXT_CHANGED", { ...SCREEN, screenType: "search", perceptionEventId: "pe_2" });
    await new Promise(r => setTimeout(r, 10));
    bus.emit("SCREEN_CONTEXT_CHANGED", { ...SCREEN, screenType: "feed", perceptionEventId: "pe_3" });
    await new Promise(r => setTimeout(r, 30));

    const semantic = store.active().filter(m => m.type === "semantic");
    expect(semantic).toHaveLength(1);
    expect(semantic[0].content).toContain("repeatedly engages with RTX 5090");
    const ttl = (semantic[0].expiresAt ?? 0) - semantic[0].createdAt;
    expect(ttl).toBeGreaterThan(6 * 24 * 3600 * 1000);
    coordinator.stop();
  });

  it("does NOT write perception memories when memory is disabled (§11)", async () => {
    const { bus, coordinator, store } = makeCoordinator({ memoryEnabled: false });
    coordinator.screen.configure({ platformSupported: true, userEnabled: true, permissionGranted: true });
    coordinator.start();
    bus.emit("SCREEN_CONTEXT_CHANGED", { ...SCREEN, perceptionEventId: "pe_1" });
    await new Promise(r => setTimeout(r, 20));
    expect(store.all()).toHaveLength(0);
    coordinator.stop();
  });
});

describe("§3 coordinator pipeline (bus → normalizer → generator)", () => {
  it("generates candidates for significant events and hands them to the runtime", async () => {
    const { bus, coordinator } = makeCoordinator();
    const received: { candidates: ProactiveCandidate[]; kind: string }[] = [];
    coordinator.onCandidates = (candidates, event) => {
      received.push({ candidates, kind: event.kind });
    };
    coordinator.start();

    bus.emit("BATTERY_CHANGED", { level: 0.15, charging: false });
    expect(received).toHaveLength(1);
    expect(received[0].kind).toBe("BATTERY_CHANGED");
    expect(received[0].candidates[0].source).toBe("battery");
    coordinator.stop();
  });

  it("duplicate events are normalized once (§41 #24)", () => {
    const { bus, coordinator } = makeCoordinator();
    const received: ProactiveCandidate[][] = [];
    coordinator.onCandidates = c => received.push(c);
    coordinator.start();

    bus.emit("BATTERY_CHANGED", { level: 0.15, charging: false });
    bus.emit("BATTERY_CHANGED", { level: 0.15, charging: false });
    bus.emit("BATTERY_CHANGED", { level: 0.15, charging: false });
    expect(received).toHaveLength(1);
    coordinator.stop();
  });

  it("insignificant events never reach generation (§35 silence default)", () => {
    const { bus, coordinator } = makeCoordinator();
    const received: ProactiveCandidate[][] = [];
    coordinator.onCandidates = c => received.push(c);
    coordinator.start();

    bus.emit("BATTERY_CHANGED", { level: 0.55, charging: false }); // healthy → 0.15 significance
    bus.emit("NETWORK_CHANGED", { online: true });
    expect(received).toHaveLength(0);
    coordinator.stop();
  });

  it("screen candidates require BOTH appAwareness and screenAwareness (§24)", () => {
    const { bus, coordinator } = makeCoordinator(); // screenAwareness defaults OFF
    const received: ProactiveCandidate[][] = [];
    coordinator.onCandidates = c => received.push(c);
    coordinator.start();

    bus.emit("SCREEN_CONTEXT_CHANGED", { ...SCREEN, perceptionEventId: "pe_1" });
    expect(received).toHaveLength(0); // gated by settings
    coordinator.stop();
  });

  it("screen candidates flow when awareness is enabled (§41 #8)", async () => {
    const { bus, coordinator, store } = makeCoordinator({ screenAwareness: true, appAwareness: true });
    await store.ensureLoaded();
    await store.applyTransaction({
      action: "ADD", type: "project",
      content: "The user is comparing GPUs for a new build", importance: 0.85
    }, "conversation");
    const received: ProactiveCandidate[][] = [];
    coordinator.onCandidates = c => received.push(c);
    coordinator.screen.configure({ platformSupported: true, userEnabled: true, permissionGranted: true });
    coordinator.start();

    bus.emit("SCREEN_CONTEXT_CHANGED", { ...SCREEN, perceptionEventId: "pe_1" });
    expect(received).toHaveLength(1);
    // §37 fusion: "RTX 5090" on screen + "comparing GPUs" memory → fused candidate.
    expect(received[0][0].source).toBe("memory_relevance");
    expect(received[0][0].draft).toMatch(/GPU/i);
    coordinator.stop();
  });

  it("proactivity disabled stops all generation", () => {
    const { bus, coordinator } = makeCoordinator({ proactivityEnabled: false });
    const received: ProactiveCandidate[][] = [];
    coordinator.onCandidates = c => received.push(c);
    coordinator.start();
    bus.emit("BATTERY_CHANGED", { level: 0.15, charging: false });
    expect(received).toHaveLength(0);
    coordinator.stop();
  });
});

describe("§3 conversation-end detection", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("emits CONVERSATION_ENDED after 90s of silence following user turns", () => {
    const { bus, coordinator } = makeCoordinator();
    const ended: unknown[] = [];
    bus.on("CONVERSATION_ENDED", e => ended.push(e));
    coordinator.start();

    bus.emit("USER_SPOKE", { text: "hello" });
    bus.emit("USER_SPOKE", { text: "working on VaaniX" });
    vi.advanceTimersByTime(91 * 1000);

    expect(ended).toHaveLength(1);
    const payload = ended[0] as { turns: number; idleMs: number };
    expect(payload.turns).toBe(2);
    coordinator.stop();
  });

  it("new speech re-arms the timer (no premature end)", () => {
    const { bus, coordinator } = makeCoordinator();
    const ended: unknown[] = [];
    bus.on("CONVERSATION_ENDED", e => ended.push(e));
    coordinator.start();

    bus.emit("USER_SPOKE", { text: "hello" });
    vi.advanceTimersByTime(60 * 1000);
    bus.emit("USER_SPOKE", { text: "still here" });
    vi.advanceTimersByTime(60 * 1000);
    expect(ended).toHaveLength(0);
    vi.advanceTimersByTime(31 * 1000);
    expect(ended).toHaveLength(1);
    coordinator.stop();
  });
});

describe("§4 capability snapshot", () => {
  it("reports honest capability states for diagnostics", () => {
    const { coordinator } = makeCoordinator();
    const caps = coordinator.capabilities();
    const ids = caps.map(c => c.id);
    expect(ids).toContain("screen_awareness");
    expect(ids).toContain("app_awareness");
    expect(ids).toContain("device_context");
    expect(ids).toContain("notification_awareness");
    // Notification awareness is honestly unavailable.
    const notif = caps.find(c => c.id === "notification_awareness")!;
    expect(notif.state).toBe("unavailable");
  });
});
