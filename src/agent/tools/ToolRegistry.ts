/**
 * ZARA V1.0 — Tool registry (Directive §15-16).
 *
 * Central, typed registry. The agent loop resolves model tool calls ONLY
 * through this registry. Each tool carries its risk level and confirmation
 * policy; HIGH-risk tools always require confirmation regardless of model
 * claims. Declarations for the model are generated from the registry —
 * there is exactly one source of truth.
 */
import { ToolDefinition, ToolResult, toolErr } from "./ToolTypes";

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) throw new Error(`Tool already registered: ${tool.name}`);
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined { return this.tools.get(name); }

  list(): readonly ToolDefinition[] { return [...this.tools.values()]; }

  /** §37 diagnostics: number of registered tools. */
  get size(): number { return this.tools.size; }

  /** Model-facing declarations (LLMProvider.ToolDeclaration shape). */
  declarations(): {
    name: string; description: string;
    parameters: ToolDefinition["parameters"];
  }[] {
    return this.list().map(t => ({
      name: t.name,
      description: t.description + (t.requiresConfirmation ? " (requires the user's confirmation first)" : ""),
      parameters: t.parameters
    }));
  }

  /**
   * Execute with validation + timeout. Confirmation is handled upstream by
   * the ConfirmationManager — this method assumes approval is settled.
   */
  async execute(name: string, args: Record<string, unknown>, ctx: Parameters<ToolDefinition["execute"]>[1]): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) return toolErr("TOOL_NOT_FOUND", `Unknown tool: ${name}`);
    const validationError = tool.validate(args);
    if (validationError) return toolErr("TOOL_INVALID_ARGS", `Invalid arguments for ${name}: ${validationError}`);

    // Permission gate
    if (tool.permission && !ctx.hasPermission(tool.permission)) {
      const granted = await ctx.requestPermission(tool.permission);
      if (!granted) {
        return toolErr("PERMISSION_DENIED", `${name} requires the ${tool.permission} permission, which was not granted.`);
      }
    }

    ctx.emitActionEvent("ACTION_STARTED", { tool: name, callId: (args as { __callId?: string }).__callId ?? "" });

    const started = ctx.now();
    let result: ToolResult;
    try {
      result = await Promise.race([
        tool.execute(args, ctx),
        new Promise<ToolResult>(resolve =>
          setTimeout(() => resolve(toolErr("TOOL_TIMEOUT", `${name} timed out after ${tool.timeoutMs}ms.`, true)), tool.timeoutMs)
        )
      ]);
    } catch (err) {
      result = toolErr("ACTION_FAILED", `${name} threw: ${err instanceof Error ? err.message : String(err)}`, true);
    }
    const elapsed = ctx.now() - started;

    ctx.emitActionEvent(result.ok ? "ACTION_COMPLETED" : "ACTION_FAILED", {
      tool: name, callId: (args as { __callId?: string }).__callId ?? "", verified: !!result.ok, elapsedMs: elapsed
    });
    return result;
  }
}
