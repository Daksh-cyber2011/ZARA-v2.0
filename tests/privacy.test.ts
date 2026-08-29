/**
 * ZARA V1.0 FINAL — §11 privacy toggle tests + §19/§33 interruption metadata
 * tests + §37 status snapshot tests (runtime level, injected stores).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ZaraRuntime } from "../src/ZaraRuntime";
import { SettingsStore, SecretStore, KVStorage, DEFAULT_SETTINGS } from "../src/core/configuration/Settings";
import { Diagnostics } from "../src/core/logging/Diagnostics";
import { LLMProvider, ChatResponse } from "../src/cognition/provider/types";

/* --------------------------------- helpers -------------------------------- */

class MemoryKV implements KVStorage {
  private m = new Map<string, string>();
  async get(k: string) { return this.m.get(k) ?? null; }
  async set(k: string, v: string) { this.m.set(k, v); }
  async remove(k: string) { this.m.delete(k); }
}

function makeRuntime(settingsPatch: Partial<typeof DEFAULT_SETTINGS> = {}) {
  const settings = new SettingsStore(new MemoryKV());
  const secrets = new SecretStore(new MemoryKV());
  const rt = new ZaraRuntime({ settings, secrets });
  // Load + patch synchronously for the test scenario.
  let cfg = { ...DEFAULT_SETTINGS, ...settingsPatch };
  (rt.settings as unknown as { cache: typeof cfg }).cache = cfg; // inject without localStorage
  return { rt, settings, secrets, setCfg: (p: Partial<typeof DEFAULT_SETTINGS>) => { cfg = { ...cfg, ...p }; (rt.settings as unknown as { cache: typeof cfg }).cache = cfg; } };
}

function fakeProvider(script: ChatResponse[], configured = true): LLMProvider {
  let i = 0;
  return {
    id: "fake", label: "Fake",
    isConfigured: async () => configured,
    validateCredentials: async () => {},
    chat: async () => {
      const r = script[Math.min(i++, script.length - 1)];
      return r;
    },
    chatStream: async () => script[0],
    structured: async () => ({})
  };
}

/* ------------------------------ §11 privacy ------------------------------- */

describe("§11 privacy toggles (runtime)", () => {
  it("cloud reasoning OFF → honest typed refusal, no LLM call, no fake reply", async () => {
    const { rt } = makeRuntime({ cloudReasoning: false });
    const chatSpy = vi.fn();
    (rt.providers as unknown as { active: () => LLMProvider }).active = () => ({
      ...fakeProvider([{ text: "SHOULD NOT BE CALLED", toolCalls: [], finishReason: "stop" }]),
      chat: async () => { chatSpy(); return { text: "x", toolCalls: [], finishReason: "stop" }; }
    });
    const reply = await rt.handleUserText("what's the weather in Delhi?");
    expect(reply).toContain("switched off");
    expect(chatSpy).not.toHaveBeenCalled();
    // refusal visible in history (user sees the real reason §58)
    expect(reply.length).toBeGreaterThan(10);
  });

  it("voice OFF → startVoiceSession refuses honestly", async () => {
    const { rt } = makeRuntime({ voiceEnabled: false });
    const ok = await rt.startVoiceSession();
    expect(ok).toBe(false);
    const last = rt.diag.all.find(r => r.event === "VOICE_REFUSED");
    expect(last).toBeDefined();
  });

  it("cloud reasoning ON (default) → LLM path is reachable", () => {
    const { rt } = makeRuntime();
    expect(rt.settings.current.cloudReasoning).toBe(true);
    expect(rt.settings.current.memoryEnabled).toBe(true);
    expect(rt.settings.current.appAwareness).toBe(true);
    expect(rt.settings.current.diagnosticsEnabled).toBe(true);
    expect(rt.settings.current.voiceEnabled).toBe(true);
  });

  it("diagnostics OFF → non-error records suppressed; errors still logged (§11)", () => {
    const d = new Diagnostics();
    d.setEnabled(false);
    d.log("state", "RUNTIME_READY", {});
    d.log("voice", "ENQUEUE", {});
    d.log("error", "LLM_TIMEOUT", {});
    const events = d.all.map(r => r.event);
    expect(events).not.toContain("RUNTIME_READY");
    expect(events).not.toContain("ENQUEUE");
    expect(events).toContain("LLM_TIMEOUT");
  });

  it("memory OFF → handleUserText passes zero memories to the agent", async () => {
    const { rt, setCfg } = makeRuntime({ memoryEnabled: false });
    // Seed one memory; retrieval must be skipped despite the store having data.
    await rt.memory.ensureLoaded();
    await rt.memory.addExplicit("project", "The user is building a rocket at home.", { importance: 0.9 });
    expect(rt.memory.active().length).toBe(1);

    let seenMemories: unknown[] = [];
    (rt.agent as unknown as { deps: { provider: () => LLMProvider } }).deps.provider = () =>
      fakeProvider([{ text: "ok", toolCalls: [], finishReason: "stop" }]);
    // Intercept runTurn to observe the memory payload.
    const origRunTurn = rt.agent.runTurn.bind(rt.agent);
    (rt.agent as { runTurn: typeof rt.agent.runTurn }).runTurn = async (input, token) => {
      seenMemories = input.memories;
      return origRunTurn(input, token);
    };

    setCfg({ memoryEnabled: false });
    await rt.handleUserText("what am I building?");
    expect(seenMemories).toEqual([]);
  });
});

