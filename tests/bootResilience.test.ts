/**
 * ZARA V1.0 — Boot resilience tests (Directive §18/§19, §41 BOOT).
 *
 * The user previously hit "ZARA is waking up…" for MINUTES. These tests prove
 * that can structurally never recur: every boot stage is timeout-bounded and
 * guarded; hanging storage / memory / perception degrades instead of freezing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BootTracker } from "../src/core/logging/BootTracker";
import { ZaraRuntime } from "../src/ZaraRuntime";
import { KVStorage, SecretStore } from "../src/core/configuration/Settings";

/** In-memory secret store — bare-Node test env has no localStorage. */
function fakeSecrets(): SecretStore {
  const mem: Record<string, string> = {};
  const kv: KVStorage = {
    get: async k => mem[k] ?? null,
    set: async (k, v) => { mem[k] = v; },
    remove: async k => { delete mem[k]; }
  };
  return new SecretStore(kv);
}

describe("BootTracker (§18/§19)", () => {
  it("records OK stages with durations", async () => {
    const t = new BootTracker();
    const r = await t.run("CORE_INIT", async () => 42, { timeoutMs: 1000, fallback: 0 });
    expect(r.ok).toBe(true);
    expect(r.value).toBe(42);
    const s = t.snapshot();
    const core = s.stages.find(x => x.id === "CORE_INIT")!;
    expect(core.status).toBe("OK");
    expect(core.durationMs).not.toBeNull();
    expect(core.error).toBeNull();
  });

  it("times out a HANGING stage → DEGRADED with fallback, never hangs (§18)", async () => {
    const t = new BootTracker();
    const r = await t.run("STORAGE", () => new Promise<string>(resolve => {
      // never resolves — the pathological case
      void resolve;
    }), { timeoutMs: 50, fallback: "safe-default", onFallback: "storage unavailable" });
    expect(r.ok).toBe(false);
    expect(r.value).toBe("safe-default");
    const st = t.snapshot().stages.find(x => x.id === "STORAGE")!;
    expect(st.status).toBe("DEGRADED");
    expect(st.error).toContain("timeout");
    expect(st.fallback).toBe("storage unavailable");
  });

  it("guards a REJECTING stage → DEGRADED, error recorded briefly", async () => {
    const t = new BootTracker();
    const r = await t.run("MEMORY", async () => {
      throw new Error("disk corrupted");
    }, { timeoutMs: 1000, fallback: undefined, onFallback: "memory degraded" });
    expect(r.ok).toBe(false);
    const st = t.snapshot().stages.find(x => x.id === "MEMORY")!;
    expect(st.status).toBe("DEGRADED");
    expect(st.error).toContain("disk corrupted");
  });

  it("marks the external AVATAR stage (§18: avatar never blocks boot)", () => {
    const t = new BootTracker();
    t.markExternal("AVATAR", "DEGRADED", { fallback: "VRM unavailable — procedural" });
    const st = t.snapshot().stages.find(x => x.id === "AVATAR")!;
    expect(st.status).toBe("DEGRADED");
    expect(st.fallback).toContain("procedural");
  });

  it("complete() records total time and the snapshot flags degradation", async () => {
    const t = new BootTracker();
    await t.run("CORE_INIT", async () => 1, { timeoutMs: 100, fallback: 0 });
    t.complete();
    const s = t.snapshot();
    expect(s.complete).toBe(true);
    expect(s.totalMs).toBeGreaterThanOrEqual(0);
    expect(s.degraded).toBe(false);
    const t2 = new BootTracker();
    await t2.run("PERCEPTION", () => new Promise<void>(() => {}), { timeoutMs: 20, fallback: undefined });
    t2.complete();
    expect(t2.snapshot().degraded).toBe(true);
  });

  it("summaryLine() renders the §19 example format", async () => {
    const t = new BootTracker();
    await t.run("CORE_INIT", async () => 1, { timeoutMs: 100, fallback: 0 });
    t.complete();
    const line = t.summaryLine();
    expect(line).toContain("Boot: complete");
    expect(line).toContain("Core Init: READY");
  });
});

describe("ZaraRuntime resilient boot (§18)", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  function hangingStorage(): KVStorage {
    return {
      get: () => new Promise<string | null>(() => {}), // never settles
      set: () => new Promise<void>(() => {}),
      remove: () => new Promise<void>(() => {})
    };
  }

  it("init() completes even when conversation STORAGE hangs forever (§18 watchdog)", async () => {
    const rt = new ZaraRuntime({ conversationStorage: hangingStorage() });
    const p = rt.init();
    // Advance virtual time past the STORAGE budget (3s).
    await vi.advanceTimersByTimeAsync(3500);
    await p; // must resolve — NOT hang
    expect(rt.sm.state).toBe("IDLE");
    const boot = rt.bootTracker.snapshot();
    expect(boot.complete).toBe(true);
    expect(boot.degraded).toBe(true);
    const storage = boot.stages.find(s => s.id === "STORAGE")!;
    expect(storage.status).toBe("DEGRADED");
    expect(storage.error).toContain("timeout");
  });

  it("statusSnapshot() exposes the boot record (§19 observability)", async () => {
    const rt = new ZaraRuntime({ conversationStorage: hangingStorage() });
    const p = rt.init();
    await vi.advanceTimersByTimeAsync(30000); // all budgets elapse
    await p;
    const snap = rt.statusSnapshot();
    expect(snap.boot.complete).toBe(true);
    expect(snap.boot.degraded).toBe(true);
    expect(snap.boot.stages.length).toBe(9);
    expect(snap.boot.stages.some(s => s.status === "OK")).toBe(true);
    expect(snap.boot.stages.find(s => s.id === "STORAGE")!.status).toBe("DEGRADED");
  });

  it("a healthy boot has zero degraded stages", async () => {
    const mem: Record<string, string> = {};
    const healthy: KVStorage = {
      get: async k => mem[k] ?? null,
      set: async (k, v) => { mem[k] = v; },
      remove: async k => { delete mem[k]; }
    };
    const rt = new ZaraRuntime({ conversationStorage: healthy, secrets: fakeSecrets() });
    await rt.init();
    expect(rt.sm.state).toBe("IDLE");
    const boot = rt.bootTracker.snapshot();
    expect(boot.complete).toBe(true);
    expect(boot.degraded).toBe(false);
    for (const s of boot.stages) {
      if (s.id === "AVATAR") continue; // marked externally by the UI layer
      expect(s.status).toBe("OK");
    }
    rt.shutdown();
    expect(rt.sm.state).toBe("SHUTTING_DOWN");
  });
});
