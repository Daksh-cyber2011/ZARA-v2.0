import { describe, it, expect, beforeEach, vi } from "vitest";
import { ToolRegistry } from "../src/agent/tools/ToolRegistry";
import { buildAndroidTools, parseWhenToEpoch } from "../src/agent/tools/AndroidTools";
import { ToolContext, ToolResult } from "../src/agent/tools/ToolTypes";
import { verifyResult, outcomePhrase } from "../src/agent/verification/Verification";

type NativeOverride = () => Promise<ToolResult>;

function makeCtx(nativeOverrides: Record<string, NativeOverride> = {}): ToolContext {
  return {
    emitActionEvent: () => {},
    hasPermission: () => true,
    requestPermission: async () => true,
    native: new Proxy({} as Record<string, unknown>, {
      get: (_t, prop: string) => nativeOverrides[prop] ?? (async (): Promise<ToolResult> => ({
        ok: true, summary: `${prop} done`, data: { id: "123" }
      }))
    }) as unknown as ToolContext["native"],
    now: () => Date.now()
  };
}

describe("ToolRegistry (§15-16)", () => {
  let reg: ToolRegistry;
  beforeEach(() => {
    reg = new ToolRegistry();
    for (const t of buildAndroidTools()) reg.register(t);
  });

  it("registers the full Android tool set", () => {
    const names = reg.list().map(t => t.name);
    for (const expected of ["open_app", "web_search", "youtube_search", "create_reminder", "create_alarm", "prepare_message", "call_contact", "set_brightness", "toggle_flashlight", "media_control", "battery_info"]) {
      expect(names).toContain(expected);
    }
  });

  it("every tool declares risk + confirmation policy (tool contract §16)", () => {
    for (const t of reg.list()) {
      expect(["LOW", "MEDIUM", "HIGH"]).toContain(t.risk);
      expect(typeof t.requiresConfirmation).toBe("boolean");
      expect(t.timeoutMs).toBeGreaterThan(0);
      if (t.risk === "HIGH") expect(t.requiresConfirmation).toBe(true); // §17: HIGH always confirms
    }
  });

  it("HIGH-risk tools: calls/messages require confirmation", () => {
    expect(reg.get("prepare_message")!.risk).toBe("HIGH");
    expect(reg.get("call_contact")!.risk).toBe("HIGH");
    expect(reg.get("open_app")!.risk).toBe("LOW");
    expect(reg.get("create_reminder")!.risk).toBe("MEDIUM");
  });

  it("rejects unknown tools honestly", async () => {
    const r = await reg.execute("run_shell_command", {}, makeCtx());
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("TOOL_NOT_FOUND");
  });

  it("validates arguments before execution", async () => {
    const r = await reg.execute("open_app", { app: "" }, makeCtx());
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("TOOL_INVALID_ARGS");
  });

  it("executes via the native bridge and returns its real result", async () => {
    const r = await reg.execute("open_app", { app: "youtube" }, makeCtx({
      openApp: async () => ({ ok: true, summary: "YouTube opened.", data: { package: "com.google.android.youtube" } })
    }));
    expect(r.ok).toBe(true);
    expect(r.summary).toContain("YouTube");
  });

  it("propagates native failures (never fake success §19/§58)", async () => {
    const r = await reg.execute("open_app", { app: "nonexistentapp" }, makeCtx({
      openApp: async () => ({ ok: false, summary: "No app found matching that name.", error: { code: "APP_NOT_FOUND", message: "no match", retryable: false } })
    }));
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("APP_NOT_FOUND");
  });

  it("enforces execution timeout", async () => {
    const slow = {
      ...reg.get("battery_info")!,
      timeoutMs: 50,
      execute: () => new Promise<ToolResult>(resolve => setTimeout(() => resolve({ ok: true, summary: "late" }), 500))
    };
    const reg2 = new ToolRegistry();
    reg2.register(slow as never);
    const r = await reg2.execute("battery_info", {}, makeCtx());
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("TOOL_TIMEOUT");
  });

  it("declarations are generated for the model from one source of truth", () => {
    const decls = reg.declarations();
    expect(decls.length).toBe(reg.list().length);
    expect(decls.find(d => d.name === "prepare_message")!.description).toContain("confirmation");
  });
});

describe("Verification (§19)", () => {
  it("verified when tool reports ok with substance", () => {
    const tool = buildAndroidTools().find(t => t.name === "create_reminder")!;
    const v = verifyResult(tool, {
      ok: true, summary: "Reminder set for tomorrow 7 PM: study maths.", data: { id: "42" }
    });
    expect(v.status).toBe("verified");
    expect(outcomePhrase("create_reminder", v, { ok: true, summary: "Reminder set." })).toContain("Reminder set");
  });

  it("failed when tool reports failure — honest phrasing", () => {
    const tool = buildAndroidTools().find(t => t.name === "open_app")!;
    const v = verifyResult(tool, { ok: false, summary: "", error: { code: "APP_NOT_FOUND", message: "No app matched.", retryable: false } });
    expect(v.status).toBe("failed");
    expect(outcomePhrase("open_app", v, { ok: false, summary: "" })).toMatch(/couldn't complete/i);
  });

  it("unverified when success lacks verifiable substance", () => {
    const tool = buildAndroidTools().find(t => t.name === "create_reminder")!;
    const v = verifyResult(tool, { ok: true, summary: "ok" });
    expect(v.status).toBe("unverified");
  });
});

describe("Time parsing (Hinglish support §11, §35)", () => {
  const NOW = new Date("2026-08-27T10:00:00").getTime();

  it("parses ISO times", () => {
    expect(parseWhenToEpoch("2026-08-28T19:00:00", NOW)).toBe(Date.parse("2026-08-28T19:00:00"));
  });

  it("parses 'tomorrow 7pm'", () => {
    const r = parseWhenToEpoch("tomorrow 7pm", NOW);
    const d = new Date(r!);
    expect(d.getDate()).toBe(28);
    expect(d.getHours()).toBe(19);
  });

  it("parses 'kal 7 baje' as tomorrow evening (Hinglish)", () => {
    const r = parseWhenToEpoch("kal 7 baje", NOW);
    const d = new Date(r!);
    expect(d.getDate()).toBe(28);
    expect(d.getHours()).toBe(19);
  });

  it("parses 'at 19:30'", () => {
    const r = parseWhenToEpoch("at 19:30", NOW);
    expect(new Date(r!).getHours()).toBe(19);
    expect(new Date(r!).getMinutes()).toBe(30);
  });

  it("returns null for garbage", () => {
    expect(parseWhenToEpoch("whenever maybe", NOW)).toBeNull();
  });
});
