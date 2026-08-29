/**
 * ZARA V1.0 Phase 2 — GLM provider (Directive §12).
 *
 * The PRIMARY reasoning provider for this development phase: GLM 5.2 via the
 * Z.ai / BigModel OpenAI-compatible chat-completions contract (verified
 * against the z-ai-web-dev-sdk transport: POST {baseUrl}/chat/completions,
 * Authorization: Bearer, OpenAI-style body + `thinking` parameter, SSE
 * streaming, native parallel tool_calls).
 *
 * Design rules honored:
 *  - No hardwired endpoint: baseUrl + model come from settings (§12).
 *  - Key never logged, never in prompts; read at adapter level only (§31).
 *  - Honest typed errors; no fabricated responses (§32).
 *  - Tool calls are parsed but NEVER executed here — the agent layer owns
 *    validation, confirmation and execution (§13-14).
 */
import {
  ChatMessage, ChatRequest, ChatResponse, CancellationToken, LLMError,
  LLMProvider, StreamEvent, ToolCallRequest, ToolDeclaration,
  classifyTransportError, withTimeoutRetry
} from "./types";
import { SecretStore } from "../../core/configuration/Settings";

export interface GLMProviderOptions {
  secrets: SecretStore;
  /** e.g. "https://api.z.ai/api/paas/v4" (intl) or "https://open.bigmodel.cn/api/paas/v4" (CN). */
  baseUrl: string;
  /** e.g. "glm-5.2". */
  model: string;
  /** Enable GLM reasoning mode (chain-of-thought). Default: disabled (voice latency). */
  thinking?: boolean;
  timeoutMs?: number;
  retries?: number;
}

interface GLMFunctionCall {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
  // Non-wrapped form some GLM models emit:
  name?: string;
  arguments?: unknown;
}

interface GLMChatResponseBody {
  choices?: {
    message?: { content?: string | null; tool_calls?: GLMFunctionCall[]; reasoning_content?: string | null };
    finish_reason?: string;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { code?: string | number; message?: string };
}

/** Streaming delta shape (SSE `data:` lines). */
interface GLMStreamDelta {
  choices?: { delta?: { content?: string | null; reasoning_content?: string | null; tool_calls?: GLMFunctionCall[] }; finish_reason?: string | null }[];
}

export class GLMProvider implements LLMProvider {
  readonly id = "glm";
  readonly label = "GLM (Z.ai / BigModel)";
  private toolSeq = 0;

  constructor(private opts: GLMProviderOptions) {}

