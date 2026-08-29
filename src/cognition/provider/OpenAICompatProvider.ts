/**
 * ZARA V1.0 — OpenAI-compatible adapter (works with OpenAI, Groq, Together,
 * DeepSeek, z.ai, Ollama-style endpoints … any /v1/chat/completions server).
 *
 * Raw fetch — no SDK coupling. Key stays in this module.
 */
import {
  ChatMessage, ChatRequest, ChatResponse, CancellationToken, LLMError,
  LLMProvider, StreamEvent, ToolCallRequest, ToolDeclaration,
  classifyTransportError, withTimeoutRetry
} from "./types";
import { SecretStore } from "../../core/configuration/Settings";

export interface OpenAICompatOptions {
  secrets: SecretStore;
  baseUrl: string;
  model: string;
  timeoutMs?: number;
  retries?: number;
}

interface OAIFunctionCall { id?: string; name: string; arguments: string }

export class OpenAICompatProvider implements LLMProvider {
  readonly id = "openai-compat";
  readonly label = "OpenAI-compatible";
  constructor(private opts: OpenAICompatOptions) {}

  private async headers(): Promise<Record<string, string>> {
    const key = await this.opts.secrets.read("openai");
    if (!key) throw new LLMError("LLM_NOT_CONFIGURED", "No API key configured for the OpenAI-compatible provider. Add it in Settings.");
    return { "Content-Type": "application/json", Authorization: `Bearer ${key}` };
  }

  async isConfigured(): Promise<boolean> {
    return await this.opts.secrets.has("openai");
  }

  async validateCredentials(): Promise<void> {
    const headers = await this.headers();
    try {
      const res = await fetch(`${this.opts.baseUrl.replace(/\/$/, "")}/models`, { headers });
      if (res.status === 401 || res.status === 403) throw new LLMError("LLM_AUTH_ERROR", "Key rejected by endpoint.");
      if (!res.ok) throw new LLMError("LLM_PROVIDER_ERROR", `Endpoint returned ${res.status}`);
    } catch (err) {
      throw classifyTransportError(err, "validating key");
    }
  }

