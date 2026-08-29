/**
 * ZARA V1.0 — LLM Provider abstraction (Directive §36).
 *
 * ZARA is never hardwired to one provider. Adapters implement this surface:
 *   chat · structured output · tool calling · streaming · cancellation ·
 *   timeout · retry · error classification.
 *
 * NO FABRICATION (§58): if no provider is configured, calls fail with
 * LLM_NOT_CONFIGURED. There is no fake response path anywhere.
 */

export class LLMError extends Error {
  constructor(
    public readonly code:
      | "LLM_NOT_CONFIGURED"
      | "LLM_TIMEOUT"
      | "NETWORK_ERROR"
      | "LLM_AUTH_ERROR"
      | "LLM_RATE_LIMIT"
      | "LLM_BAD_REQUEST"
      | "LLM_CANCELLED"
      | "LLM_PROVIDER_ERROR",
    message: string,
    public readonly retryable = false
  ) {
    super(message);
    this.name = "LLMError";
  }
}

export interface ChatMessage {
  role: "system" | "user" | "model" | "tool";
  text: string;
  /** role "model": structured tool calls the model issued (replayed as
   * functionCall parts / assistant tool_calls in the next request). */
  toolCalls?: ToolCallRequest[];
  /** role "tool": which tool this response belongs to. */
  toolName?: string;
  /** role "tool": id of the originating model tool call (OpenAI protocol). */
  toolCallId?: string;
  /** role "tool": structured response payload (functionResponse part). */
  toolResponse?: Record<string, unknown>;
}

export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, {
      type: "string" | "number" | "integer" | "boolean";
      description?: string;
      enum?: string[];
      nullable?: boolean;
    }>;
    required?: string[];
  };
}

export interface ToolCallRequest {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResponsePayload {
  id: string;
  name: string;
  output: Record<string, unknown>;
}

export interface ChatRequest {
  messages: ChatMessage[];
  tools?: ToolDeclaration[];
  /** Max output tokens (provider-advised). */
  maxTokens?: number;
  temperature?: number;
}

export interface ChatResponse {
  text: string;
  toolCalls: ToolCallRequest[];
  finishReason: "stop" | "tool_call" | "max_tokens" | "other";
  /** Provider usage stats when available (diagnostics only). */
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface StreamEvent {
  type: "text" | "tool_call" | "done";
  text?: string;
  toolCall?: ToolCallRequest;
  finishReason?: ChatResponse["finishReason"];
}

export interface CancellationToken {
  cancelled: boolean;
  cancel(): void;
  /** Register cleanup for in-flight transport. */
  onCancel(fn: () => void): void;
}

export function createCancellationToken(): CancellationToken {
  const cleanups: (() => void)[] = [];
  const token: CancellationToken = {
    cancelled: false,
    cancel() {
      if (token.cancelled) return;
      token.cancelled = true;
      for (const fn of [...cleanups]) {
        try { fn(); } catch { /* cleanup must not throw */ }
      }
    },
    onCancel(fn) { cleanups.push(fn); }
  };
  return token;
}

export interface LLMProvider {
  readonly id: string;
  readonly label: string;
  /** Whether this provider is configured (has credentials). */
  isConfigured(): Promise<boolean>;
  /** Validate credentials without leaking them. Throws LLMError on failure. */
  validateCredentials(): Promise<void>;
  /** Single-shot chat with optional tools. */
  chat(req: ChatRequest, token?: CancellationToken): Promise<ChatResponse>;
  /** Streaming chat. onEvent receives deltas; returns final assembled response. */
  chatStream(req: ChatRequest, onEvent: (e: StreamEvent) => void, token?: CancellationToken): Promise<ChatResponse>;
  /** Structured (JSON-schema-constrained) output. */
  structured(req: ChatRequest, schema: Record<string, unknown>): Promise<Record<string, unknown>>;
}

/* ------------------------- shared retry/timeout core ---------------------- */

export async function withTimeoutRetry<T>(
  op: (signal: AbortSignal) => Promise<T>,
  opts: { timeoutMs: number; retries: number; token?: CancellationToken }
): Promise<T> {
  const { timeoutMs, retries, token } = opts;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (token?.cancelled) throw new LLMError("LLM_CANCELLED", "Request cancelled before start.");
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    const onTokenCancel = () => ac.abort();
    token?.onCancel(onTokenCancel);
    try {
      const result = await op(ac.signal);
      clearTimeout(timer);
      return result;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (token?.cancelled) throw new LLMError("LLM_CANCELLED", "Request cancelled.");
      // A signal abort WITHOUT user cancellation is a timeout → classify (§47).
      if (err instanceof Error && err.name === "AbortError") {
        throw new LLMError("LLM_TIMEOUT", `Request timed out after ${timeoutMs}ms.`, true);
      }
      if (err instanceof LLMError && !err.retryable) throw err;
      // Exponential backoff, capped — jitter avoids thundering herd.
      const backoff = Math.min(800 * 2 ** attempt, 5000) * (0.7 + Math.random() * 0.6);
      await new Promise(r => setTimeout(r, backoff));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new LLMError("LLM_PROVIDER_ERROR", String(lastErr));
}

/** Map a fetch/transport error into the typed taxonomy. */
export function classifyTransportError(err: unknown, abortMsgHint = "timeout"): LLMError {
  if (err instanceof LLMError) return err;
  const msg = err instanceof Error ? err.message : String(err);
  const e = err as { name?: string; status?: number; cause?: { status?: number } };
  const status = e?.status ?? e?.cause?.status;
  if (e?.name === "AbortError") return new LLMError("LLM_TIMEOUT", `Request ${abortMsgHint}.`);
  if (status === 401 || status === 403 || /api[_ ]?key|unauthenticated|permission/i.test(msg))
    return new LLMError("LLM_AUTH_ERROR", msg);
  if (status === 429 || /rate.?limit|quota|resource.?exhausted/i.test(msg))
    return new LLMError("LLM_RATE_LIMIT", msg, true);
  if (status === 400 || /invalid.?request/i.test(msg))
    return new LLMError("LLM_BAD_REQUEST", msg);
  if (/network|fetch|failed to fetch|ENOTFOUND|ECONNREFUSED|offline/i.test(msg))
    return new LLMError("NETWORK_ERROR", msg, true);
  return new LLMError("LLM_PROVIDER_ERROR", msg, status !== undefined && status >= 500);
}
