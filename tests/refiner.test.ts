/**
 * ZARA V1.0 Phase 2 — Proactive refiner tests (Directive §39 three stages).
 *
 * The LLM is never the scheduler: it may veto or reshape a candidate that the
 * deterministic engine already deemed worth considering, and every outcome is
 * re-gated by policy. Failure ⇒ deterministic template stands.
 */
import { describe, it, expect, vi } from "vitest";
import { ProactiveRefiner } from "../src/proactivity/Refiner";
import { ProactiveDecisionEngine } from "../src/proactivity/ProactiveDecisionEngine";
import { AntiSpamPolicy } from "../src/proactivity/policy/AntiSpam";
import { EventBus } from "../src/core/events/EventBus";
import { Diagnostics } from "../src/core/logging/Diagnostics";
import { StateMachine } from "../src/core/state/StateMachine";
import { DEFAULT_SETTINGS, ZaraSettings } from "../src/core/configuration/Settings";
import { LLMProvider } from "../src/cognition/provider/types";

/* ------------------------------- fakes ------------------------------------- */

function makeDiag(): Diagnostics {
  const d = new Diagnostics();
  return d;
}

class FakeProvider implements Partial<LLMProvider> {
  constructor(private structuredResult: Record<string, unknown> | Error) {}
  async isConfigured(): Promise<boolean> { return true; }
  async structured(): Promise<Record<string, unknown>> {
    if (this.structuredResult instanceof Error) throw this.structuredResult;
    return this.structuredResult;
  }
}

function makeEngine(provider?: Partial<LLMProvider>): { engine: ProactiveDecisionEngine; refiner: ProactiveRefiner | null } {
  const antiSpam = new AntiSpamPolicy({ ...new AntiSpamPolicy().config });
  const settings: ZaraSettings = { ...DEFAULT_SETTINGS };
  const engine = new ProactiveDecisionEngine(new EventBus(), makeDiag(), new StateMachine("IDLE"), antiSpam, () => settings);
  if (provider) {
    const refiner = new ProactiveRefiner(() => provider as LLMProvider, makeDiag());
    engine.attachRefiner(refiner);
    return { engine, refiner };
  }
  return { engine, refiner: null };
}

const CTX = { state: "IDLE", quietMode: false, sleepMode: false, foreground: true, userPresent: true };

const STRONG = {
  source: "memory_relevance" as const,
  draft: "Back to the ZARA project?",
  relevance: 0.85, importance: 0.8, novelty: 0.8, confidence: 0.8,
  timeliness: 0.7, personalContext: 0.95, annoyanceCost: 0.2,
  memoryIds: []
};

/* --------------------------------- tests ----------------------------------- */

describe("ProactiveRefiner (§39 stage 2)", () => {
  it("refines a consider-band candidate via the provider", async () => {
    const provider = new FakeProvider({ speak: true, line: "Wapas ZARA pe kaam karein?", reason: "user returned to project" });
    const { refiner } = makeEngine(provider);
    const verdict = await refiner!.refine({
      draft: "Back to the ZARA project?",
      source: "memory_relevance",
      memoryLines: ["User is building ZARA"],
      contextLine: "User returned after 40 min"
    });
    expect(verdict).not.toBeNull();
    expect(verdict!.speak).toBe(true);
    expect(verdict!.line).toContain("ZARA");
  });

  it("returns null when the provider fails — template stands (§38)", async () => {
    const provider = new FakeProvider(new Error("boom"));
    const { refiner } = makeEngine(provider);
    const verdict = await refiner!.refine({ draft: "d", source: "memory_relevance", memoryLines: [], contextLine: "" });
    expect(verdict).toBeNull();
  });

  it("enforces the hourly call budget", async () => {
    const provider = new FakeProvider({ speak: false, line: "", reason: "x" });
    const { refiner } = makeEngine(provider);
    const input = { draft: "topic-a", source: "memory_relevance", memoryLines: [], contextLine: "" };
    // Distinct multi-word topics → distinct dedupe keys.
    const topics = [
      "alpha bravo study plan",
      "delta echo gym session",
      "foxtrot golf math exam",
      "hotel india project demo",
      "juliet kilo book draft",
      "lima mike doctor visit",
      "november oscar trip pack"
    ];
    const results = [];
    for (const t of topics) results.push(await refiner!.refine({ ...input, draft: t }));
    expect(results.filter(Boolean)).toHaveLength(6); // budget 6
    expect(results[6]).toBeNull(); // 7th blocked
  });

  it("dedupes the same topic within the window (no repeat calls)", async () => {
    const provider = new FakeProvider({ speak: true, line: "hi", reason: "ok" });
    const { refiner } = makeEngine(provider);
    const input = { draft: "Back to the ZARA project?", source: "memory_relevance", memoryLines: [], contextLine: "" };
    const first = await refiner!.refine(input);
    const second = await refiner!.refine(input);
    expect(first).not.toBeNull();
    expect(second).toBeNull(); // same topic key → skipped
  });
});

