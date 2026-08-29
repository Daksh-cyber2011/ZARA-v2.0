/**
 * ZARA V1.0 Phase 2 — GLM provider tests (Directive §12, §13, §34).
 *
 * Mocked fetch: the transport is real code under test (request shaping,
 * tool-call parsing, streaming, error classification, fail-safe behavior).
 * Live network behavior is documented as UNVERIFIED without a real key.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GLMProvider } from "../src/cognition/provider/GLMProvider";
import { LLMError, ToolDeclaration } from "../src/cognition/provider/types";
import { SecretStore, KVStorage } from "../src/core/configuration/Settings";

/* ------------------------------- helpers ---------------------------------- */

class MemKV implements KVStorage {
  private m = new Map<string, string>();
  async get(k: string) { return this.m.get(k) ?? null; }
  async set(k: string, v: string) { this.m.set(k, v); }
  async remove(k: string) { this.m.delete(k); }
}

function makeProvider(key = "test-key"): GLMProvider {
  const kv = new MemKV();
  const secrets = new SecretStore(kv);
  void secrets.set("glm", key);
  return new GLMProvider({
    secrets,
    baseUrl: "https://api.z.ai/api/paas/v4",
    model: "glm-5.2",
    timeoutMs: 2000,
    retries: 0
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function sseResponse(chunks: unknown[]): Response {
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      for (const c of chunks) controller.enqueue(enc.encode(`data: ${JSON.stringify(c)}\n\n`));
      controller.enqueue(enc.encode("data: [DONE]\n\n"));
      controller.close();
    }
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

const TOOLS: ToolDeclaration[] = [{
  name: "open_app",
  description: "Open an app",
  parameters: { type: "object", properties: { app: { type: "string" } }, required: ["app"] }
}];

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => {
  vi.restoreAllMocks();
});

/* --------------------------------- tests ----------------------------------- */

describe("GLMProvider (§12 — Phase 2 primary)", () => {
  it("is not configured without a key and fails honestly", async () => {
    const kv = new MemKV();
    const p = new GLMProvider({ secrets: new SecretStore(kv), baseUrl: "https://api.z.ai/api/paas/v4", model: "glm-5.2" });
    expect(await p.isConfigured()).toBe(false);
    await expect(p.chat({ messages: [{ role: "user", text: "hi" }] }))
      .rejects.toMatchObject({ code: "LLM_NOT_CONFIGURED" });
  });

  it("sends the OpenAI-compatible body with thinking disabled by default", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "Namaste!" }, finish_reason: "stop" }], usage: { prompt_tokens: 9, completion_tokens: 3 } }));
    const p = makeProvider();
    const res = await p.chat({ messages: [{ role: "user", text: "hi" }], temperature: 0.5 });
    expect(res.text).toBe("Namaste!");
    expect(res.finishReason).toBe("stop");
    expect(res.usage?.inputTokens).toBe(9);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.model).toBe("glm-5.2");
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.temperature).toBe(0.5);
    expect((fetchMock.mock.calls[0][0] as string)).toBe("https://api.z.ai/api/paas/v4/chat/completions");
  });

  it("sends thinking enabled when configured", async () => {
    const kv = new MemKV();
    const secrets = new SecretStore(kv);
    void secrets.set("glm", "k");
    const p = new GLMProvider({ secrets, baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-5.2", thinking: true, retries: 0 });
    fetchMock.mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "ok" } }] }));
    await p.chat({ messages: [{ role: "user", text: "hi" }] });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.thinking).toEqual({ type: "enabled" });
  });

  it("parses NATIVE GLM tool calls (§13 structured intent)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      choices: [{
        message: {
          content: "",
          tool_calls: [{ id: "call_1", type: "function", function: { name: "open_app", arguments: "{\"app\":\"youtube\"}" } }]
        },
        finish_reason: "tool_calls"
      }]
    }));
    const p = makeProvider();
    const res = await p.chat({ messages: [{ role: "user", text: "open youtube" }], tools: TOOLS });
    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls[0].name).toBe("open_app");
    expect(res.toolCalls[0].args).toEqual({ app: "youtube" });
    expect(res.finishReason).toBe("tool_call");
  });

  it("skips malformed tool-call arguments safely (§13 fail-safe)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      choices: [{
        message: {
          content: "Hmm.",
          tool_calls: [
            { id: "c1", function: { name: "open_app", arguments: "{not json" } },
            { id: "c2", function: { name: "unknown_tool", arguments: "{}" } }
          ]
        }
      }]
    }));
    const p = makeProvider();
    const res = await p.chat({ messages: [{ role: "user", text: "x" }], tools: TOOLS });
    expect(res.toolCalls).toHaveLength(0); // malformed + unknown both dropped
    expect(res.text).toBe("Hmm.");
  });

  it("classifies 401/429 as AUTH/RATE_LIMIT (§32 typed errors)", async () => {
    const p = makeProvider();
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { code: 401, message: "bad key" } }, 401));
    await expect(p.chat({ messages: [{ role: "user", text: "x" }] })).rejects.toMatchObject({ code: "LLM_AUTH_ERROR" });
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { code: 1301, message: "rate" } }, 429));
    await expect(p.chat({ messages: [{ role: "user", text: "x" }] })).rejects.toMatchObject({ code: "LLM_RATE_LIMIT", retryable: true });
  });

  it("streams SSE text deltas and tool calls", async () => {
    fetchMock.mockResolvedValueOnce(sseResponse([
      { choices: [{ delta: { content: "Theek " } }] },
      { choices: [{ delta: { content: "hai." } }] },
      { choices: [{ delta: { content: "", tool_calls: [{ id: "c9", function: { name: "open_app", arguments: "{\"app\":\"maps\"}" } }] } }] }
    ]));
    const p = makeProvider();
    const events: string[] = [];
    const res = await p.chatStream({ messages: [{ role: "user", text: "x" }], tools: TOOLS }, e => {
      if (e.type === "text") events.push(e.text!);
    });
    expect(events.join("")).toBe("Theek hai.");
    expect(res.text).toBe("Theek hai.");
    expect(res.toolCalls.map(c => c.name)).toEqual(["open_app"]);
  });

  it("structured(): parses clean JSON and recovers fenced JSON (§20 malformed output)", async () => {
    const p = makeProvider();
    fetchMock.mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "{\"speak\":true,\"line\":\"hi\"}" } }] }));
    const out1 = await p.structured({ messages: [{ role: "user", text: "x" }] }, { speak: "boolean" });
    expect(out1).toEqual({ speak: true, line: "hi" });

    fetchMock.mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "```json\n{\"speak\":false}\n```" } }] }));
    const out2 = await p.structured({ messages: [{ role: "user", text: "x" }] }, { speak: "boolean" });
    expect(out2).toEqual({ speak: false });
  });

  it("structured(): non-JSON output → typed BAD_REQUEST, never fabricated", async () => {
    const p = makeProvider();
    fetchMock.mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "I cannot answer that in JSON." } }] }));
    await expect(p.structured({ messages: [{ role: "user", text: "x" }] }, {}))
      .rejects.toMatchObject({ code: "LLM_BAD_REQUEST" });
  });

  it("validateCredentials rejects bad keys honestly", async () => {
    const p = makeProvider("bad-key");
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: "invalid api key" } }, 401));
    await expect(p.validateCredentials()).rejects.toMatchObject({ code: "LLM_AUTH_ERROR" });
  });

  it("uses Bearer auth with the stored key only (§31 no key leakage)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "ok" } }] }));
    const p = makeProvider("secret-key-123");
    await p.chat({ messages: [{ role: "user", text: "x" }] });
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer secret-key-123");
  });
});
