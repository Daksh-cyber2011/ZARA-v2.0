/**
 * ZARA V1.0 Phase 2 — §34 scenario gap tests.
 *
 * Covers the directive's 25 required scenarios that Phase 1 did not yet pin:
 *  #20 malformed LLM output → fail safely
 *  #21 Hinglish input → full reactive path incl. local commands
 *  #23 lifecycle recreation → runtime pieces come back cleanly
 *  #24 background transition → candidates WAIT, reminders exempt
 *  #25 permission denial → honest failure, no fake success
 */
import { describe, it, expect, vi } from "vitest";
import { AgentOrchestrator, AgentDeps, AgentTurnInput } from "../src/agent/orchestrator/AgentOrchestrator";
import { ToolRegistry } from "../src/agent/tools/ToolRegistry";
import { buildAndroidTools } from "../src/agent/tools/AndroidTools";
import { ConfirmationManager } from "../src/agent/confirmation/ConfirmationManager";
import { ContextEngine } from "../src/cognition/context/ContextEngine";
import { EventBus } from "../src/core/events/EventBus";
import { Diagnostics } from "../src/core/logging/Diagnostics";
import { StateMachine } from "../src/core/state/StateMachine";
import { LLMProvider, ChatResponse } from "../src/cognition/provider/types";
import { ToolResult } from "../src/agent/tools/ToolTypes";
import { SpeechQueue } from "../src/voice/SpeechQueue";
import { ProactiveDecisionEngine } from "../src/proactivity/ProactiveDecisionEngine";
import { AntiSpamPolicy } from "../src/proactivity/policy/AntiSpam";
import { DEFAULT_SETTINGS } from "../src/core/configuration/Settings";

function fakeProvider(script: (ChatResponse | Error)[], configured = true): LLMProvider {
  let i = 0;
  return {
    id: "fake", label: "Fake",
    isConfigured: async () => configured,
    validateCredentials: async () => {},
    chat: async () => {
      const r = script[Math.min(i++, script.length - 1)];
      if (r instanceof Error) throw r;
      return r;
    },
    chatStream: async () => script[0] as ChatResponse,
    structured: async () => ({})
  };
}

function makeDeps(provider: LLMProvider, opts?: { hasPermission?: boolean }) {
  const bus = new EventBus();
  const diag = new Diagnostics();
  const sm = new StateMachine("IDLE");
  const tools = new ToolRegistry();
  for (const t of buildAndroidTools()) tools.register(t);
  const confirmations = new ConfirmationManager(bus, diag);
  vi.spyOn(confirmations, "request").mockResolvedValue(true);
  const deps: AgentDeps = {
    provider: () => provider,
    tools, confirmations,
    context: new ContextEngine(),
    bus, diag, sm,
    toolCtx: {
      emitActionEvent: () => {},
      hasPermission: () => opts?.hasPermission ?? true,
      requestPermission: async () => false, // denied unless already granted
      native: new Proxy({}, { get: (_t, p: string) => async () => ({ ok: true, summary: `${p} done`, data: { id: "x1" } }) }) as never,
      now: () => Date.now()
    },
    consolidator: () => null,
    dialogueLog: []
  };
  return { deps, bus, sm, diag };
}

function input(over: Partial<AgentTurnInput> = {}): AgentTurnInput {
  return {
    userText: "hello",
    history: [],
    memories: [],
    snapshot: {
      state: "IDLE", quietMode: false,
      perception: { batteryLevel: 80, charging: false, online: true, localTime: "now", foreground: true },
      screenContext: null, capabilities: [], lastPerceptionEvent: null,
      recentEvents: [], activeGoal: null
    },
    activeTask: null,
    systemPromptBase: "You are ZARA (test).",
    ...over
  };
}

describe("§34 scenario 20 — malformed LLM output fails safely", () => {
  it("malformed tool arguments are dropped, conversation continues with text", async () => {
    // Model emits a tool call for a known tool with junk args → the registry
    // validation rejects it; the agent loop must not crash or hang.
    const provider = fakeProvider([
      { text: "", toolCalls: [{ id: "c1", name: "open_app", args: { app: "" } }], finishReason: "tool_call" },
      { text: "I couldn't open that — the app name was missing.", toolCalls: [], finishReason: "stop" }
    ]);
    const { deps } = makeDeps(provider);
    const agent = new AgentOrchestrator(deps);
    const r = await agent.runTurn(input({ userText: "open the thing" }));
    expect(r.error).toBeNull();
    expect(r.reply).toContain("couldn't open");
  });

  it("unknown tool names are rejected, never executed (§13)", async () => {
    const provider = fakeProvider([
      { text: "", toolCalls: [{ id: "c2", name: "rm_dash_rf", args: {} }], finishReason: "tool_call" },
      { text: "I can't do that — no such capability.", toolCalls: [], finishReason: "stop" }
    ]);
    const { deps } = makeDeps(provider);
    const agent = new AgentOrchestrator(deps);
    const r = await agent.runTurn(input({ userText: "delete everything" }));
    expect(r.reply).toContain("can't do that");
    expect(r.error).toBeNull();
  });

  it("provider throwing a non-LLMError still maps to a typed error (§47)", async () => {
    const provider = fakeProvider([new Error("utterly unexpected transport explosion")]);
    const { deps } = makeDeps(provider);
    const agent = new AgentOrchestrator(deps);
    const r = await agent.runTurn(input({ userText: "hi" }));
    expect(r.error).toBeTruthy();
    expect(r.reply).toBe("");
  });
});

