/**
 * ZARA V1.1 — §5-6 screen awareness tests.
 *
 * Covers: structured context normalization, the meaningful-change detector
 * (§5: only meaningful changes become events), capability states (§4), and
 * the §24 privacy double-gate (off by default; observations dropped unless
 * BOTH the user toggle and the OS permission are on).
 */
import { describe, it, expect, vi } from "vitest";
import {
  ScreenChangeDetector, ScreenContextProvider, normalizeScreenContext,
  classifyScreen, extractEntities, textSimilarity
} from "../src/perception/ScreenContext";
import { EventBus } from "../src/core/events/EventBus";
import { Diagnostics } from "../src/core/logging/Diagnostics";
import {
  resolveScreenCapability, canCapabilityTransition, isCapabilityActive
} from "../src/perception/capabilities";

function diag(): Diagnostics { return new Diagnostics(); }

const YT = (text: string, at = 1_000_000) => ({
  packageName: "com.google.android.youtube",
  appLabel: "YouTube",
  className: "com.google.android.youtube.player.PlayerActivity",
  text,
  at
});

describe("§6 structured screen context", () => {
  it("normalizes a raw observation into the structured contract", () => {
    const c = normalizeScreenContext(YT("RTX 5090 Review — Best GPU of 2026"));
    expect(c.app).toBe("YouTube");
    expect(c.packageName).toBe("com.google.android.youtube");
    expect(c.screenType).toBe("video");
    expect(c.userActivity).toContain("watching");
    expect(c.confidence).toBeGreaterThan(0.6);
    expect(c.visibleText.length).toBeLessThanOrEqual(200);
    expect(c.detectedEntities.length).toBeGreaterThan(0);
    expect(c.detectedEntities.join(" ")).toContain("RTX 5090");
  });

  it("classifies search screens separately from video players", () => {
    const search = classifyScreen({
      packageName: "com.google.android.youtube",
      appLabel: "YouTube",
      className: "com.google.android.youtube.SearchActivity",
      text: "search",
      at: 0
    });
    expect(search.screenType).toBe("search");
    expect(search.userActivity).toContain("searching");
  });

  it("extracts entity-like tokens and drops stop tokens", () => {
    const e = extractEntities("The best of RTX 5090 | and the new www test");
    expect(e.some(x => x.includes("RTX 5090"))).toBe(true);
    expect(e.some(x => /^www$/i.test(x))).toBe(false);
  });

  it("text similarity identifies the same screen vs a new one", () => {
    expect(textSimilarity("RTX 5090 Review Best GPU", "RTX 5090 Review Best GPU")).toBeGreaterThan(0.9);
    expect(textSimilarity("RTX 5090 Review Best GPU", "Cooking pasta with tomatoes")).toBeLessThan(0.3);
  });
});

describe("§5 screen change detector", () => {
  it("emits the first observation of a session", () => {
    const d = new ScreenChangeDetector();
    const change = d.observe(YT("RTX 5090 Review"));
    expect(change).not.toBeNull();
    expect(change!.reason).toContain("first screen observation");
    expect(change!.perceptionEventId).toMatch(/^pe_/);
  });

  it("emits when the APP changes (YouTube → Chrome)", () => {
    const d = new ScreenChangeDetector();
    d.observe(YT("RTX 5090 Review", 1_000_000));
    const change = d.observe({
      packageName: "com.android.chrome",
      appLabel: "Chrome",
      className: "com.google.android.apps.chrome.Main",
      text: "GPU benchmarks compared",
      at: 1_010_000
    });
    expect(change).not.toBeNull();
    expect(change!.reason).toContain("app changed");
    expect(change!.current.app).toBe("Chrome");
  });

  it("suppresses same-screen scroll/refresh noise (§41 #10 irrelevant change)", () => {
    const d = new ScreenChangeDetector();
    d.observe(YT("RTX 5090 Review — full analysis of the card", 1_000_000));
    // Same app, same screen type, nearly identical title 2s later → noise.
    const change = d.observe(YT("RTX 5090 Review — full analysis of card", 1_002_000));
    expect(change).toBeNull();
  });

  it("emits when the same app moves to a genuinely new screen", () => {
    const d = new ScreenChangeDetector();
    d.observe(YT("RTX 5090 Review — full analysis of the card", 1_000_000));
    const change = d.observe(YT("How to build a gaming PC from scratch", 1_030_000));
    expect(change).not.toBeNull();
    expect(change!.reason).toContain("new screen content");
  });

  it("never observes ZARA herself, SystemUI, or keyboards", () => {
    const d = new ScreenChangeDetector();
    expect(d.observe({ packageName: "com.zara.companion", appLabel: "ZARA", className: ".MainActivity", text: "hello", at: 1 })).toBeNull();
    expect(d.observe({ packageName: "com.android.systemui", appLabel: "SystemUI", className: ".Recents", text: "", at: 2 })).toBeNull();
    expect(d.observe({ packageName: "com.google.android.inputmethod.latin", appLabel: "Gboard", className: ".Keyboard", text: "a", at: 3 })).toBeNull();
  });
});

