/**
 * ZARA V1.0 — Tool contract types (Directive §15-17).
 *
 * Every tool declares: name, description, input schema, validation, permission
 * requirement, risk level, confirmation requirement, timeout, execution,
 * result schema, error schema, verification strategy, logging. No tool may
 * bypass this registry, and NO tool ever executes arbitrary shell commands.
 */

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

export interface ToolResult {
  ok: boolean;
  /** Human-readable outcome for the model + verification. */
  summary: string;
  /** Structured payload (verification inputs, diagnostics). */
  data?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
    /** Whether a retry could plausibly help. */
    retryable: boolean;
  };
}

export interface ToolContext {
  /** Event-emitting bridge for ACTION_* events. */
  emitActionEvent(name: "ACTION_STARTED" | "ACTION_COMPLETED" | "ACTION_FAILED", payload: Record<string, unknown>): void;
  /** Current permission state for permission-gated tools. */
  hasPermission(perm: string): boolean;
  /** Request runtime permission (returns user's decision). */
  requestPermission(perm: string): Promise<boolean>;
  /** Native bridge handle (ZaraActions plugin on device; web fallback). */
  native: NativeBridge;
  now(): number;
}

/**
 * The native bridge — implemented by the Capacitor plugin on Android and by
 * a web-fallback shim in the browser. Every method is a typed intent;
 * there is intentionally NO generic "exec" escape hatch.
 */
export interface NativeBridge {
  openApp(query: string): Promise<ToolResult>;
  openUrl(url: string): Promise<ToolResult>;
  webSearch(query: string): Promise<ToolResult>;
  youtubeSearch(query: string): Promise<ToolResult>;
  setBrightness(mode: "up" | "down" | "min" | "max"): Promise<ToolResult>;
  setVolume(mode: "up" | "down" | "mute" | "unmute"): Promise<ToolResult>;
  toggleFlashlight(on: boolean): Promise<ToolResult>;
  openSettings(panel: string): Promise<ToolResult>;
  batteryInfo(): Promise<ToolResult>;
  createReminder(epochMs: number, content: string): Promise<ToolResult>;
  createAlarm(hour: number, minute: number, label: string): Promise<ToolResult>;
  createCalendarEvent(title: string, startEpochMs: number, endEpochMs: number, location?: string): Promise<ToolResult>;
  playMedia(action: "play" | "pause" | "next" | "previous"): Promise<ToolResult>;
  callContact(query: string): Promise<ToolResult>;
  smsDraft(query: string, message: string): Promise<ToolResult>;
  launchCamera(): Promise<ToolResult>;
  launchGallery(): Promise<ToolResult>;
  openMaps(query: string): Promise<ToolResult>;
  getDeviceInfo(): Promise<ToolResult>;
}

export interface ToolDefinition<A = Record<string, unknown>> {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, {
      type: "string" | "number" | "integer" | "boolean";
      description?: string;
      enum?: string[];
    }>;
    required?: string[];
  };
  /** Android permission required at runtime (null = none). */
  permission: string | null;
  risk: RiskLevel;
  /** Whether the user must confirm before execution (HIGH risk always true). */
  requiresConfirmation: boolean;
  /** Execution timeout ms. */
  timeoutMs: number;
  /** Validate args before execution → error string or null. */
  validate(args: A): string | null;
  /** Execute. Must return a real outcome — never assume success (§19). */
  execute(args: A, ctx: ToolContext): Promise<ToolResult>;
  /**
   * Verification strategy (§19): how the caller decides the result is TRUE.
   * "result_ok"   → trust ToolResult.ok only when the native layer verified.
   * "inspected"   → summary must carry verifiable facts (ids, states).
   */
  verification: "result_ok" | "inspected";
}

export function toolOk(summary: string, data?: Record<string, unknown>): ToolResult {
  return { ok: true, summary, data };
}

export function toolErr(code: string, message: string, retryable = false): ToolResult {
  return { ok: false, summary: message, error: { code, message, retryable } };
}

export function toolResultFrom(result: unknown, expect: string): ToolResult {
  const r = result as { ok?: boolean; summary?: string; data?: Record<string, unknown>; error?: { code: string; message: string; retryable?: boolean } } | undefined;
  if (!r || typeof r.ok !== "boolean") {
    return toolErr("TOOL_UNAVAILABLE", `Native bridge returned an invalid result for ${expect}.`);
  }
  return {
    ok: r.ok,
    summary: r.summary ?? (r.ok ? "Done." : "Failed."),
    data: r.data,
    error: r.error ? { code: r.error.code, message: r.error.message, retryable: !!r.error.retryable } : undefined
  };
}
