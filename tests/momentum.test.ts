/**
 * ZARA V1.0 FINAL — §30 conversation momentum tests.
 *
 * Unacknowledged proactive utterances progressively lengthen the effective
 * cooldown (×1.5 each, capped at ×4); any user engagement restores it.
 */
import { describe, it, expect } from "vitest";
import { AntiSpamPolicy } from "../src/proactivity/policy/AntiSpam";

const BASE = 8 * 60 * 1000; // default cooldown

describe("§30 conversation momentum", () => {
  it("base cooldown applies with no proactive history", () => {
    const p = new AntiSpamPolicy();
    expect(p.effectiveCooldownMs()).toBe(BASE);
  });

  it("one unacknowledged proactive utterance backs off to ×1.5 after the ack window", () => {
    const p = new AntiSpamPolicy();
    const t0 = 1_000_000;
    p.noteProactiveUtterance("Back to the physics project?", t0);
    // Still inside the ack window → not counted yet.
    expect(p.effectiveCooldownMs(t0 + 30_000)).toBe(BASE);
    // After the 90s ack window with no user speech → ×1.5.
    expect(p.effectiveCooldownMs(t0 + 120_000)).toBe(Math.round(BASE * 1.5));
  });

  it("backoff compounds with more unacknowledged utterances", () => {
    const p = new AntiSpamPolicy();
    const t0 = 1_000_000;
    p.noteProactiveUtterance("one", t0);
    p.noteProactiveUtterance("two", t0 + 200_000);
    p.noteProactiveUtterance("three", t0 + 400_000);
    const now = t0 + 600_000; // all three past ack window, no user speech
    expect(p.effectiveCooldownMs(now)).toBe(Math.round(BASE * 1.5 ** 3));
  });

  it("backoff is capped at the configured maximum (×4 default)", () => {
    const p = new AntiSpamPolicy();
    const t0 = 1_000_000;
    for (let i = 0; i < 6; i++) p.noteProactiveUtterance("n" + i, t0 + i * 200_000);
    const now = t0 + 2_000_000;
    expect(p.effectiveCooldownMs(now)).toBe(BASE * 4);
  });

  it("user engagement restores the base cooldown immediately (§30)", () => {
    const p = new AntiSpamPolicy();
    const t0 = 1_000_000;
    p.noteProactiveUtterance("one", t0);
    p.noteProactiveUtterance("two", t0 + 200_000);
    expect(p.effectiveCooldownMs(t0 + 500_000)).toBeGreaterThan(BASE);

    p.noteUserEngaged(t0 + 510_000);
    expect(p.effectiveCooldownMs(t0 + 520_000)).toBe(BASE);
    expect(p.momentumStatus.multiplier).toBe(1);
  });

  it("user speech after an utterance acknowledges it (no backoff)", () => {
    const p = new AntiSpamPolicy();
    const t0 = 1_000_000;
    p.noteProactiveUtterance("one", t0);
    p.noteUserActivity(t0 + 30_000); // user replied within ack window
    expect(p.effectiveCooldownMs(t0 + 120_000)).toBe(BASE);
  });

  it("veto() reports the momentum-backed-off cooldown (§37 explainability)", () => {
    const p = new AntiSpamPolicy();
    const t0 = 1_000_000;
    p.noteProactiveUtterance("one", t0);
    p.noteProactiveUtterance("two", t0 + 200_000);
    const now = t0 + 400_000;
    const v = p.veto(now);
    expect(v).toContain("cooldown");
    expect(v).toContain("momentum-backed-off");
  });

  it("cooldownRemainingMs() exposes §37 panel data", () => {
    const p = new AntiSpamPolicy();
    const t0 = 1_000_000;
    expect(p.cooldownRemainingMs(t0)).toBe(0); // never spoke
    p.noteProactiveUtterance("one", t0);
    expect(p.cooldownRemainingMs(t0 + 60_000)).toBe(BASE - 60_000); // inside ack window
    // Past the ack window unacknowledged → momentum ×1.5 lengthens the wait.
    expect(p.cooldownRemainingMs(t0 + 120_000)).toBe(Math.round(BASE * 1.5) - 120_000);
    // Eventually reaches zero — never an infinite lockout.
    expect(p.cooldownRemainingMs(t0 + BASE * 4 + 60_000)).toBe(0);
  });
});