describe("§4 capability states", () => {
  it("resolves honestly from platform + setting + permission", () => {
    expect(resolveScreenCapability({ platformSupported: false, userEnabled: true, permissionGranted: true })).toBe("unavailable");
    expect(resolveScreenCapability({ platformSupported: true, userEnabled: false, permissionGranted: false })).toBe("off");
    expect(resolveScreenCapability({ platformSupported: true, userEnabled: true, permissionGranted: false })).toBe("permission_required");
    expect(resolveScreenCapability({ platformSupported: true, userEnabled: true, permissionGranted: true })).toBe("active");
  });

  it("only active capabilities are 'active'", () => {
    expect(isCapabilityActive({ id: "x", label: "x", state: "active", detail: "" })).toBe(true);
    expect(isCapabilityActive({ id: "x", label: "x", state: "off", detail: "" })).toBe(false);
    expect(isCapabilityActive({ id: "x", label: "x", state: "permission_required", detail: "" })).toBe(false);
  });
});

describe("§4 provider privacy gate (§41 #7/#8)", () => {
  it("is OFF by default and DROPS observations while off", () => {
    const bus = new EventBus();
    const provider = new ScreenContextProvider(bus, diag());
    provider.configure({ platformSupported: true, userEnabled: false, permissionGranted: false });
    expect(provider.screenCapability.state).toBe("off");
    expect(provider.observe(YT("RTX 5090"))).toBeNull(); // hard gate
    expect(isCapabilityActive(provider.screenCapability)).toBe(false);
  });

  it("emits SCREEN_CONTEXT_CHANGED only when active", () => {
    const bus = new EventBus();
    const provider = new ScreenContextProvider(bus, diag());
    provider.configure({ platformSupported: true, userEnabled: true, permissionGranted: true });
    expect(provider.screenCapability.state).toBe("active");

    const events: unknown[] = [];
    bus.on("SCREEN_CONTEXT_CHANGED", e => events.push(e));
    const change = provider.observe(YT("RTX 5090 Review"));
    expect(change).not.toBeNull();
    expect(events).toHaveLength(1);
    const payload = events[0] as { app: string; screenType: string; detectedEntities: string[]; perceptionEventId: string };
    expect(payload.app).toBe("YouTube");
    expect(payload.screenType).toBe("video");
    expect(payload.perceptionEventId).toBe(change!.perceptionEventId);
  });

  it("reports permission_required when enabled but the OS permission is missing", () => {
    const bus = new EventBus();
    const provider = new ScreenContextProvider(bus, diag());
    provider.configure({ platformSupported: true, userEnabled: true, permissionGranted: false });
    expect(provider.screenCapability.state).toBe("permission_required");
    expect(provider.observe(YT("anything"))).toBeNull(); // still gated
  });

  it("emits CAPABILITY_CHANGED on state transitions", () => {
    const bus = new EventBus();
    const provider = new ScreenContextProvider(bus, diag());
    const events: unknown[] = [];
    bus.on("CAPABILITY_CHANGED", e => events.push(e));
    provider.configure({ platformSupported: true, userEnabled: false, permissionGranted: false });
    provider.configure({ platformSupported: true, userEnabled: true, permissionGranted: true });
    expect(events).toHaveLength(2); // unavailable→off, off→active
    const last = events[events.length - 1] as { capability: string; state: string };
    expect(last.capability).toBe("screen_awareness");
    expect(last.state).toBe("active");
  });

  it("capability transitions are guarded", () => {
    expect(canCapabilityTransition("unavailable", "active")).toBe(false);
    expect(canCapabilityTransition("off", "active")).toBe(true);
    expect(canCapabilityTransition("active", "off")).toBe(true);
    expect(canCapabilityTransition("active", "active")).toBe(false); // not a change
  });
});
