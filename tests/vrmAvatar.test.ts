/**
 * FINAL-INTEGRATION §8/§30/§31 — VRM avatar behavior mapping tests.
 * The pure mapping layer is what guarantees the avatar is STATE-AWARE
 * (never decorative): every runtime state has a distinct behavior, every
 * emotion maps to legal VRM expression weights, and the speech animation
 * is an honest controlled approximation (§9).
 */
import { describe, it, expect } from "vitest";
import {
  STATE_BEHAVIOR, EMOTION_EXPRESSIONS, DRIVEN_EXPRESSIONS, VISEMES,
  selectViseme, visemeWeight, speechEnvelope, gazeOffsetFor, frameIntervalFor
} from "../src/avatar/renderer/vrmMapping";
import { ALL_EMOTIONS } from "../src/avatar/emotion/EmotionController";
import { VALID_TRANSITIONS } from "../src/core/state/states";

describe("§8 — every runtime state has avatar behavior", () => {
  it("covers the full state table", () => {
    expect(Object.keys(STATE_BEHAVIOR).sort()).toEqual(Object.keys(VALID_TRANSITIONS).sort());
  });

  it("SLEEPING closes the eyes fully and dims the light", () => {
    expect(STATE_BEHAVIOR.SLEEPING.forcedEyeClose).toBe(1);
    expect(STATE_BEHAVIOR.SLEEPING.gazeMode).toBe("closed");
    expect(STATE_BEHAVIOR.SLEEPING.lightIntensity).toBeLessThan(STATE_BEHAVIOR.IDLE.lightIntensity);
  });

  it("BOOTING starts with closed eyes (waking animation)", () => {
    expect(STATE_BEHAVIOR.BOOTING.forcedEyeClose).toBe(1);
  });

  it("LISTENING locks gaze on the camera; THINKING looks away", () => {
    expect(STATE_BEHAVIOR.LISTENING.gazeMode).toBe("camera");
    expect(STATE_BEHAVIOR.LISTENING.gazeStability).toBe(1);
    expect(STATE_BEHAVIOR.THINKING.gazeMode).toBe("up-left");
    expect(STATE_BEHAVIOR.THINKING.gazeMode).not.toBe("camera");
  });

  it("SPEAKING faces the camera (voice+avatar are one system, §9)", () => {
    expect(STATE_BEHAVIOR.SPEAKING.gazeMode).toBe("camera");
  });

  it("QUIET is visibly subdued: gaze away + dimmer light + less sway", () => {
    const q = STATE_BEHAVIOR.QUIET, idle = STATE_BEHAVIOR.IDLE;
    expect(q.gazeMode).toBe("away");
    expect(q.lightIntensity).toBeLessThan(idle.lightIntensity);
    expect(q.bodySway).toBeLessThan(idle.bodySway);
  });

  it("all behaviors stay within legal ranges", () => {
    for (const b of Object.values(STATE_BEHAVIOR)) {
      expect(b.gazeStability).toBeGreaterThanOrEqual(0);
      expect(b.gazeStability).toBeLessThanOrEqual(1);
      expect(b.forcedEyeClose).toBeGreaterThanOrEqual(0);
      expect(b.forcedEyeClose).toBeLessThanOrEqual(1);
      expect(b.breathDepth).toBeGreaterThanOrEqual(0);
      expect(b.lightIntensity).toBeGreaterThan(0);
      expect(b.lightIntensity).toBeLessThanOrEqual(1);
      expect(b.bodySway).toBeGreaterThanOrEqual(0);
      expect(b.bodySway).toBeLessThanOrEqual(1);
    }
  });
});

describe("§30 — deterministic emotion → VRM expression mapping", () => {
  it("covers every avatar emotion", () => {
    expect(Object.keys(EMOTION_EXPRESSIONS).sort()).toEqual([...ALL_EMOTIONS].sort());
  });

  it("weights are always within 0..1 and reference real expression names", () => {
    for (const map of Object.values(EMOTION_EXPRESSIONS)) {
      for (const [name, w] of Object.entries(map)) {
        expect(DRIVEN_EXPRESSIONS).toContain(name);
        expect(w as number).toBeGreaterThanOrEqual(0);
        expect(w as number).toBeLessThanOrEqual(1);
      }
    }
  });

  it("distinct emotions produce distinct presentations", () => {
    expect(EMOTION_EXPRESSIONS.happy).toEqual({ happy: 1 });
    expect(EMOTION_EXPRESSIONS.sad).toEqual({ sad: 0.85 });
    expect(EMOTION_EXPRESSIONS.surprised).toEqual({ surprised: 1 });
  });

  it("sleepy keeps eyes mostly closed; playful winks (blinkLeft)", () => {
    expect(EMOTION_EXPRESSIONS.sleepy.blink).toBeGreaterThanOrEqual(0.7);
    expect(EMOTION_EXPRESSIONS.playful.blinkLeft).toBeGreaterThanOrEqual(0.7);
  });
});