describe("ProactiveDecisionEngine.evaluateWithModel (§39 stages 1→2→3)", () => {
  it("model VETO turns a would-be SPEAK_NOW into IGNORE, explainably", async () => {
    const provider = new FakeProvider({ speak: false, line: "", reason: "user is busy" });
    const { engine } = makeEngine(provider);
    const scored = await engine.evaluateWithModel(
      { ...STRONG, id: "c1", createdAt: Date.now() },
      CTX,
      { memoryLines: [], contextLine: "" }
    );
    expect(scored.decision).toBe("IGNORE");
    expect(scored.reason).toContain("model veto");
    expect(scored.reason).toContain("user is busy");
  });

  it("model RESHAPE replaces the template line and re-gates it", async () => {
    const provider = new FakeProvider({ speak: true, line: "Wapas project pe chalen?", reason: "relevant" });
    const { engine } = makeEngine(provider);
    const scored = await engine.evaluateWithModel(
      { ...STRONG, id: "c2", createdAt: Date.now() },
      CTX,
      { memoryLines: [], contextLine: "" }
    );
    expect(scored.decision).toBe("SPEAK_NOW");
    expect(scored.candidate.draft).toBe("Wapas project pe chalen?");
    expect(scored.reason).toContain("refined");
  });

  it("skips the model entirely for reminders (time-critical, §39)", async () => {
    const provider = new FakeProvider({ speak: false, line: "", reason: "should never be consulted" });
    const { engine } = makeEngine(provider);
    const scored = await engine.evaluateWithModel(
      { ...STRONG, id: "c3", createdAt: Date.now(), source: "reminder", relevance: 1, importance: 1, timeliness: 1 },
      CTX
    );
    expect(scored.decision).toBe("SPEAK_NOW"); // deterministic path, no veto
    expect(scored.candidate.draft).toBe(STRONG.draft);
  });

  it("without a refiner attached, stays fully deterministic", async () => {
    const { engine } = makeEngine(undefined);
    const scored = await engine.evaluateWithModel({ ...STRONG, id: "c4", createdAt: Date.now() }, CTX);
    expect(scored.decision).toBe("SPEAK_NOW");
    expect(scored.candidate.draft).toBe(STRONG.draft);
  });

  it("weak candidates never reach the model (§39 relevance gate)", async () => {
    const structured = vi.fn(async () => ({ speak: true, line: "x", reason: "y" }));
    const provider = { isConfigured: async () => true, structured } as unknown as Partial<LLMProvider>;
    const { engine } = makeEngine(provider);
    const weak = { ...STRONG, id: "c5", createdAt: Date.now(), relevance: 0.1, importance: 0.1, personalContext: 0.1, timeliness: 0.1, novelty: 0.1, confidence: 0.1 };
    const scored = await engine.evaluateWithModel(weak, CTX);
    expect(scored.decision).toBe("IGNORE");
    expect(structured).not.toHaveBeenCalled(); // stage 2 skipped
  });
});