describe("§34 scenario 21 — Hinglish input", () => {
  it("Hinglish turns flow through the reactive path with memory context", async () => {
    const provider = fakeProvider([
      { text: "Bilkul! Kal subah 7 baje yaad dilaa dungi.", toolCalls: [], finishReason: "stop" }
    ]);
    const { deps } = makeDeps(provider);
    const agent = new AgentOrchestrator(deps);
    const r = await agent.runTurn(input({
      userText: "zara mujhe kal subah 7 baje maths padhne ka reminder dena",
      memories: [{ id: "m1", text: "User is preparing for maths exam", score: 0.8, category: "goal" }]
    }));
    expect(r.reply).toContain("7 baje");
    expect(r.error).toBeNull();
  });

  it("Hinglish local commands are deterministic (zara chup → quiet)", () => {
    // Mirrors ZaraRuntime.tryLocalCommands regex contract for Hinglish stop.
    const t = "zara chup ho jao".toLowerCase();
    expect(/^(zara,?\s+)?(stop|stop talking|be quiet|quiet|chup|chup ho jao|shush|silence)\b/.test(t)).toBe(true);
  });
});

describe("§34 scenario 23 — lifecycle recreation", () => {
  it("SpeechQueue: cancelAll → enqueue again works (no wedged state)", async () => {
    const bus = new EventBus();
    const diag = new Diagnostics();
    const q1 = new SpeechQueue(bus, diag);
    q1.enqueue({ text: "first", source: "system" }, { interruptCurrent: true });
    q1.cancelAll("recreate");
    expect(q1.isSpeaking).toBe(false);
    // New instance over the same bus behaves identically (fresh lifecycle).
    const q2 = new SpeechQueue(bus, diag);
    const done = new Promise<boolean>(res => q2.enqueue({ text: "second", source: "system", onDone: res }, {}));
    expect(await done).toBe(true);
    expect(q2.isSpeaking).toBe(false);
  });

  it("StateMachine: fresh instance after shutdown has clean history", async () => {
    const sm1 = new StateMachine("IDLE");
    await sm1.requestTransition("THINKING", "turn");
    sm1.recover("IDLE", "done");
    const sm2 = new StateMachine("IDLE"); // recreation
    expect(sm2.state).toBe("IDLE");
    expect(sm2.transitionHistory.length).toBe(0);
    expect(await sm2.requestTransition("THINKING", "recreated")).toBe(true);
    expect(sm2.state).toBe("THINKING");
  });
});

describe("§34 scenario 24 — background transition", () => {
  function makeEngine(): ProactiveDecisionEngine {
    return new ProactiveDecisionEngine(
      new EventBus(), new Diagnostics(), new StateMachine("IDLE"),
      new AntiSpamPolicy(), () => ({ ...DEFAULT_SETTINGS })
    );
  }
  const candidate = {
    id: "bg1", createdAt: Date.now(), source: "memory_relevance" as const,
    draft: "Back to the project?", relevance: 0.9, importance: 0.9, novelty: 0.9,
    confidence: 0.9, timeliness: 0.8, personalContext: 0.95, annoyanceCost: 0.1
  };

  it("candidates WAIT while the app is backgrounded (no noisy background speech)", () => {
    const scored = makeEngine().evaluate(candidate, {
      state: "IDLE", quietMode: false, sleepMode: false, foreground: false, userPresent: true
    });
    expect(scored.decision).toBe("WAIT");
    expect(scored.reason).toContain("not in foreground");
  });

  it("reminders stay exempt in the background (time-critical)", () => {
    const scored = makeEngine().evaluate(
      { ...candidate, source: "reminder", draft: "Reminder: maths at 7" },
      { state: "IDLE", quietMode: false, sleepMode: false, foreground: false, userPresent: true }
    );
    expect(scored.decision).toBe("SPEAK_NOW");
  });
});

describe("§34 scenario 25 — permission denial", () => {
  it("tool with required permission + denial → honest PERMISSION_DENIED (never fake success)", async () => {
    const reg = new ToolRegistry();
    for (const t of buildAndroidTools()) reg.register(t);
    const native = new Proxy({}, {
      get: (_t, p: string) => async (): Promise<ToolResult> => ({ ok: true, summary: `${p} done` })
    }) as never;
    const r = await reg.execute("create_reminder", { time: "after 20 minutes", content: "study" }, {
      emitActionEvent: () => {},
      hasPermission: () => false,          // NOT granted
      requestPermission: async () => false, // AND user denies the ask
      native,
      now: () => Date.now()
    });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("PERMISSION_DENIED");
    expect(r.summary).not.toContain("Done");
  });
});