  private toMessages(messages: ChatMessage[]) {
    // OpenAI-protocol tool rounds: assistant tool_calls + tool_call_id replay.
    return messages.map(m => {
      if (m.role === "model" && m.toolCalls?.length) {
        return {
          role: "assistant",
          content: m.text || null,
          tool_calls: m.toolCalls.map(c => ({
            id: c.id,
            type: "function",
            function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) }
          }))
        };
      }
      if (m.role === "tool") {
        return {
          role: "tool",
          tool_call_id: m.toolCallId ?? `call_${m.toolName ?? "tool"}`,
          name: m.toolName,
          content: m.text
        };
      }
      return {
        role: m.role === "model" ? "assistant" : m.role,
        content: m.text
      };
    });
  }

  private toTools(tools?: ToolDeclaration[]) {
    if (!tools?.length) return undefined;
    return {
      tools: [{
        type: "function",
        function: {
          name: "zara_tools",
          description: "Execute a registered ZARA device action.",
          parameters: {
            type: "object",
            properties: {
              tool: { type: "string", enum: tools.map(t => t.name), description: "Tool to execute" },
              args_json: { type: "string", description: "JSON-encoded arguments for the tool" }
            },
            required: ["tool", "args_json"]
          }
        }
      }],
      tool_choice: "auto"
    };
  }

  private parseToolCalls(raw: OAIFunctionCall[] | undefined, toolNames: Set<string>): ToolCallRequest[] {
    const calls: ToolCallRequest[] = [];
    for (const fc of raw ?? []) {
      // Flatten the wrapper into individual tool calls when the model used it.
      if (fc.name === "zara_tools") {
        try {
          const parsed = JSON.parse(fc.arguments || "{}");
          if (parsed.tool && toolNames.has(parsed.tool)) {
            const args = typeof parsed.args_json === "string" ? JSON.parse(parsed.args_json || "{}") : (parsed.args_json ?? {});
            calls.push({ id: fc.id ?? `tc_${Math.random().toString(36).slice(2, 10)}`, name: parsed.tool, args });
          }
        } catch { /* malformed wrapper — skip */ }
      }
    }
    return calls;
  }

  async chat(req: ChatRequest, token?: CancellationToken): Promise<ChatResponse> {
    const headers = await this.headers();
    const tools = this.toTools(req.tools);
    const toolNames = new Set(req.tools?.map(t => t.name) ?? []);
    return withTimeoutRetry(async (signal) => {
      try {
        const res = await fetch(`${this.opts.baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers,
          signal,
          body: JSON.stringify({
            model: this.opts.model,
            messages: this.toMessages(req.messages),
            ...(tools ?? {}),
            temperature: req.temperature,
            max_tokens: req.maxTokens
          })
        });
        if (res.status === 401 || res.status === 403) throw new LLMError("LLM_AUTH_ERROR", "Key rejected.");
        if (res.status === 429) throw new LLMError("LLM_RATE_LIMIT", "Rate limited.", true);
        if (!res.ok) throw new LLMError("LLM_PROVIDER_ERROR", `Endpoint returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
        const data = await res.json() as { choices?: { message?: { content?: string; tool_calls?: OAIFunctionCall[] }, finish_reason?: string }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
        const msg = data.choices?.[0]?.message;
        const toolCalls = this.parseToolCalls(msg?.tool_calls, toolNames);
        return {
          text: msg?.content ?? "",
          toolCalls,
          finishReason: toolCalls.length ? "tool_call" : data.choices?.[0]?.finish_reason === "length" ? "max_tokens" : "stop",
          usage: { inputTokens: data.usage?.prompt_tokens, outputTokens: data.usage?.completion_tokens }
        };
      } catch (err) {
        throw classifyTransportError(err);
      }
    }, { timeoutMs: this.opts.timeoutMs ?? 30000, retries: this.opts.retries ?? 2, token });
  }

  async chatStream(req: ChatRequest, onEvent: (e: StreamEvent) => void, token?: CancellationToken): Promise<ChatResponse> {
    const headers = await this.headers();
    const tools = this.toTools(req.tools);
    const toolNames = new Set(req.tools?.map(t => t.name) ?? []);
    return withTimeoutRetry(async (signal) => {
      try {
        const res = await fetch(`${this.opts.baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers,
          signal,
          body: JSON.stringify({
            model: this.opts.model,
            messages: this.toMessages(req.messages),
            ...(tools ?? {}),
            stream: true,
            temperature: req.temperature,
            max_tokens: req.maxTokens
          })
        });
        if (!res.ok || !res.body) throw new LLMError("LLM_PROVIDER_ERROR", `Endpoint returned ${res.status}`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let text = "";
        const toolCalls: ToolCallRequest[] = [];
        let buffer = "";
        for (;;) {
          if (token?.cancelled) { reader.cancel().catch(() => {}); throw new LLMError("LLM_CANCELLED", "Stream cancelled."); }
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const s = line.trim();
            if (!s.startsWith("data:")) continue;
            const payload = s.slice(5).trim();
            if (payload === "[DONE]") continue;
            try {
              const j = JSON.parse(payload) as { choices?: { delta?: { content?: string; tool_calls?: OAIFunctionCall[] } }[] };
              const delta = j.choices?.[0]?.delta;
              if (delta?.content) { text += delta.content; onEvent({ type: "text", text: delta.content }); }
              if (delta?.tool_calls) toolCalls.push(...this.parseToolCalls(delta.tool_calls, toolNames));
            } catch { /* skip malformed chunk */ }
          }
        }
        const response: ChatResponse = { text, toolCalls, finishReason: toolCalls.length ? "tool_call" : "stop" };
        onEvent({ type: "done", finishReason: response.finishReason });
        return response;
      } catch (err) {
        throw classifyTransportError(err);
      }
    }, { timeoutMs: this.opts.timeoutMs ?? 60000, retries: this.opts.retries ?? 1, token });
  }

  async structured(req: ChatRequest, schema: Record<string, unknown>): Promise<Record<string, unknown>> {
    // json_schema / json_object support varies by endpoint — use prompt-based
    // JSON with strict instruction + response_format json_object when possible.
    const headers = await this.headers();
    return withTimeoutRetry(async (signal) => {
      try {
        const res = await fetch(`${this.opts.baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers,
          signal,
          body: JSON.stringify({
            model: this.opts.model,
            messages: [
              ...this.toMessages(req.messages),
              { role: "system", content: `Respond ONLY with a JSON object matching this schema (no prose, no markdown fence):\n${JSON.stringify(schema)}` }
            ],
            response_format: { type: "json_object" },
            temperature: req.temperature ?? 0.2
          })
        });
        if (!res.ok) throw new LLMError("LLM_PROVIDER_ERROR", `Endpoint returned ${res.status}`);
        const data = await res.json() as { choices?: { message?: { content?: string } }[] };
        const raw = data.choices?.[0]?.message?.content?.trim() ?? "{}";
        try { return JSON.parse(raw) as Record<string, unknown>; }
        catch {
          // Some endpoints ignore response_format — recover fenced JSON.
          const m = raw.match(/\{[\s\S]*\}/);
          if (m) return JSON.parse(m[0]) as Record<string, unknown>;
          throw new LLMError("LLM_BAD_REQUEST", "Provider returned non-JSON for a structured request.");
        }
      } catch (err) {
        throw classifyTransportError(err);
      }
    }, { timeoutMs: this.opts.timeoutMs ?? 45000, retries: this.opts.retries ?? 2, token: undefined });
  }
}
