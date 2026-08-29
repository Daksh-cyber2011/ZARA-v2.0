import { describe, it, expect, beforeEach } from "vitest";
import { ProactiveDecisionEngine } from "../src/proactivity/ProactiveDecisionEngine";
import { ProactiveCandidate } from "../src/proactivity/types";
import { AntiSpamPolicy } from "../src/proactivity/policy/AntiSpam";
import { EventBus } from "../src/core/events/EventBus";
import { Diagnostics } from "../src/core/logging/Diagnostics";
import { StateMachine } from "../src/core/state/StateMachine";
import { DEFAULT_SETTINGS, ZaraSettings } from "../src/core/configuration/Settings";

function makeEngine(settings?: Partial<ZaraSettings>) {
  const bus = new EventBus();
  const diag = new Diagnostics();
  const sm = new StateMachine("IDLE");
  let cfg: ZaraSettings = { ...DEFAULT_SETTINGS, ...settings };
  const antiSpam = new AntiSpamPolicy();
  const engine = new ProactiveDecisionEngine(bus, diag, sm, antiSpam, () => cfg);
  return { engine, antiSpam, bus, diag, sm, setCfg: (p: Partial<ZaraSettings>) => { cfg = { ...cfg, ...p }; } };
}

function candidate(over: Partial<ProactiveCandidate> = {}): ProactiveCandidate {
  return {
    id: "pc_test",
    source: "memory_relevance",
    draft: "Back to that physics project?",
    relevance: 0.8, importance: 0.7, novelty: 0.6, confidence: 0.8,
    timeliness: 0.6, personalContext: 0.9, annoyanceCost: 0.3,
    createdAt: Date.now(),
    ...over
  };
}

const CTX = { state: "IDLE", quietMode: false, sleepMode: false, foreground: true, userPresent: true };

describe("ProactiveDecisionEngine (§4-6, §39-40)", () => {
  it("SPEAK_NOW for a strongly relevant, important, personal candidate", () => {
    const { engine } = makeEngine();
    const r = engine.evaluate(candidate(), CTX);
    expect(r.decision).toBe("SPEAK_NOW");
    expect(r.score).toBeGreaterThan(0.62);
  });

  it("IGNORE is the default for weak candidates — silence is valid (§40)", () => {
    const { engine } = makeEngine();
    const r = engine.evaluate(candidate({
      relevance: 0.1, importance: 0.2, novelty: 0.1, confidence: 0.3,
      timeliness: 0.1, personalContext: 0.1, annoyanceCost: 0.8
    }), CTX);
    expect(r.decision).toBe("IGNORE");
  });

  it("hard-gates on QUIET mode (§7)", () => {
    const { engine } = makeEngine();
    const r = engine.evaluate(candidate(), { ...CTX, quietMode: true });
    expect(r.decision).toBe("IGNORE");
    expect(r.reason).toContain("quiet");
  });

  it("hard-gates on SLEEP mode (§8)", () => {
    const { engine } = makeEngine();
    const r = engine.evaluate(candidate(), { ...CTX, sleepMode: true });
    expect(r.decision).toBe("IGNORE");
  });

  it("WAITs while an active turn is in progress — 'interesting, but not now'", () => {
    const { engine } = makeEngine();
    const r = engine.evaluate(candidate(), { ...CTX, state: "SPEAKING" });
    expect(r.decision).toBe("WAIT");
  });

  it("reminders may interrupt an active turn (time-critical exception)", () => {
    const { engine } = makeEngine();
    const r = engine.evaluate(candidate({ source: "reminder", draft: "Reminder: study maths" }), { ...CTX, state: "SPEAKING" });
    expect(r.decision).not.toBe("WAIT");
  });

  it("respects anti-spam cooldown after a proactive utterance (§39)", () => {
    const { engine, antiSpam } = makeEngine();
    antiSpam.noteProactiveUtterance("Back to that physics project?", Date.now());
    const r = engine.evaluate(candidate(), CTX);
    expect(r.decision).toBe("WAIT");
    expect(r.reason).toContain("cooldown");
  });

  it("enforces the daily proactive cap", () => {
    const { engine, antiSpam } = makeEngine({ proactivityDailyLimit: 2 });
    antiSpam.configure({ dailyLimit: 2 }); // anti-spam policy owns the cap
    const now = Date.now();
    antiSpam.noteProactiveUtterance("one", now - 3600_000);
    antiSpam.noteProactiveUtterance("two", now - 1800_000);
    const r = engine.evaluate(candidate(), CTX);
    expect(r.decision).toBe("WAIT");
    expect(r.reason).toContain("daily limit");
  });

  it("suppresses duplicate drafts (repeated-question detection)", () => {
    const { engine, antiSpam } = makeEngine();
    antiSpam.noteProactiveUtterance("Back to that physics project?", Date.now() - 1000);
    // Bypass cooldown by faking old lastSpokeAt:
    (antiSpam as unknown as { lastSpokeAt: number }).lastSpokeAt = Date.now() - 1000 * 60 * 60;
    const r = engine.evaluate(candidate(), CTX);
    expect(r.decision).toBe("IGNORE");
    expect(r.reason).toContain("duplicate");
  });

  it("evaluateBatch returns AT MOST ONE speak (never stacked nudges)", () => {
    const { engine } = makeEngine();
    const { speak } = engine.evaluateBatch([candidate(), candidate({ id: "b", draft: "Second line?" }), candidate({ id: "c" })], CTX);
    expect(speak).not.toBeNull();
    const speaks = engine.evaluateBatch([candidate(), candidate({ id: "d" })], CTX).speak;
    expect(speaks).toBeNull(); // cooldown now active
  });

  it("high annoyance cost can veto an otherwise decent candidate", () => {
    const { engine } = makeEngine();
    const r = engine.evaluate(candidate({ annoyanceCost: 1.0, importance: 0.5, timeliness: 0.3 }), CTX);
    expect(r.decision).not.toBe("SPEAK_NOW");
  });

  it("proactivity disabled in settings → IGNORE", () => {
    const { engine, setCfg } = makeEngine({ proactivityEnabled: false });
    setCfg({ proactivityEnabled: false });
    const r = engine.evaluate(candidate(), CTX);
    expect(r.decision).toBe("IGNORE");
  });
});

describe("AntiSpamPolicy (§39)", () => {
  it("cooldown blocks immediate follow-ups", () => {
    const p = new AntiSpamPolicy();
    expect(p.veto()).toBeNull();
    p.noteProactiveUtterance("hi", Date.now());
    expect(p.veto()).toContain("cooldown");
  });

  it("blocks right after user speech", () => {
    const p = new AntiSpamPolicy();
    (p as unknown as { lastSpokeAt: number }).lastSpokeAt = Date.now() - 1000 * 60 * 60; // bypass cooldown
    p.noteUserActivity(Date.now());
    expect(p.veto()).toContain("user spoke very recently");
  });

  it("breaks consecutive proactive streaks", () => {
    const p = new AntiSpamPolicy();
    (p as unknown as { lastSpokeAt: number }).lastSpokeAt = Date.now() - 1000 * 60 * 60;
    (p as unknown as { lastUserSpeechAt: number }).lastUserSpeechAt = Date.now() - 1000 * 60 * 60;
    p.noteProactiveUtterance("a");
    (p as unknown as { lastSpokeAt: number }).lastSpokeAt = Date.now() - 1000 * 60 * 60;
    p.noteProactiveUtterance("b");
    (p as unknown as { lastSpokeAt: number }).lastSpokeAt = Date.now() - 1000 * 60 * 60;
    expect(p.veto()).toContain("consecutive");
  });
});