  private get endpoint(): string {
    return `${this.opts.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  }

  private async headers(): Promise<Record<string, string>> {
    const key = await this.opts.secrets.read("glm");
    if (!key) {
      throw new LLMError(
        "LLM_NOT_CONFIGURED",
        "No GLM API key configured. Add your Z.ai / BigModel key in Settings."
      );
    }
    return { "Content-Type": "application/json", Authorization: `Bearer ${key}` };
  }

  async isConfigured(): Promise<boolean> {
    return await this.opts.secrets.has("glm");
  }

  async validateCredentials(): Promise<void> {
    const headers = await this.headers();
    // Cheapest honest validation: a 1-token chat request. GLM has no free
    // /models listing on all plans, so this is the reliable contract probe.
    try {
      const res = await fetch(this.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: this.opts.model,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1,
          thinking: { type: "disabled" }
        })
      });
      if (res.status === 401 || res.status === 403) throw new LLMError("LLM_AUTH_ERROR", "GLM key rejected by endpoint.");
      if (res.status === 404) throw new LLMError("LLM_BAD_REQUEST", `Endpoint or model not found (404). Check base URL and model "${this.opts.model}".`);
      if (res.status === 429) throw new LLMError("LLM_RATE_LIMIT", "Rate limited while validating key.", true);
      if (!res.ok) throw new LLMError("LLM_PROVIDER_ERROR", `GLM endpoint returned ${res.status}.`);
    } catch (err) {
      throw classifyTransportError(err, "validating GLM key");
    }
  }

  /* ------------------------------ body shaping ----------------------------- */

  private toMessages(messages: ChatMessage[]) {
    // OpenAI-protocol tool rounds: assistant message carries tool_calls; tool
    // results carry tool_call_id + name. Text-only replay makes models loop.
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

  /**
   * GLM supports NATIVE parallel tool calls (no wrapper function needed —
   * unlike some OpenAI-compat endpoints). Tools pass through as-is.
   */
  private toTools(tools?: ToolDeclaration[]) {
    if (!tools?.length) return undefined;
    return {
      tools: tools.map(t => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters
        }
      })),
      tool_choice: "auto"
    };
  }

  /** Parse GLM tool_calls (OpenAI-shaped, with a defensive fallback shape). */
  parseToolCalls(raw: GLMFunctionCall[] | undefined, toolNames: Set<string>): ToolCallRequest[] {
    const calls: ToolCallRequest[] = [];
    for (const fc of raw ?? []) {
      const name = fc.function?.name ?? fc.name;
      if (!name || !toolNames.has(name)) continue;
      let args: Record<string, unknown> = {};
      const rawArgs = fc.function?.arguments ?? fc.arguments;
      if (typeof rawArgs === "string" && rawArgs.trim()) {
        try { args = JSON.parse(rawArgs) as Record<string, unknown>; }
        catch { continue; } // malformed arguments — skip this call, fail safely (§13)
      } else if (rawArgs && typeof rawArgs === "object") {
        args = rawArgs as Record<string, unknown>;
      }
      calls.push({ id: fc.id ?? `glm_tc_${++this.toolSeq}`, name, args });
    }
    return calls;
  }

  private classifyStatus(res: Response): LLMError | null {
    if (res.status === 401 || res.status === 403) return new LLMError("LLM_AUTH_ERROR", "GLM key rejected.");
    if (res.status === 429) return new LLMError("LLM_RATE_LIMIT", "GLM rate limit hit.", true);
    if (res.status === 400) return new LLMError("LLM_BAD_REQUEST", "GLM rejected the request (400).");
    return null;
  }

  /* --------------------------------- chat ---------------------------------- */

  async chat(req: ChatRequest, token?: CancellationToken): Promise<ChatResponse> {
    const headers = await this.headers();
    const tools = this.toTools(req.tools);
    const toolNames = new Set(req.tools?.map(t => t.name) ?? []);
    return withTimeoutRetry(async (signal) => {
      try {
        const res = await fetch(this.endpoint, {
          method: "POST",
          headers,
          signal,
          body: JSON.stringify({
            model: this.opts.model,
            messages: this.toMessages(req.messages),
            ...(tools ?? {}),
            temperature: req.temperature,
            max_tokens: req.maxTokens,
            thinking: { type: this.opts.thinking ? "enabled" : "disabled" }
          })
        });
        const statusErr = this.classifyStatus(res);
        if (statusErr) throw statusErr;
        if (!res.ok) {
          const body = (await res.text()).slice(0, 300);
          throw new LLMError("LLM_PROVIDER_ERROR", `GLM endpoint returned ${res.status}: ${body}`, res.status >= 500);
        }
        const data = await res.json() as GLMChatResponseBody;
        if (data.error) {
          throw new LLMError("LLM_PROVIDER_ERROR", `GLM error: ${data.error.message ?? data.error.code}`);
        }
        const msg = data.choices?.[0]?.message;
        const toolCalls = this.parseToolCalls(msg?.tool_calls, toolNames);
        return {
          text: msg?.content ?? "",
          toolCalls,
          finishReason: toolCalls.length
            ? "tool_call"
            : data.choices?.[0]?.finish_reason === "length" ? "max_tokens" : "stop",
          usage: { inputTokens: data.usage?.prompt_tokens, outputTokens: data.usage?.completion_tokens }
        };
      } catch (err) {
        throw classifyTransportError(err);
      }
    }, { timeoutMs: this.opts.timeoutMs ?? 30000, retries: this.opts.retries ?? 2, token });
  }

  /* ------------------------------- streaming -------------------------------- */

  async chatStream(req: ChatRequest, onEvent: (e: StreamEvent) => void, token?: CancellationToken): Promise<ChatResponse> {
    const headers = await this.headers();
    const tools = this.toTools(req.tools);
    const toolNames = new Set(req.tools?.map(t => t.name) ?? []);
    return withTimeoutRetry(async (signal) => {
      try {
        const res = await fetch(this.endpoint, {
          method: "POST",
          headers,
          signal,
          body: JSON.stringify({
            model: this.opts.model,
            messages: this.toMessages(req.messages),
            ...(tools ?? {}),
            stream: true,
            temperature: req.temperature,
            max_tokens: req.maxTokens,
            thinking: { type: this.opts.thinking ? "enabled" : "disabled" }
          })
        });
        const statusErr = this.classifyStatus(res);
        if (statusErr) throw statusErr;
        if (!res.ok || !res.body) {
          throw new LLMError("LLM_PROVIDER_ERROR", `GLM stream returned ${res.status}.`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let text = "";
        const toolCalls: ToolCallRequest[] = [];
        let buffer = "";
        for (;;) {
          if (token?.cancelled) {
            reader.cancel().catch(() => {});
            throw new LLMError("LLM_CANCELLED", "GLM stream cancelled.");
          }
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const s = line.trim();
            if (!s.startsWith("data:")) continue;
            const payload = s.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
            try {
              const j = JSON.parse(payload) as GLMStreamDelta;
              const delta = j.choices?.[0]?.delta;
              if (delta?.content) {
                text += delta.content;
                onEvent({ type: "text", text: delta.content });
              }
              if (delta?.tool_calls) {
                for (const c of this.parseToolCalls(delta.tool_calls, toolNames)) {
                  toolCalls.push(c);
                  onEvent({ type: "tool_call", toolCall: c });
                }
              }
            } catch { /* skip malformed SSE chunk */ }
          }
        }
        const response: ChatResponse = {
          text,
          toolCalls,
          finishReason: toolCalls.length ? "tool_call" : "stop"
        };
        onEvent({ type: "done", finishReason: response.finishReason });
        return response;
      } catch (err) {
        throw classifyTransportError(err);
      }
    }, { timeoutMs: this.opts.timeoutMs ?? 60000, retries: this.opts.retries ?? 1, token });
  }

  /* ------------------------------- structured -------------------------------- */

  async structured(req: ChatRequest, schema: Record<string, unknown>): Promise<Record<string, unknown>> {
    const headers = await this.headers();
    return withTimeoutRetry(async (signal) => {
      try {
        const res = await fetch(this.endpoint, {
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
            temperature: req.temperature ?? 0.2,
            thinking: { type: "disabled" } // determinism for structured output
          })
        });
        const statusErr = this.classifyStatus(res);
        if (statusErr) throw statusErr;
        if (!res.ok) throw new LLMError("LLM_PROVIDER_ERROR", `GLM structured request returned ${res.status}.`);
        const data = await res.json() as GLMChatResponseBody;
        const raw = data.choices?.[0]?.message?.content?.trim() ?? "";
        try {
          return JSON.parse(raw) as Record<string, unknown>;
        } catch {
          // Some GLM models wrap JSON in fences despite response_format — recover.
          const m = raw.match(/\{[\s\S]*\}/);
          if (m) return JSON.parse(m[0]) as Record<string, unknown>;
          throw new LLMError("LLM_BAD_REQUEST", "GLM returned non-JSON for a structured request.");
        }
      } catch (err) {
        throw classifyTransportError(err);
      }
    }, { timeoutMs: this.opts.timeoutMs ?? 45000, retries: this.opts.retries ?? 2, token: undefined });
  }
}
