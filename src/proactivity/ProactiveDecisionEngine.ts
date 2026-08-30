/**
 * ZARA V1.0 — Proactive Decision Engine (Directive §4-6, §8-9, §39-40).
 *
 * THE defining feature. Every candidate observation is scored across nine
 * dimensions; the engine decides SPEAK_NOW / WAIT / SAVE_FOR_LATER / SILENCE / IGNORE.
 * SILENCE (§8: valid, common, deliberate — quiet/sleep/threshold/model veto)
 * is distinct from IGNORE (candidate discarded as irrelevant/duplicate/off).
 * Silence must be the norm, not the exception. Quiet/sleep states are hard gates.
 */
import { ProactiveCandidate, ProactiveDecision, ScoredCandidate, SOURCE_CATEGORY } from "./types";
import { AntiSpamPolicy } from "./policy/AntiSpam";
import { ProactiveRefiner, RefinerInput } from "./Refiner";
import { EventBus } from "../core/events/EventBus";
import { Diagnostics } from "../core/logging/Diagnostics";
import { StateMachine } from "../core/state/StateMachine";
import { ZaraSettings } from "../core/configuration/Settings";

/** Weights for the composite score. Interruption cost SUBTRACTS. */
const W = {
  relevance: 0.24,
  importance: 0.26,
  novelty: 0.10,
  confidence: 0.12,
  timeliness: 0.16,
  personalContext: 0.12
} as const;

export interface EngineContext {
  state: string;                  // current ZARA state
  quietMode: boolean;
  sleepMode: boolean;
  foreground: boolean;
  userPresent: boolean;           // interaction within last N minutes
}

export class ProactiveDecisionEngine {
  private savedForLater: ScoredCandidate[] = [];

  constructor(
    private bus: EventBus,
    private diag: Diagnostics,
    private sm: StateMachine,
    private antiSpam: AntiSpamPolicy,
    private settings: () => ZaraSettings,
    private refiner: ProactiveRefiner | null = null
  ) {}

  /** Attach the §39 stage-2 model refiner (GLM 5.2 via provider abstraction). */
  attachRefiner(refiner: ProactiveRefiner): void { this.refiner = refiner; }

  /**
   * Phase 2 — §39 three-stage path:
   *   stage 1: deterministic evaluate() (hard gates + score)
   *   stage 2: model reasoning IF the candidate is worth considering
   *            (SPEAK_NOW / SAVE_FOR_LATER band, non-reminder sources,
   *            refiner attached + budget available)
   *   stage 3: policy re-gate on the (possibly refined) draft
   *
   * The model can VETO (speak=false → IGNORE) or RESHAPE the line; it can
   * never bypass the deterministic policy gates afterwards.
   */
  async evaluateWithModel(
    c: ProactiveCandidate,
    ctx: EngineContext,
    refinerInput: Omit<RefinerInput, "draft" | "source"> = { memoryLines: [], contextLine: "" },
    now = Date.now()
  ): Promise<ScoredCandidate> {
    // Stage 1 PROBE: gates + score WITHOUT committing anti-spam — the model
    // may still veto, and only real speech should count (§39 no phantom
    // utterances, §40 silence-is-success accounting stays honest).
    const stage1 = this.evaluateInternal(c, ctx, now, false);

    const considerBand = stage1.decision === "SPEAK_NOW" || stage1.decision === "SAVE_FOR_LATER";
    if (!this.refiner || !considerBand || c.source === "reminder") {
      this.commitIfSpeak(stage1, now);
      return stage1; // pure deterministic path (§39: LLM is optional, bounded)
    }

    let verdict;
    try {
      verdict = await this.refiner.refine({ ...refinerInput, draft: c.draft, source: c.source });
    } catch {
      verdict = null;
    }
    if (!verdict) {
      this.commitIfSpeak(stage1, now); // refiner unavailable/failed → template stands
      return stage1;
    }

    if (!verdict.speak) {
      // Model veto → deliberate SILENCE (§8): logged, explainable, final.
      // No commit: nothing is spoken.
      return this.finish(c, "SILENCE", stage1.score, `model veto: ${verdict.reason || "not worth saying"}`);
    }

    // Reshape: model line replaces the template; dedupe + policy re-gate.
    // Stage 3 COMMITS anti-spam on its SPEAK_NOW (the real decision point).
    const refined: ProactiveCandidate = {
      ...c,
      draft: verdict.line.slice(0, 140),
      // Model confirmed relevance → modest confidence boost, still policy-gated.
      confidence: Math.min(1, c.confidence + 0.1)
    };
    if (this.antiSpam.isDuplicate(refined.draft, now)) {
      return this.finish(refined, "IGNORE", stage1.score, "refined line duplicates a recent proactive line");
    }
    const stage3 = this.evaluateInternal(refined, ctx, now, true);
    return this.finish(stage3.candidate, stage3.decision, stage3.score,
      `${stage3.reason} (refined: ${verdict.line.slice(0, 60)})`);
  }

