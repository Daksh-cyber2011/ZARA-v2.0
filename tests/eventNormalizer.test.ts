/**
 * ZARA V1.1 — §3 event normalizer tests.
 *
 * Covers: typed normalization, per-kind dedupe windows (§41 #24 duplicate
 * perception events), and the significance floor (§35 — insignificant
 * events are journaled but never generate candidates).
 */
import { describe, it, expect } from "vitest";
import { EventNormalizer, SIGNIFICANCE_FLOOR, NormalizedEvent } from "../src/perception/EventNormalizer";
import { Diagnostics } from "../src/core/logging/Diagnostics";

const SCREEN = {
  app: "YouTube",
  packageName: "com.google.android.youtube",
  screenType: "video",
  visibleText: "RTX 5090 Review",
  detectedEntities: ["RTX 5090"],
  userActivity: "watching a video",
  confidence: 0.9,
  timestamp: 1_000_000
};

describe("§3 EventNormalizer", () => {
  it("normalizes raw occurrences into typed events with identity", () => {
    const n = new EventNormalizer(new Diagnostics());
    const e = n.normalize("USER_RETURNED", { awayMs: 45 * 60000 });
    expect(e).not.toBeNull();
    expect(e!.kind).toBe("USER_RETURNED");
    expect(e!.id).toMatch(/^ev_/);
    expect(e!.significance).toBeGreaterThanOrEqual(SIGNIFICANCE_FLOOR);
  });

  it("drops duplicate events inside their dedupe window (§41 #24)", () => {
    const n = new EventNormalizer(new Diagnostics());
    const t = 1_000_000;
    expect(n.normalize("SCREEN_CONTEXT_CHANGED", SCREEN, t)).not.toBeNull();
    // Same package + screenType → same dedupe key → dropped.
    expect(n.normalize("SCREEN_CONTEXT_CHANGED", { ...SCREEN, visibleText: "different title" }, t + 5000)).toBeNull();
    expect(n.normalize("SCREEN_CONTEXT_CHANGED", { ...SCREEN, visibleText: "another title" }, t + 10000)).toBeNull();
    // After the 45s window the same key is fresh again.
    expect(n.normalize("SCREEN_CONTEXT_CHANGED", SCREEN, t + 46000)).not.toBeNull();
  });

  it("different reminders dedupe independently (time-critical, 1.0 significance)", () => {
    const n = new EventNormalizer(new Diagnostics());
    const t = 1_000_000;
    const a = n.normalize("REMINDER_DUE", { reminderId: "r1", content: "study physics" }, t);
    const b = n.normalize("REMINDER_DUE", { reminderId: "r2", content: "call mom" }, t + 1000);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.significance).toBe(1.0);
    expect(n.normalize("REMINDER_DUE", { reminderId: "r1", content: "study physics" }, t + 2000)).toBeNull();
  });

  it("§36 absence significance scales with away time", () => {
    const n = new EventNormalizer(new Diagnostics());
    const brief = n.normalize("USER_RETURNED", { awayMs: 20 * 1000 })!;
    const minutes = n.normalize("USER_RETURNED", { awayMs: 10 * 60 * 1000 })!;
    expect(brief.significance).toBeLessThan(SIGNIFICANCE_FLOOR); // 20s → nothing
    expect(minutes.significance).toBeGreaterThanOrEqual(SIGNIFICANCE_FLOOR);
  });

  it("battery below 20% is significant; above is not", () => {
    const n = new EventNormalizer(new Diagnostics());
    const low = n.normalize("BATTERY_CHANGED", { level: 0.15, charging: false })!;
    const ok = n.normalize("BATTERY_CHANGED", { level: 0.55, charging: false })!;
    expect(low.significance).toBeGreaterThanOrEqual(SIGNIFICANCE_FLOOR);
    expect(ok.significance).toBeLessThan(SIGNIFICANCE_FLOOR);
  });

  it("insignificant events fail the significance gate", () => {
    const n = new EventNormalizer(new Diagnostics());
    const e = n.normalize("BATTERY_CHANGED", { level: 0.55, charging: false })!;
    expect(n.isSignificant(e)).toBe(false);
    const s = n.normalize("SCREEN_CONTEXT_CHANGED", SCREEN)!;
    expect(n.isSignificant(s)).toBe(true);
  });

  it("keeps a recent-event journal for diagnostics (§25)", () => {
    const n = new EventNormalizer(new Diagnostics());
    n.normalize("USER_RETURNED", { awayMs: 45 * 60000 });
    n.normalize("SCREEN_CONTEXT_CHANGED", SCREEN);
    expect(n.recentEvents.length).toBe(2);
    expect(n.lastEvent!.kind).toBe("SCREEN_CONTEXT_CHANGED");
  });
});
