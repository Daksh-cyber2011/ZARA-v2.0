/**
 * ZARA V1.0 — Gemini adapter (chat / structured / streaming / tools).
 *
 * Isolates ALL @google/genai coupling in this one file, per the audit
 * decision. The key is read from SecretStore and never leaves this module
 * into prompts, logs, or diagnostics.
 */
import { GoogleGenAI, Type } from "@google/genai";
import {
  ChatMessage, ChatRequest, ChatResponse, CancellationToken, LLMError,
  LLMProvider, StreamEvent, ToolCallRequest, ToolDeclaration,
  classifyTransportError, withTimeoutRetry
} from "./types";
import { SecretStore } from "../../core/configuration/Settings";

type GeminiClient = GoogleGenAI;

/** Map ZARA chat messages → Gemini contents (EXPORTED for transport tests).
 * Tool rounds use native functionCall / functionResponse parts — text-only
 * replay makes models re-issue the same tool call in a loop. */
export function toGeminiContents(messages: ChatMessage[]): { role: string; parts: Record<string, unknown>[] }[] {
  return messages
    .filter(m => m.role !== "system")
    .map(m => {
      // Tool result → proper functionResponse part (Gemini protocol).
      if (m.role === "tool") {
        let response: Record<string, unknown>;
        try {
          response = m.toolResponse ?? (JSON.parse(m.text) as Record<string, unknown>);
        } catch {
          response = { result: m.text };
        }
        return {
          role: "user",
          parts: [{
            functionResponse: {
              name: m.toolName ?? "tool",
              response: { result: response }
            }
          }]
        };
      }
      // Model message that issued tool calls → replay functionCall parts.
      if (m.role === "model" && m.toolCalls?.length) {
        const parts: Record<string, unknown>[] = [];
        if (m.text) parts.push({ text: m.text });
        for (const c of m.toolCalls) {
          parts.push({ functionCall: { name: c.name, args: c.args } });
        }
        return { role: "model", parts };
      }
      return {
        role: m.role === "user" ? "user" : "model",
        parts: [{ text: m.text }]
      };
    });
}

export interface GeminiAdapterOptions {
  secrets: SecretStore;
  model: string;
  /** Optional API base-URL override ("" = official Google endpoint).
   * Used only for advanced proxy setups and honest mock testing. */
  baseUrl?: string;
  timeoutMs?: number;
  retries?: number;
}

export class GeminiProvider implements LLMProvider {
  readonly id = "gemini";
  readonly label = "Google Gemini";
  private client: GeminiClient | null = null;
  private clientKeyHash = 0;

  constructor(private opts: GeminiAdapterOptions) {}

  private async getClient(): Promise<GeminiClient> {
    const key = await this.opts.secrets.read("gemini");
    if (!key) throw new LLMError("LLM_NOT_CONFIGURED", "No Gemini API key configured. Add it in Settings.");
    // Rebuild client only when key changed (cheap hash, key never stored).
    const hash = key.length ^ key.charCodeAt(0) ^ key.charCodeAt(key.length - 1);
    if (!this.client || hash !== this.clientKeyHash) {
      const url = (this.opts.baseUrl || "").trim();
      this.client = new GoogleGenAI({
        apiKey: key,
        ...(url ? { httpOptions: { baseUrl: url } } : {})
      });
      this.clientKeyHash = hash;
    }
    return this.client;
  }

  async isConfigured(): Promise<boolean> {
    return await this.opts.secrets.has("gemini");
  }

  async validateCredentials(): Promise<void> {
    const ai = await this.getClient();
    try {
      const pager = await ai.models.list();
      await pager[Symbol.asyncIterator]().next();
    } catch (err) {
      throw classifyTransportError(err, "validating key");
    }
  }

  private toContents(messages: ChatMessage[]) {
    return toGeminiContents(messages);
  }

  private systemText(messages: ChatMessage[]): string | undefined {
    return messages.filter(m => m.role === "system").map(m => m.text).join("\n\n") || undefined;
  }

  private toGeminiTools(tools?: ToolDeclaration[]) {
    if (!tools?.length) return undefined;
    return [{
      functionDeclarations: tools.map(t => ({
        name: t.name,
        description: t.description,
        parameters: {
          type: Type.OBJECT,
          properties: Object.fromEntries(
            Object.entries(t.parameters.properties).map(([k, v]) => [k, {
              type: v.type === "number" ? Type.NUMBER
                : v.type === "integer" ? Type.INTEGER
                : v.type === "boolean" ? Type.BOOLEAN
                : Type.STRING,
              description: v.description,
              ...(v.enum ? { enum: v.enum } : {}),
              ...(v.nullable ? { nullable: true } : {})
            }])
          ),
          required: t.parameters.required
        }
      }))
    }];
  }

