/**
 * ZARA V1.0 — Interruption / barge-in controller (Directive §10, §19, §33).
 *
 * One place that owns the interruption taxonomy:
 *   - speech cancellation     (always immediate)
 *   - reasoning cancellation  (LLM request token)
 *   - tool cancellation       (non-destructive tools; irreversible actions
 *                              are NOT pretended undone — §10 last rule)
 *
 * §19 metadata: every interruption records the current turn id, the speech
 * generation id, the timestamp and the reason, so ZARA can later reference
 * the interruption naturally ("Earlier you redirected me when…").
 *
 * §33 continuity: the interrupted speech text is preserved so the next turn's
 * context can mention what ZARA was saying — she answers from context instead
 * of restarting the topic.
 */
import { SpeechQueue } from "../SpeechQueue";
import { EventBus } from "../../core/events/EventBus";
import { Diagnostics } from "../../core/logging/Diagnostics";
import { StateMachine } from "../../core/state/StateMachine";
import { CancellationToken, createCancellationToken } from "../../cognition/provider/types";

export interface InterruptionRecord {
  turnId: string;              // §19 currentTurnId at interrupt time
  speechGenerationId: string;  // §19 speechGenerationId (utterance id)
  at: number;                  // §19 interruption timestamp
  reason: string;              // §19 interruption reason
  phase: "speech" | "reasoning" | "tool";
  interruptedText?: string;    // §33 partial text ZARA was saying
}

export class InterruptionController {
  private reasoningToken: CancellationToken | null = null;
  private _lastInterruption: InterruptionRecord | null = null;
  private _currentTurnId = "t_0";

  constructor(
    private speech: SpeechQueue,
    private bus: EventBus,
    private diag: Diagnostics,
    private sm: StateMachine
  ) {}

  /** §19: the id of the conversation turn currently in flight. */
  get currentTurnId(): string { return this._currentTurnId; }
  get lastInterruption(): InterruptionRecord | null { return this._lastInterruption; }

  /** Called by the runtime at the start of each user turn. */
  beginTurn(): string {
    this._currentTurnId = "t_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6);
    return this._currentTurnId;
  }

  /** Register the in-flight LLM request token so barge-in can cancel it. */
  trackReasoning(token: CancellationToken): void { this.reasoningToken = token; }
  clearReasoning(): void { this.reasoningToken = null; }

  /**
   * Full barge-in: stop speech, cancel reasoning, mark INTERRUPTED.
   * `phase` distinguishes what was actually happening (diagnostics only).
   */
  interrupt(reason: string): void {
    const wasSpeaking = this.speech.isSpeaking;
    const wasThinking = this.sm.isIn("THINKING", "EXECUTING", "PLANNING", "VERIFYING");
    const phase: "speech" | "reasoning" | "tool" =
      wasSpeaking ? "speech" : this.sm.state === "EXECUTING" ? "tool" : "reasoning";

    const utterance = this.speech.currentUtterance;
    const interruptedText = wasSpeaking && utterance ? utterance.text : undefined;

    if (wasSpeaking) this.speech.cancelAll(reason);
    if (this.reasoningToken && !this.reasoningToken.cancelled) this.reasoningToken.cancel();

    this.sm.transition("INTERRUPTED", `barge-in: ${reason}`);

    this._lastInterruption = {
      turnId: this._currentTurnId,
      speechGenerationId: utterance?.id ?? "",
      at: Date.now(),
      reason,
      phase,
      interruptedText
    };
    this.bus.emit("ZARA_INTERRUPTED", {
      utteranceId: utterance?.id ?? "",
      phase,
      turnId: this._lastInterruption.turnId,
      at: this._lastInterruption.at,
      reason,
      interruptedText
    });
    this.diag.log("voice", "INTERRUPTED", {
      reason, phase, wasSpeaking, wasThinking,
      turnId: this._lastInterruption.turnId,
      partialChars: interruptedText?.length ?? 0
    });
    this.reasoningToken = null;
  }

  newToken(): CancellationToken {
    const t = createCancellationToken();
    this.trackReasoning(t);
    return t;
  }
}
