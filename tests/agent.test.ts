import { describe, it, expect, beforeEach, vi } from "vitest";
import { AgentOrchestrator, AgentDeps, AgentTurnInput } from "../src/agent/orchestrator/AgentOrchestrator";
import { ToolRegistry } from "../src/agent/tools/ToolRegistry";
import { buildAndroidTools } from "../src/agent/tools/AndroidTools";
import { ConfirmationManager } from "../src/agent/confirmation/ConfirmationManager";
import { ContextEngine } from "../src/cognition/context/ContextEngine";
import { EventBus } from "../src/core/events/EventBus";
import { Diagnostics } from "../src/core/logging/Diagnostics";
import { StateMachine } from "../src/core/state/StateMachine";
import { LLMProvider, ChatRequest, ChatResponse, LLMError } from "../src/cognition/provider/types";
import { MemoryConsolidator } from "../src/memory/consolidation/Consolidator";

function fakeProvider(script: ChatResponse[], configured = true): LLMProvider {
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

function makeDeps(provider: LLMProvider, opts?: { confirmApprove?: boolean }) {
  const bus = new EventBus();
  const diag = new Diagnostics();
  const sm = new StateMachine("IDLE");
  const tools = new ToolRegistry();
  for (const t of buildAndroidTools()) tools.register(t);
  const confirmations = new ConfirmationManager(bus, diag);
  const confirmSpy = vi.spyOn(confirmations, "request").mockResolvedValue(opts?.confirmApprove ?? true);
  const dialogueLog: Parameters<MemoryConsolidator["processSlice"]>[0] = [];
  const deps: AgentDeps = {
    provider: () => provider,
    tools, confirmations,
    context: new ContextEngine(),
    bus, diag, sm,
    toolCtx: {
      emitActionEvent: () => {},
      hasPermission: () => true,
      requestPermission: async () => true,
      native: new Proxy({}, { get: (_t, p: string) => async () => ({ ok: true, summary: `${p} done`, data: { id: "x1" } }) }) as never,
      now: () => Date.now()
    },
    consolidator: () => null,
    dialogueLog
  };
  return { deps, bus, sm, diag, confirmSpy, dialogueLog };
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

describe("AgentOrchestrator (§13-14)", () => {
  it("returns a plain reply when the model responds without tools", async () => {
    const provider = fakeProvider([{ text: "Hey! What's up?", toolCalls: [], finishReason: "stop" }]);
    const { deps } = makeDeps(provider);
    const agent = new AgentOrchestrator(deps);
    const r = await agent.runTurn(input({ userText: "hey zara" }));
    expect(r.reply).toBe("Hey! What's up?");
    expect(r.error).toBeNull();
    expect(r.interrupted).toBe(false);
  });

  it("refuses honestly with LLM_NOT_CONFIGURED when no provider (§58)", async () => {
    const provider = fakeProvider([], false);
    const { deps } = makeDeps(provider);
    const agent = new AgentOrchestrator(deps);
    const r = await agent.runTurn(input({ userText: "hello" }));
    expect(r.error).toBe("LLM_NOT_CONFIGURED");
    expect(r.reply).toBe("");
  });

  it("executes a LOW-risk tool and feeds the VERIFIED result back (§19)", async () => {
    const provider = fakeProvider([
      { text: "", toolCalls: [{ id: "c1", name: "open_app", args: { app: "youtube" } }], finishReason: "tool_call" },
      { text: "YouTube is open.", toolCalls: [], finishReason: "stop" }
    ]);
    const { deps } = makeDeps(provider);
    const agent = new AgentOrchestrator(deps);
    const r = await agent.runTurn(input({ userText: "open youtube" }));
    expect(r.reply).toBe("YouTube is open.");
    expect(r.toolSummaries).toHaveLength(1);
    expect(r.toolSummaries[0].tool).toBe("open_app");
    expect(r.toolSummaries[0].status).toBe("verified");
  });

  it("asks for confirmation on HIGH-risk tools and respects denial", async () => {
    const provider = fakeProvider([
      { text: "", toolCalls: [{ id: "c1", name: "prepare_message", args: { contact: "Rahul", message: "I'll reach home in ten minutes" } }], finishReason: "tool_call" },
      { text: "Okay, I won't send it.", toolCalls: [], finishReason: "stop" }
    ]);
    const { deps, confirmSpy } = makeDeps(provider, { confirmApprove: false });
    const agent = new AgentOrchestrator(deps);
    const r = await agent.runTurn(input({ userText: "message Rahul that I'll reach home in ten minutes" }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(r.toolSummaries[0].status).toBe("declined");
    expect(r.reply).toContain("won't send");
  });

  it("propagates tool failure to the final reply path (§19 honest failure)", async () => {
    const provider = fakeProvider([
      { text: "", toolCalls: [{ id: "c1", name: "open_app", args: { app: "zzz" } }], finishReason: "tool_call" },
      { text: "I couldn't complete that.", toolCalls: [], finishReason: "stop" }
    ]);
    const { deps, toolCtx } = {} as never;
    const d = makeDeps(provider);
    // Make native bridge fail for openApp:
    (d.deps.toolCtx as { native: unknown }).native = new Proxy({}, {
      get: () => async () => ({ ok: false, summary: "No app found.", error: { code: "APP_NOT_FOUND", message: "no match", retryable: false } })
    });
    const agent = new AgentOrchestrator(d.deps);
    const r = await agent.runTurn(input({ userText: "open zzz" }));
    expect(r.toolSummaries[0].status).toBe("failed");
    expect(r.toolSummaries[0].outcome).toContain("couldn't complete");
  });

  it("classifies provider errors into the typed taxonomy (§47)", async () => {
    const provider = fakeProvider([new LLMError("NETWORK_ERROR", "offline") as unknown as ChatResponse]);
    const { deps } = makeDeps(provider);
    const agent = new AgentOrchestrator(deps);
    const r = await agent.runTurn(input({ userText: "hello" }));
    expect(r.error).toBe("NETWORK_ERROR");
  });

  it("stops after MAX_STEPS — never loops forever (§14)", async () => {
    const loopResponse: ChatResponse = {
      text: "", toolCalls: [{ id: "c", name: "battery_info", args: {} }], finishReason: "tool_call"
    };
    const provider = fakeProvider([loopResponse]); // always the same tool call
    const { deps } = makeDeps(provider);
    const agent = new AgentOrchestrator(deps);
    const r = await agent.runTurn(input({ userText: "check battery forever" }));
    expect(r.reply).toContain("stopped");
    expect(r.emotion).toBe("confused");
  }, 20000);

  it("records dialogue for memory consolidation", async () => {
    const provider = fakeProvider([{ text: "Nice.", toolCalls: [], finishReason: "stop" }]);
    const { deps, dialogueLog } = makeDeps(provider);
    const agent = new AgentOrchestrator(deps);
    await agent.runTurn(input({ userText: "I'm building ZARA" }));
    expect(dialogueLog.length).toBeGreaterThanOrEqual(2);
    expect(dialogueLog[0]).toMatchObject({ role: "user", text: "I'm building ZARA" });
    expect(dialogueLog[1]).toMatchObject({ role: "zara" });
  });
});

describe("ContextEngine budgets (§37)", () => {
  it("injects only top-ranked memories under budget", () => {
    const ce = new ContextEngine();
    ce.memoryCharBudget = 200;
    const memories = Array.from({ length: 40 }, (_, i) => ({
      id: `m${i}`, score: 1 - i * 0.01, category: "project",
      text: `Memory number ${i} with some length to consume budget space.`.slice(0, 60)
    }));
    const snap = input().snapshot;
    const out = ce.build({ baseSystemPrompt: "You are ZARA.", memories, snapshot: snap });
    const injected = (out.memoryBlock.match(/^- /gm) ?? []).length;
    expect(injected).toBeGreaterThan(0);
    expect(injected).toBeLessThan(40); // budget actually bounded it
    expect(out.budget.used).toBeLessThan(out.budget.limit + 500);
  });

  it("includes perception + quiet mode in situation notes", () => {
    const ce = new ContextEngine();
    const out = ce.build({
      baseSystemPrompt: "You are ZARA.",
      memories: [],
      snapshot: { ...input().snapshot, quietMode: true, perception: { ...input().snapshot.perception, online: false } }
    });
    expect(out.contextNote).toContain("QUIET MODE");
    expect(out.contextNote).toContain("OFFLINE");
  });
});
