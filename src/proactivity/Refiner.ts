/**
 * ZARA V1.0 Phase 2 — Proactive refiner (Directive §39, stage 2).
 *
 * §39 architecture:
 *   EVENT → deterministic candidate generation → relevance gate   (stage 1, engine)
 *         → MODEL REASONING if justified                           (stage 2, HERE)
 *         → policy gate → SPEAK / ACT / IGNORE                     (stage 3, engine)
 *
 * The LLM is NEVER the scheduler. It is consulted only when the deterministic
 * stage 1 already judged a candidate worth considering, and its job is narrow:
 * given context + memory, (a) veto a weak candidate, or (b) shape ONE short
 * natural line. The policy gate re-checks everything afterwards.
 *
 * Bounds (§38 performance):
 *   - at most 1 LLM call per candidate, 8 s timeout, no retries
 *   - hourly call budget (default 6) — proactivity must stay cheap
 *   - topic dedupe: the same topic-key is not refined twice in 30 min
 *   - ANY failure → null → caller falls back to the deterministic template
 */
import { LLMProvider } from "../cognition/provider/types";
import { Diagnostics } from "../core/logging/Diagnostics";

export interface RefinerInput {
  /** Deterministic template draft from stage 1. */
  draft: string;
  source: string;
  /** Relevant memory lines (already ranked by the retriever). */
  memoryLines: string[];
  /** One-line perception/context summary. */
  contextLine: string;
}

export interface RefinerVerdict {
  speak: boolean;
  line: string;
  reason: string;
}

const REFINE_SCHEMA = {
  type: "object",
  properties: {
    speak: { type: "boolean", description: "true only if saying something now is genuinely useful to the user" },
    line: { type: "string", description: "ONE short natural sentence (max ~15 words) in the user's language style, or empty if speak=false" },
    reason: { type: "string", description: "brief reason for the decision" }
  },
  required: ["speak", "reason"]
};

export class ProactiveRefiner {
  private callTimes: number[] = [];
  private recentTopics = new Map<string, number>();
  private inflight = false;

  constructor(
    private provider: () => LLMProvider,
    private diag: Diagnostics,
    private opts: { hourlyBudget?: number; timeoutMs?: number; topicDedupeMs?: number } = {}
  ) {}

  get budgetRemaining(): number {
    const now = Date.now();
    this.callTimes = this.callTimes.filter(t => now - t < 3600_000);
    return (this.opts.hourlyBudget ?? 6) - this.callTimes.length;
  }

  /** Cheap topic key for dedupe (normalized first content words). */
  static topicKey(input: RefinerInput): string {
    return input.draft.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/)
      .filter(w => w.length > 3).slice(0, 4).join("_") || input.source;
  }

  /**
   * Stage 2. Returns null when refinement is not justified / unavailable /
   * failed — the caller then uses the stage-1 template draft unchanged.
   * NEVER throws.
   */
  async refine(input: RefinerInput): Promise<RefinerVerdict | null> {
    if (this.inflight) return null; // one at a time (§38: no bursts)
    const key = ProactiveRefiner.topicKey(input);
    const now = Date.now();

    const lastSeen = this.recentTopics.get(key);
    if (lastSeen !== undefined && now - lastSeen < (this.opts.topicDedupeMs ?? 30 * 60_000)) {
      return null; // same topic refined recently — not worth another call
    }
    if (this.budgetRemaining <= 0) {
      this.diag.log("proactivity", "REFINER_BUDGET_EXHAUSTED", {});
      return null;
    }

    let provider: LLMProvider;
    try {
      provider = this.provider();
    } catch {
      return null; // no active provider object (registry invariant)
    }
    try {
      if (!(await provider.isConfigured())) return null;
    } catch {
      return null;
    }

    this.inflight = true;
    this.callTimes.push(now);
    this.recentTopics.set(key, now);
    try {
      const system =
        "You are the proactive-speech judge for ZARA, a personal AI companion. " +
        "A deterministic engine decided a candidate MIGHT be worth saying. " +
        "Decide whether speaking now is genuinely useful, warm and NOT annoying. " +
        "When in doubt, set speak=false — silence is a success. " +
        "If speaking, produce ONE short natural line (max ~15 words), matching the user's language " +
        "(English / Hindi / Hinglish as the memory suggests). Never mention scores, engines or rules.";
      const user =
        `Context: ${input.contextLine}\n` +
        `Candidate (${input.source}): "${input.draft}"\n` +
        (input.memoryLines.length ? `Relevant memories:\n- ${input.memoryLines.slice(0, 5).join("\n- ")}` : "No relevant memories.");

      const out = await Promise.race([
        provider.structured(
          { messages: [{ role: "system", text: system }, { role: "user", text: user }], temperature: 0.3 },
          REFINE_SCHEMA
        ),
        new Promise<null>(r => setTimeout(() => r(null), this.opts.timeoutMs ?? 8000))
      ]) as Record<string, unknown> | null;

      if (!out || typeof out !== "object") {
        this.diag.log("proactivity", "REFINER_TIMEOUT_OR_EMPTY", { topic: key });
        return null;
      }
      const speak = out.speak === true;
      const line = typeof out.line === "string" ? out.line.trim() : "";
      const reason = typeof out.reason === "string" ? out.reason.slice(0, 200) : "";
      const verdict: RefinerVerdict = {
        speak: speak && line.length > 0,
        line: speak ? line : "",
        reason
      };
      this.diag.log("proactivity", "REFINED", {
        topic: key, speak: verdict.speak, line: verdict.line.slice(0, 80), reason
      });
      return verdict;
    } catch (err) {
      this.diag.log("proactivity", "REFINER_FAILED", { topic: key, error: String(err).slice(0, 120) });
      return null;
    } finally {
      this.inflight = false;
    }
  }
}