  async chat(req: ChatRequest, token?: CancellationToken): Promise<ChatResponse> {
    const ai = await this.getClient();
    const sys = this.systemText(req.messages);
    return withTimeoutRetry(async (signal) => {
      try {
        const res = await ai.models.generateContent({
          model: this.opts.model,
          contents: this.toContents(req.messages) as never,
          config: {
            ...(sys ? { systemInstruction: sys } : {}),
            ...(this.toGeminiTools(req.tools) ? { tools: this.toGeminiTools(req.tools) } : {}),
            temperature: req.temperature,
            maxOutputTokens: req.maxTokens,
            abortSignal: signal
          }
        });
        return this.parseResponse(res);
      } catch (err) {
        throw classifyTransportError(err);
      }
    }, { timeoutMs: this.opts.timeoutMs ?? 30000, retries: this.opts.retries ?? 2, token });
  }

  async chatStream(req: ChatRequest, onEvent: (e: StreamEvent) => void, token?: CancellationToken): Promise<ChatResponse> {
    const ai = await this.getClient();
    const sys = this.systemText(req.messages);
    return withTimeoutRetry(async (signal) => {
      try {
        const stream = await ai.models.generateContentStream({
          model: this.opts.model,
          contents: this.toContents(req.messages) as never,
          config: {
            ...(sys ? { systemInstruction: sys } : {}),
            ...(this.toGeminiTools(req.tools) ? { tools: this.toGeminiTools(req.tools) } : {}),
            temperature: req.temperature,
            maxOutputTokens: req.maxTokens,
            abortSignal: signal
          }
        });
        let text = "";
        const toolCalls: ToolCallRequest[] = [];
        let finish: ChatResponse["finishReason"] = "stop";
        for await (const chunk of stream) {
          if (token?.cancelled) throw new LLMError("LLM_CANCELLED", "Stream cancelled.");
          const cands = chunk.candidates ?? [];
          const parts = cands[0]?.content?.parts ?? [];
          for (const p of parts) {
            if (p.text) { text += p.text; onEvent({ type: "text", text: p.text }); }
            const fc = (p as { functionCall?: { name: string; args?: Record<string, unknown>; id?: string } }).functionCall;
            if (fc) {
              const call: ToolCallRequest = { id: fc.id ?? `tc_${Math.random().toString(36).slice(2, 10)}`, name: fc.name, args: fc.args ?? {} };
              toolCalls.push(call);
              onEvent({ type: "tool_call", toolCall: call });
            }
          }
          if (cands[0]?.finishReason) {
            const fr = String(cands[0].finishReason);
            finish = fr.includes("MAX_TOKENS") ? "max_tokens" : toolCalls.length ? "tool_call" : "stop";
          }
        }
        const response: ChatResponse = { text, toolCalls, finishReason: finish, usage: undefined };
        onEvent({ type: "done", finishReason: finish });
        return response;
      } catch (err) {
        throw classifyTransportError(err);
      }
    }, { timeoutMs: this.opts.timeoutMs ?? 60000, retries: this.opts.retries ?? 1, token });
  }

  async structured(req: ChatRequest, schema: Record<string, unknown>): Promise<Record<string, unknown>> {
    const ai = await this.getClient();
    const sys = this.systemText(req.messages);
    return withTimeoutRetry(async (signal) => {
      try {
        const res = await ai.models.generateContent({
          model: this.opts.model,
          contents: this.toContents(req.messages) as never,
          config: {
            ...(sys ? { systemInstruction: sys } : {}),
            responseMimeType: "application/json",
            responseSchema: schema as never,
            temperature: req.temperature ?? 0.2,
            abortSignal: signal
          }
        });
        const raw = res.text?.trim() || "{}";
        return JSON.parse(raw) as Record<string, unknown>;
      } catch (err) {
        throw classifyTransportError(err);
      }
    }, { timeoutMs: this.opts.timeoutMs ?? 45000, retries: this.opts.retries ?? 2, token: undefined });
  }

  private parseResponse(res: { candidates?: { content?: { parts?: unknown[] }, finishReason?: unknown }[]; text?: string; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } }): ChatResponse {
    const parts = (res.candidates?.[0]?.content?.parts ?? []) as { text?: string; functionCall?: { name: string; args?: Record<string, unknown>; id?: string } }[];
    let text = "";
    const toolCalls: ToolCallRequest[] = [];
    for (const p of parts) {
      if (p.text) text += p.text;
      if (p.functionCall) {
        toolCalls.push({ id: p.functionCall.id ?? `tc_${Math.random().toString(36).slice(2, 10)}`, name: p.functionCall.name, args: p.functionCall.args ?? {} });
      }
    }
    if (!text && res.text) text = res.text;
    const fr = String(res.candidates?.[0]?.finishReason ?? "STOP");
    return {
      text,
      toolCalls,
      finishReason: fr.includes("MAX") ? "max_tokens" : toolCalls.length ? "tool_call" : "stop",
      usage: {
        inputTokens: res.usageMetadata?.promptTokenCount,
        outputTokens: res.usageMetadata?.candidatesTokenCount
      }
    };
  }
}