/* --------------------------- §19/§33 interruption --------------------------- */

describe("§19/§33 interruption metadata + continuity", () => {
  beforeEach(() => { /* fresh runtimes per test below */ });

  it("interrupt() records turnId, speech id, reason, phase and partial text", async () => {
    const { rt } = makeRuntime();
    await rt.sm.transition("IDLE", "init");
    // ZARA is speaking something.
    await rt.sm.requestTransition("SPEAKING", "reply");
    const uttId = rt.speech.enqueue({ text: "The memory architecture works like this: first", source: "reply" }, { interruptCurrent: false });
    expect(uttId).toBeTruthy();

    rt.interruption.interrupt("user said wait");
    const rec = rt.interruption.lastInterruption;
    expect(rec).not.toBeNull();
    expect(rec!.reason).toBe("user said wait");
    expect(rec!.phase).toBe("speech");
    expect(rec!.speechGenerationId).toBeTruthy();
    expect(rec!.interruptedText).toContain("memory architecture");
    expect(rt.sm.state).toBe("INTERRUPTED");
  });

  it("ZARA_INTERRUPTED event carries §19 structured metadata", async () => {
    const { rt, } = makeRuntime();
    const events: { turnId?: string; reason?: string; interruptedText?: string }[] = [];
    rt.bus.on("ZARA_INTERRUPTED", e => events.push(e));
    await rt.sm.transition("IDLE", "init");
    await rt.sm.requestTransition("SPEAKING", "reply");
    rt.speech.enqueue({ text: "explaining verification", source: "reply" }, { interruptCurrent: false });
    rt.interruption.interrupt("voice barge-in");
    expect(events.length).toBe(1);
    expect(events[0].reason).toBe("voice barge-in");
    expect(typeof events[0].turnId).toBe("string");
  });

  it("post-interruption continuity context is provided for 2 turns (§33)", async () => {
    const { rt } = makeRuntime();
    await rt.sm.transition("IDLE", "init");

    let captured: { interruptedContext?: { reason: string; partialText?: string; turnsAgo: number } | null } | null = null;
    const fake = fakeProvider([{ text: "continuing", toolCalls: [], finishReason: "stop" }]);
    (rt.agent as unknown as { deps: { provider: () => LLMProvider } }).deps.provider = () => fake;
    const origRunTurn = rt.agent.runTurn.bind(rt.agent);
    (rt.agent as { runTurn: typeof rt.agent.runTurn }).runTurn = async (input, token) => {
      captured = input as typeof captured;
      return origRunTurn(input, token);
    };

    // Simulate: turn 1 happens, ZARA speaks, gets interrupted.
    await rt.handleUserText("tell me about memory consolidation");
    rt.sm.recover("SPEAKING", "reply");
    // interruptCurrent: true — replaces the model's short reply so the
    // longer explanation is what's speaking when the user barges in.
    rt.speech.enqueue({ text: "Consolidation has three phases: extraction, validation", source: "reply" }, { interruptCurrent: true });
    rt.interruption.interrupt("user said wait");

    // Next turn must carry the continuity context.
    await rt.handleUserText("what did you mean by consolidation?");
    expect(captured).not.toBeNull();
    expect(captured!.interruptedContext).not.toBeNull();
    expect(captured!.interruptedContext!.turnsAgo).toBe(1);
    expect(captured!.interruptedContext!.partialText).toContain("Consolidation");
  });

  it("continuity context expires after 2 turns (does not haunt forever)", async () => {
    const { rt } = makeRuntime();
    await rt.sm.transition("IDLE", "init");
    const fake = fakeProvider([{ text: "ok", toolCalls: [], finishReason: "stop" }]);
    (rt.agent as unknown as { deps: { provider: () => LLMProvider } }).deps.provider = () => fake;
    let captured: { interruptedContext?: { turnsAgo: number } | null } | null = null;
    const origRunTurn = rt.agent.runTurn.bind(rt.agent);
    (rt.agent as { runTurn: typeof rt.agent.runTurn }).runTurn = async (input, token) => {
      captured = input as typeof captured;
      return origRunTurn(input, token);
    };

    await rt.handleUserText("tell me something");
    rt.sm.recover("SPEAKING", "reply");
    rt.speech.enqueue({ text: "something", source: "reply" }, { interruptCurrent: false });
    rt.interruption.interrupt("stop");

    await rt.handleUserText("one");   // turnsAgo = 1
    expect(captured!.interruptedContext?.turnsAgo).toBe(1);
    await rt.handleUserText("two");   // turnsAgo = 2
    expect(captured!.interruptedContext?.turnsAgo).toBe(2);
    await rt.handleUserText("three"); // turnsAgo = 3 → expired
    expect(captured!.interruptedContext).toBeNull();
  });
});

