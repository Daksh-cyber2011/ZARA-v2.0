/**
 * FINAL-INTEGRATION — tool-round transport tests.
 * The runtime-path bug these pin: tool results used to be replayed as PLAIN
 * TEXT, so models re-issued the same tool call until the step budget died
 * ("I stopped after several steps to avoid running in a loop"). The mappings
 * must emit NATIVE functionCall / functionResponse structures.
 */
import { describe, it, expect } from "vitest";
import { toGeminiContents } from "../src/cognition/provider/GeminiProvider";
import { ChatMessage } from "../src/cognition/provider/types";

describe("Gemini transport — structured tool rounds", () => {
  const roundTrip: ChatMessage[] = [
    { role: "system", text: "persona" },
    { role: "user", text: "open youtube" },
    { role: "model", text: "", toolCalls: [{ id: "tc_1", name: "open_app", args: { app: "youtube" } }] },
    { role: "tool", text: "{\"ok\":false}", toolName: "open_app", toolCallId: "tc_1", toolResponse: { ok: false, error: "needs device" } }
  ];

  it("replays the model's tool call as a native functionCall part", () => {
    const contents = toGeminiContents(roundTrip);
    const modelContent = contents.find(c => c.role === "model");
    expect(modelContent).toBeDefined();
    const fc = modelContent!.parts.find(p => "functionCall" in p) as { functionCall: { name: string; args: Record<string, unknown> } };
    expect(fc.functionCall.name).toBe("open_app");
    expect(fc.functionCall.args).toEqual({ app: "youtube" });
  });

  it("sends tool results as native functionResponse parts (never plain text)", () => {
    const contents = toGeminiContents(roundTrip);
    const frContent = contents.find(c => c.parts.some(p => "functionResponse" in p));
    expect(frContent).toBeDefined();
    const part = frContent!.parts.find(p => "functionResponse" in p) as { functionResponse: { name: string; response: { result: unknown } } };
    expect(part.functionResponse.name).toBe("open_app");
    expect((part.functionResponse.response.result as { ok: boolean }).ok).toBe(false);
    // No content carries the raw JSON as text-only model content:
    const textOnlyModel = contents.filter(c => c.role === "model").flatMap(c => c.parts).every(p => !("text" in p) || (p as { text: string }).text !== "{\"ok\":false}");
    expect(textOnlyModel).toBe(true);
  });

  it("falls back to parsing tool text when the structured payload is absent", () => {
    const contents = toGeminiContents([
      { role: "tool", text: "{\"ok\":true}", toolName: "get_weather" }
    ]);
    const part = contents[0].parts[0] as { functionResponse: { name: string; response: { result: { ok: boolean } } } };
    expect(part.functionResponse.name).toBe("get_weather");
    expect(part.functionResponse.response.result.ok).toBe(true);
  });

  it("survives non-JSON tool text without throwing", () => {
    const contents = toGeminiContents([{ role: "tool", text: "plain result", toolName: "x" }]);
    const part = contents[0].parts[0] as { functionResponse: { response: { result: { result: string } } } };
    expect(part.functionResponse.response.result.result).toBe("plain result");
  });

  it("keeps system messages out of contents (they ride in systemInstruction)", () => {
    const contents = toGeminiContents(roundTrip);
    expect(contents.every(c => c.role === "user" || c.role === "model")).toBe(true);
  });
});
