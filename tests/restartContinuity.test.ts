/**
 * ZARA V1.0 — FINAL EXPERIENCE §34 + §14 runtime-level integration tests.
 *
 * §34: a restarted runtime resumes the recent conversation (bounded tail,
 * 48 h freshness) — the enabler for the §39 acceptance flow.
 * §14: shutdown() drives the state machine into the terminal SHUTTING_DOWN
 * state and is idempotent.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { ZaraRuntime } from "../src/ZaraRuntime";
import { SettingsStore, SecretStore, KVStorage, DEFAULT_SETTINGS } from "../src/core/configuration/Settings";
import { LLMProvider, ChatResponse } from "../src/cognition/provider/types";

/* --------------------------------- helpers -------------------------------- */

class MemoryKV implements KVStorage {
  private m = new Map<string, string>();
  async get(k: string) { return this.m.get(k) ?? null; }
  async set(k: string, v: string) { this.m.set(k, v); }
  async remove(k: string) { this.m.delete(k); }
}

// Node test env has no localStorage — stub it for the runtime's memory store.
const lsStub: Storage = (() => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => { m.clear(); },
    key: () => null,
    get length() { return m.size; }
  };
})();
const LS = (globalThis as { localStorage?: Storage }).localStorage;
beforeAll(() => { (globalThis as { localStorage?: Storage }).localStorage = lsStub; });
afterAll(() => { (globalThis as { localStorage?: Storage }).localStorage = LS; });

function fakeProvider(script: ChatResponse[], configured = true): LLMProvider {
  let i = 0;
  return {
    id: "fake", label: "Fake",
    isConfigured: async () => configured,
    validateCredentials: async () => {},
    chat: async () => script[Math.min(i++, script.length - 1)],
    chatStream: async () => script[0],
    structured: async () => ({})
  };
}

/** A runtime whose provider replies come from a script (no network). */
function makeRuntime(conversationKV: KVStorage) {
  const settings = new SettingsStore(new MemoryKV());
  const secrets = new SecretStore(new MemoryKV());
  const rt = new ZaraRuntime({ settings, secrets, conversationStorage: conversationKV });
  const cfg = { ...DEFAULT_SETTINGS };
  (rt.settings as unknown as { cache: typeof cfg }).cache = cfg;
  const provider = fakeProvider([
    { text: "Got it — we're working on the ZARA avatar.", toolCalls: [], finishReason: "stop" },
    { text: "Yesterday we were working on the ZARA avatar.", toolCalls: [], finishReason: "stop" }
  ]);
  (rt.providers as unknown as { active: () => LLMProvider }).active = () => provider;
  return rt;
}

/* ---------------------------- §34 restart continuity ----------------------- */

describe("§34 conversation continuity across restart (runtime)", () => {
  it("runtime A's conversation is restored by fresh runtime B on init()", async () => {
    const shared = new MemoryKV();

    // --- Session A: one real turn, then the process dies. ---
    const a = makeRuntime(shared);
    a.sm.transition("IDLE", "test");
    await a.handleUserText("We're working on the ZARA avatar today, remember that.");
    // History was persisted by pushHistory (§34).
    expect(shared.get("zara.conversation.v1")).resolves.toContain("ZARA avatar");

    // --- Session B: fresh runtime, same storage — a real restart. ---
    const b = makeRuntime(shared);
    const resumed: Array<{ role: string; text: string }> = [];
    b.bus.on("SESSION_RESUMED", r => { resumed.push(...r.messages); });
    await b.init();
    expect(b.sm.state).toBe("IDLE");

    // The restored transcript contains session A's user + model turns…
    expect(resumed.length).toBeGreaterThanOrEqual(2);
    expect(resumed.some(m => m.role === "user" && m.text.includes("ZARA avatar"))).toBe(true);
    expect(resumed.some(m => m.role === "model" && m.text.includes("ZARA avatar"))).toBe(true);

    // …and the LLM round-trip sees that history (continuity is real, not visual).
    const seen: Array<{ role: string; text: string }>[] = [];
    (b.providers as unknown as { active: () => LLMProvider }).active = () => ({
      ...fakeProvider([{ text: "Yesterday we worked on the ZARA avatar.", toolCalls: [], finishReason: "stop" }]),
      chat: async (req: { messages?: Array<{ role: string; text: string }> }) => {
        seen.push(req.messages ?? []);
        return { text: "Yesterday we worked on the ZARA avatar.", toolCalls: [], finishReason: "stop" };
      }
    });
    await b.handleUserText("What were we working on yesterday?");
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0].some(m => m.role === "user" && m.text.includes("ZARA avatar"))).toBe(true);

    b.shutdown();
  });

  it("a fresh install (empty storage) restores nothing and stays silent about it", async () => {
    const rt = makeRuntime(new MemoryKV());
    let resumedEvents = 0;
    rt.bus.on("SESSION_RESUMED", () => { resumedEvents++; });
    await rt.init();
    expect(resumedEvents).toBe(0);
    expect(rt.sm.state).toBe("IDLE");
    rt.shutdown();
  });

  it("SESSION_RESUMED is diag-logged for explainable continuity", async () => {
    const shared = new MemoryKV();
    const a = makeRuntime(shared);
    a.sm.transition("IDLE", "test");
    await a.handleUserText("hello there");

    const b = makeRuntime(shared);
    await b.init();
    const rec = b.diag.all.find(r => r.event === "SESSION_RESUMED");
    expect(rec).toBeDefined();
    expect(rec?.detail?.messages).toBeGreaterThan(0);
    b.shutdown();
  });
});

/* ------------------------------ §14 shutdown ------------------------------- */

describe("§14 SHUTTING_DOWN (runtime)", () => {
  it("shutdown() enters the terminal state and stops subsystems exactly once", async () => {
    const rt = makeRuntime(new MemoryKV());
    await rt.init();
    expect(rt.sm.state).toBe("IDLE");

    const stopSpy = vi.spyOn(rt.perception, "stop");
    rt.shutdown();
    expect(rt.sm.state).toBe("SHUTTING_DOWN");
    expect(stopSpy).toHaveBeenCalledTimes(1);

    // Idempotent: a second lifecycle hook (pagehide + visibilitychange…) must
    // not re-run teardown or attempt an (illegal) state revival.
    rt.shutdown();
    rt.shutdown();
    expect(stopSpy).toHaveBeenCalledTimes(1);
    expect(rt.sm.state).toBe("SHUTTING_DOWN");

    // The runtime cannot be revived out of SHUTTING_DOWN (terminal, §14).
    expect(rt.sm.transition("IDLE", "revive hack")).toBe(false);
  });

  it("mid-turn shutdown is legal: SPEAKING → SHUTTING_DOWN directly", async () => {
    const rt = makeRuntime(new MemoryKV());
    rt.sm.transition("IDLE", "t");
    rt.sm.transition("THINKING", "turn");
    rt.sm.transition("SPEAKING", "reply");
    rt.shutdown();
    expect(rt.sm.state).toBe("SHUTTING_DOWN");
  });
});