/* ------------------------------ §37 snapshot ------------------------------- */

describe("§37 statusSnapshot", () => {
  it("gathers the full structured status", async () => {
    const { rt } = makeRuntime();
    await rt.sm.transition("IDLE", "init");
    const st = rt.statusSnapshot();
    expect(st.state).toBe("IDLE");
    expect(st.provider.id).toBe("gemini");        // FINAL-INTEGRATION §1 default provider
    expect(st.provider.model).toBe(DEFAULT_SETTINGS.chatModel);
    expect(st.avatar.mode).toBe("loading");       // §34 honest avatar status present
    expect(st.toolsCount).toBeGreaterThanOrEqual(20); // 19 + get_weather
    expect(st.voice.queueLength).toBe(0);
    expect(st.proactivity.enabled).toBe(true);
    expect(typeof st.proactivity.cooldownRemainingMs).toBe("number");
    expect(st.proactivity.momentum.multiplier).toBe(1);
    expect(st.memory.activeCount).toBe(0);
    expect(Array.isArray(st.perception)).toBe(true);
  });

  it("boot flow: BOOTING → IDLE only after init()", async () => {
    const { rt } = makeRuntime();
    expect(rt.sm.state).toBe("BOOTING");
    await rt.init(); // memory/settings loads run; persistence is lazy-safe
    expect(rt.sm.state).toBe("IDLE");
    expect(rt.statusSnapshot().lastTransition?.to).toBe("IDLE");
  });
});