  /**
   * Evaluate one candidate → decision. The engine is deliberately
   * deterministic and inspectable: every decision is logged with its score.
   */
  evaluate(c: ProactiveCandidate, ctx: EngineContext, now = Date.now()): ScoredCandidate {
    return this.evaluateInternal(c, ctx, now, true);
  }

  private evaluateInternal(c: ProactiveCandidate, ctx: EngineContext, now: number, commit: boolean): ScoredCandidate {
    // ---- Hard gates (§7, §8, §9): quiet/sleep/busy states ----
    // §8: quiet/sleep produce an explicit SILENCE outcome — a deliberate,
    // observable choice to stay silent (§40 "why did ZARA remain silent?").
    if (ctx.quietMode) {
      return this.finish(c, "SILENCE", 0, "quiet mode active (user asked for silence)");
    }
    if (ctx.sleepMode) {
      return this.finish(c, "SILENCE", 0, "sleep mode active");
    }
    if (!this.settings().proactivityEnabled) {
      return this.finish(c, "IGNORE", 0, "proactivity disabled in settings");
    }
    // Only reminders may interrupt an ACTIVE turn (time-critical).
    const activeTurn = ["LISTENING", "THINKING", "PLANNING", "SPEAKING", "WAITING", "INTERRUPTED", "EXECUTING", "VERIFYING"].includes(ctx.state);
    if (activeTurn && c.source !== "reminder") {
      return this.finish(c, "WAIT", 0, `ZARA busy (${ctx.state}) — candidate held`);
    }
    if (!ctx.foreground && c.source !== "reminder") {
      return this.finish(c, "WAIT", 0, "app not in foreground");
    }

    // ---- Anti-spam vetoes (§39) ----
    const veto = this.antiSpam.veto(now);
    if (veto && c.source !== "reminder") {
      return this.finish(c, "WAIT", 0, `anti-spam veto: ${veto}`);
    }
    if (this.antiSpam.isDuplicate(c.draft, now)) {
      return this.finish(c, "IGNORE", 0, "duplicate of a recent proactive line");
    }

    // ---- Composite score ----
    const raw =
      W.relevance * c.relevance +
      W.importance * c.importance +
      W.novelty * c.novelty +
      W.confidence * c.confidence +
      W.timeliness * c.timeliness +
      W.personalContext * c.personalContext;

    // Interruption/annoyance cost subtracts; presence boosts slightly.
    let score = raw - 0.22 * c.annoyanceCost;
    if (ctx.userPresent) score += 0.04;
    if (c.source === "reminder") score += 0.18; // reminders are user-requested, time-critical
    score = Math.max(0, Math.min(1, score));

    // ---- Thresholds (§39: context-sensitive) ----
    const threshold = Math.max(
      this.settings().proactivityThreshold,
      this.antiSpam.config.minScore
    );

    let decision: ProactiveDecision;
    let reason: string;
    if (score >= threshold) {
      decision = "SPEAK_NOW";
      reason = `score ${score.toFixed(2)} ≥ threshold ${threshold.toFixed(2)}`;
      // The DECISION is the commitment: count it immediately so a second
      // candidate in the same batch cannot also speak (§39 — no stacked
      // nudges). Reminders stay exempt (time-critical).
      if (commit && c.source !== "reminder") this.antiSpam.noteProactiveUtterance(c.draft, now);
    } else if (score >= threshold - 0.18 && (c.timeliness >= 0.5 || c.importance >= 0.7)) {
      decision = "SAVE_FOR_LATER";
      reason = `score ${score.toFixed(2)} below threshold but ${c.timeliness >= 0.5 ? "time-sensitive" : "important"} — saved`;
    } else {
      decision = "SILENCE";
      reason = `score ${score.toFixed(2)} below threshold ${threshold.toFixed(2)} — silence`;
    }

    return this.finish(c, decision, score, reason);
  }