describe("§9/§31 — honest approximate speech animation", () => {
  it("viseme set is the VRM preset viseme set", () => {
    expect([...VISEMES].sort()).toEqual(["aa", "ee", "ih", "oh", "ou"]);
  });

  it("low amplitude picks narrow visemes; high amplitude picks open visemes", () => {
    const low = new Set([selectViseme(0.05, 0), selectViseme(0.05, 1), selectViseme(0.15, 0)]);
    for (const v of low) expect(["ih", "ee"]).toContain(v);
    const high = new Set([selectViseme(0.95, 0), selectViseme(0.95, 1)]);
    for (const v of high) expect(["oh", "aa"]).toContain(v);
  });

  it("beat alternation changes the mouth shape at fixed amplitude", () => {
    expect(selectViseme(0.5, 0)).not.toBe(selectViseme(0.5, 1));
  });

  it("visemeWeight clamps and scales with amplitude", () => {
    expect(visemeWeight(0)).toBe(0);
    expect(visemeWeight(1)).toBe(1);
    expect(visemeWeight(2)).toBe(1); // clamped
    expect(visemeWeight(0.5)).toBeCloseTo(0.575, 2);
  });

  it("speech envelope is silent when not speaking, alive when speaking, always in range", () => {
    expect(speechEnvelope(10, false)).toBe(0);
    let max = 0, min = 1, sum = 0, n = 0;
    for (let t = 0; t < 10; t += 0.033) {
      const e = speechEnvelope(t, true);
      expect(e).toBeGreaterThanOrEqual(0);
      expect(e).toBeLessThanOrEqual(1);
      max = Math.max(max, e); min = Math.min(min, e); sum += e; n++;
    }
    expect(max).toBeGreaterThan(0.6);  // mouth actually opens
    expect(sum / n).toBeGreaterThan(0.1); // not a dead ringer
  });
});

describe("gaze offsets", () => {
  it("camera gaze is in front of the head (+z)", () => {
    const off = gazeOffsetFor("camera", 1, 0);
    expect(off.z).toBeGreaterThan(0.5);
    expect(Math.abs(off.x)).toBeLessThan(0.01);
  });

  it("up-left gaze looks up and to the model's left", () => {
    const off = gazeOffsetFor("up-left", 1, 0);
    expect(off.y).toBeGreaterThan(0.2);
    expect(off.x).toBeLessThan(0);
  });

  it("wander gaze actually moves over time", () => {
    const a = gazeOffsetFor("wander", 0, 0);
    const b = gazeOffsetFor("wander", 5, 0);
    expect(a.x).not.toBe(b.x);
  });
});

describe("§14 SHUTTING_DOWN — avatar wind-down behavior", () => {
  it("has a distinct calm behavior (eyes mostly closed, dim, still)", () => {
    const b = STATE_BEHAVIOR.SHUTTING_DOWN;
    expect(b.gazeMode).toBe("closed");
    expect(b.forcedEyeClose).toBeGreaterThanOrEqual(0.8);
    expect(b.lightIntensity).toBeLessThanOrEqual(STATE_BEHAVIOR.IDLE.lightIntensity);
    expect(b.bodySway).toBe(0); // no fidgeting while tearing down
  });

  it("SHUTTING_DOWN is covered by the every-state completeness test", () => {
    expect(Object.keys(STATE_BEHAVIOR)).toContain("SHUTTING_DOWN");
  });
});

describe("§35 — adaptive frame-rate policy (idle renderer economy)", () => {
  it("active states render at the full display rate (60 fps)", () => {
    for (const s of ["LISTENING", "THINKING", "PLANNING", "EXECUTING", "VERIFYING", "SPEAKING", "INTERRUPTED", "WAITING", "BOOTING"] as const) {
      expect(frameIntervalFor(s)).toBeCloseTo(1000 / 60, 5);
    }
  });

  it("IDLE presence throttles to 20 fps — visibly identical, 3x cheaper", () => {
    expect(frameIntervalFor("IDLE")).toBeCloseTo(1000 / 20, 5);
    expect(frameIntervalFor("ERROR")).toBeCloseTo(1000 / 20, 5);
  });

  it("QUIET / SLEEPING / SHUTTING_DOWN throttle hardest (12 fps)", () => {
    for (const s of ["QUIET", "SLEEPING", "SHUTTING_DOWN"] as const) {
      expect(frameIntervalFor(s)).toBeCloseTo(1000 / 12, 5);
    }
  });

  it("every state returns a sane positive interval (never 0 / negative)", () => {
    for (const s of Object.keys(VALID_TRANSITIONS)) {
      const iv = frameIntervalFor(s as Parameters<typeof frameIntervalFor>[0]);
      expect(iv).toBeGreaterThan(0);
      // never faster than the display rate, never slower than the slowest throttle
      expect(iv).toBeGreaterThanOrEqual(1000 / 60 - 1e-9);
      expect(iv).toBeLessThanOrEqual(1000 / 12 + 1e-9);
    }
  });

  it("ordering: full-rate active < idle < quiet/sleep/shutdown", () => {
    expect(frameIntervalFor("SPEAKING")).toBeLessThan(frameIntervalFor("IDLE"));
    expect(frameIntervalFor("IDLE")).toBeLessThan(frameIntervalFor("SLEEPING"));
  });
});
