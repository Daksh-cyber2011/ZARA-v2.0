/**
 * ZARA V1.0 — Agent orchestrator (Directive §13-14).
 *
 * The explicit agent loop:
 *   Input → Context → Reasoning → Intent/Decision → Planning → Tool selection
 *   → Safety → Confirmation if required → Execution → Verification
 *   → Memory update → Natural response
 *
 * Bounded to MAX_STEPS — never an infinite autonomous loop (§14). Every
 * tool round-trip carries VERIFIED outcomes back to the model (§19). If no
 * provider is configured, the turn fails honestly with LLM_NOT_CONFIGURED.
 */
import { LLMProvider, CancellationToken, LLMError, createCancellationToken } from "../../cognition/provider/types";
import { ChatMessage } from "../../cognition/provider/types";
import { ContextEngine, ContextSnapshot, RankedMemoryText } from "../../cognition/context/ContextEngine";
import { ToolRegistry } from "../tools/ToolRegistry";
import { ConfirmationManager } from "../confirmation/ConfirmationManager";
import { ApprovalPolicy } from "../confirmation/ApprovalPolicy";
import { verifyResult, outcomePhrase } from "../verification/Verification";
import { EventBus } from "../../core/events/EventBus";
import { Diagnostics } from "../../core/logging/Diagnostics";
import { StateMachine } from "../../core/state/StateMachine";
import { ToolContext } from "../tools/ToolTypes";
import { DialogueTurn, MemoryConsolidator } from "../../memory/consolidation/Consolidator";

const MAX_STEPS = 6;

export interface AgentTurnInput {
  userText: string;
  history: ChatMessage[];       // prior conversation (already trimmed)
  memories: RankedMemoryText[];
  snapshot: ContextSnapshot;
  activeTask: string | null;
  systemPromptBase: string;
  /** §33: what ZARA was saying when last interrupted (fresh turns only). */
  interruptedContext?: { reason: string; partialText?: string; turnsAgo: number } | null;
}

export interface AgentTurnResult {
  reply: string;
  emotion: string;              // avatar emotion hint
  toolSummaries: { tool: string; outcome: string; status: string }[];
  interrupted: boolean;
  error: string | null;         // typed error code if the turn failed
}

export interface AgentDeps {
  provider: () => LLMProvider;
  tools: ToolRegistry;
  confirmations: ConfirmationManager;
  /** V2.1 §8-9: short-lived approval memory (opt-in) so identical actions
   * don't re-confirm within the window. Android permissions are untouched. */
  approvals?: ApprovalPolicy;
  context: ContextEngine;
  bus: EventBus;
  diag: Diagnostics;
  sm: StateMachine;
  toolCtx: ToolContext;
  consolidator: () => MemoryConsolidator | null;
  dialogueLog: DialogueTurn[];
}

export class AgentOrchestrator {
  constructor(private deps: AgentDeps) {}