  private commitIfSpeak(scored: ScoredCandidate, now: number): void {
    if (scored.decision === "SPEAK_NOW" && scored.candidate.source !== "reminder") {
      this.antiSpam.noteProactiveUtterance(scored.candidate.draft, now);
    }
  }

  /**
   * Batch-evaluate candidates; returns at most one SPEAK_NOW (the best).
   * Everything else waits or is saved. This guarantees ZARA never stacks
   * multiple proactive lines at once.
   */
  evaluateBatch(candidates: ProactiveCandidate[], ctx: EngineContext, now = Date.now()): {
    speak: ScoredCandidate | null;
    others: ScoredCandidate[];
  } {
    const scored = candidates.map(c => this.evaluate(c, ctx, now));
    const speaking = scored.filter(s => s.decision === "SPEAK_NOW").sort((a, b) => b.score - a.score);
    const others = scored.filter(s => s.decision !== "SPEAK_NOW");

    for (const s of others) {
      if (s.decision === "SAVE_FOR_LATER") this.savedForLater.push(s);
    }
    // Cap the save buffer; drop oldest.
    if (this.savedForLater.length > 12) this.savedForLater.splice(0, this.savedForLater.length - 12);

    // Because a SPEAK_NOW decision already registers with anti-spam, at most
    // one candidate can reach SPEAK_NOW per batch. Any stragglers (e.g.
    // reminders exempt from cooldown) are held for later instead of stacked.
    const speak = speaking[0] ?? null;
    for (const s of speaking.slice(1)) this.savedForLater.push(s);

    return { speak, others };
  }

  /** Retrieve saved candidates (drained when conditions improve). */
  drainSaved(ctx: EngineContext, now = Date.now()): ScoredCandidate[] {
    if (ctx.quietMode || ctx.sleepMode) return [];
    const stillVetoed = this.antiSpam.veto(now);
    if (stillVetoed) return [];
    const out = this.savedForLater.filter(s => s.score >= 0.3);
    this.savedForLater = [];
    return out;
  }

  get savedCount(): number { return this.savedForLater.length; }

  private finish(c: ProactiveCandidate, decision: ProactiveDecision, score: number, reason: string): ScoredCandidate {
    const sc: ScoredCandidate = { candidate: c, score, decision, reason };
    // §6 explainability: structured decision metadata WITHOUT private CoT.
    this.diag.log("proactivity", "EVALUATED", {
      id: c.id, source: c.source, category: c.category ?? SOURCE_CATEGORY[c.source],
      decision, score: +score.toFixed(2), reason,
      dims: {
        relevance: +c.relevance.toFixed(2),
        importance: +c.importance.toFixed(2),
        novelty: +c.novelty.toFixed(2),
        confidence: +c.confidence.toFixed(2),
        interruptionCost: +c.annoyanceCost.toFixed(2)
      }
    });
    return sc;
  }
}