  /**
   * Run one full conversational turn. Cancellation is honored at every await
   * point; on interruption the turn ends INTERRUPTED (never a partial reply).
   */
  async runTurn(input: AgentTurnInput, token?: CancellationToken): Promise<AgentTurnResult> {
    const { provider, tools, confirmations, approvals, context, bus, diag, sm, toolCtx } = this.deps;
    const t = token ?? createCancellationToken();
    const toolSummaries: AgentTurnResult["toolSummaries"] = [];
    let emotion = "neutral";

    const llm = provider();
    if (!(await llm.isConfigured())) {
      diag.log("provider", "TURN_REFUSED", { reason: "LLM_NOT_CONFIGURED" });
      return {
        reply: "", emotion: "error", toolSummaries, interrupted: false,
        error: "LLM_NOT_CONFIGURED"
      };
    }

    await sm.requestTransition("THINKING", "turn-start");

    // ---- Context assembly (budgeted) ----
    const assembled = context.build({
      baseSystemPrompt: input.systemPromptBase,
      memories: input.memories,
      snapshot: input.snapshot,
      activeTask: input.activeTask,
      interruptedContext: input.interruptedContext ?? null
    });

    const messages: ChatMessage[] = [
      { role: "system", text: assembled.systemPrompt },
      ...input.history,
      { role: "user", text: input.userText }
    ];
    this.deps.dialogueLog.push({ role: "user", text: input.userText });

    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        if (t.cancelled) throw new LLMError("LLM_CANCELLED", "Turn cancelled by user.");

        const res = await llm.chat({
          messages,
          tools: tools.declarations() as never,
          temperature: 0.7,
          maxTokens: 700
        }, t);

        // ---- Pure reply → done ----
        if (!res.toolCalls.length) {
          this.deps.dialogueLog.push({ role: "zara", text: res.text });
          return {
            reply: res.text, emotion, toolSummaries,
            interrupted: false, error: null
          };
        }

        // ---- Planning phase (§16, §20): model proposed actions — select tools ----
        await sm.requestTransition("PLANNING", `plan:${res.toolCalls.map(c => c.name).join("+")}`);

        // ---- Tool phase ----
        const functionResponses: { id: string; name: string; output: Record<string, unknown> }[] = [];

        for (const call of res.toolCalls) {
          if (t.cancelled) throw new LLMError("LLM_CANCELLED", "Turn cancelled during tools.");

          const tool = tools.get(call.name);
          if (!tool) {
            functionResponses.push({
              id: call.id,
              name: call.name,
              output: { ok: false, error: `Unknown tool "${call.name}".` }
            });
            continue;
          }

          // ---- Safety / confirmation gate (§17-18) ----
          // V2.1 §8-9: an identical action approved moments ago (opt-in)
          // skips the repeat question. LOW-risk tools never ask at all.
          const needsConfirm = (tool.risk === "HIGH" || tool.requiresConfirmation)
            && !(approvals?.isRecentlyApproved(call.name, call.args) ?? false);
          if (needsConfirm) {
            await sm.requestTransition("WAITING", `confirm:${call.name}`);
            const question = buildConfirmationQuestion(call.name, call.args);
            const approved = await confirmations.request(call.id, call.name, question);
            if (!approved) {
              functionResponses.push({ id: call.id, name: call.name, output: { ok: false, cancelled: true, error: "The user declined this action." } });
              toolSummaries.push({ tool: call.name, outcome: "declined by user", status: "declined" });
              await sm.requestTransition("THINKING", "confirm-declined");
              continue;
            }
            approvals?.recordApproval(call.name, call.args);
            await sm.requestTransition("EXECUTING", `approved:${call.name}`);
          } else {
            await sm.requestTransition("EXECUTING", `tool:${call.name}`);
          }

          // ---- Execution ----
          const result = await tools.execute(call.name, { ...call.args, __callId: call.id } as Record<string, unknown>, toolCtx);

          // ---- Verification phase (§19, §20): verify outcome before reporting ----
          await sm.requestTransition("VERIFYING", `verify:${call.name}`);
          const verification = verifyResult(tool, result);
          toolSummaries.push({ tool: call.name, outcome: outcomePhrase(call.name, verification, result), status: verification.status });

          functionResponses.push({
            id: call.id,
            name: call.name,
            output: {
              ok: result.ok,
              verified: verification.status === "verified",
              summary: outcomePhrase(call.name, verification, result),
              ...(result.data ?? {})
            }
          });

          diag.log("agent", "TOOL_ROUND", {
            tool: call.name, ok: result.ok, verification: verification.status
          });
          await sm.requestTransition("THINKING", "tool-round-done");
        }

        // Feed verified outcomes back for the next reasoning step.
        // Structured replay (functionCall + functionResponse) so providers can
        // map to native tool protocols — text-only replay makes models loop.
        messages.push({
          role: "model",
          text: res.text,
          toolCalls: res.toolCalls
        });
        for (const fr of functionResponses) {
          messages.push({
            role: "tool",
            text: JSON.stringify(fr.output).slice(0, 1500),
            toolName: fr.name,
            toolCallId: fr.id,
            toolResponse: fr.output
          });
        }
      }

      // Step budget exhausted — respond with what we have, honestly.
      diag.log("agent", "MAX_STEPS_REACHED", {});
      this.deps.dialogueLog.push({ role: "zara", text: "I stopped after several steps to avoid running in a loop. Here's where things stand." });
      return {
        reply: "I stopped after several steps to avoid running in a loop. Here's where things stand.",
        emotion: "confused", toolSummaries, interrupted: false, error: null
      };
    } catch (err) {
      if (err instanceof LLMError && err.code === "LLM_CANCELLED") {
        return { reply: "", emotion, toolSummaries, interrupted: true, error: null };
      }
      const llmErr = err instanceof LLMError ? err : null;
      const code = llmErr?.code ?? "AGENT_ERROR";
      diag.log("agent", "TURN_FAILED", { code, message: String(err instanceof Error ? err.message : err) });
      bus.emit("ERROR", { code, message: err instanceof Error ? err.message : String(err) });
      await sm.requestTransition("ERROR", code);
      return { reply: "", emotion: "error", toolSummaries, interrupted: false, error: code };
    }
  }

  /** Kick background consolidation after a completed turn (§22). */
  scheduleConsolidation(): void {
    const c = this.deps.consolidator();
    if (!c || c.isBusy) return;
    const slice = [...this.deps.dialogueLog];
    if (slice.length < 2) return;
    this.deps.dialogueLog.length = 0; // consume the slice
    // fire-and-forget: consolidation never blocks the conversation
    c.processSlice(slice).catch(() => {});
  }
}

function buildConfirmationQuestion(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case "prepare_message":
      return `Send this to ${args.contact}: "${args.message}"?`;
    case "call_contact":
      return `Call ${args.contact}?`;
    default:
      return `Go ahead with ${toolName.replace(/_/g, " ")}?`;
  }
}
