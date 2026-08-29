/**
 * ZARA V1.1 — Proactive candidate generator (Directive §3 pipeline stage,
 * §11 taxonomy, §37 memory×perception fusion).
 *
 * Deterministic stage between the event normalizer and the decision engine:
 * a normalized, significant event becomes zero or more SCORED-INPUT
 * candidates (drafts + dimension estimates). The engine (§10) then decides
 * speak/wait/save/ignore — generation never speaks by itself, so silence
 * remains the default outcome.
 *
 * §37 FUSION: screen/app events are joined with retrieved memories. A screen
 * observation is only strong when it CONNECTS to something ZARA remembers
 * ("Back to VaaniX?"). Bare observations score low and usually stay silent —
 * exactly the desired "wait... she noticed that?" effect (§49).
 */
import {
  ProactiveCandidate, ProactiveSource, ProactiveCategory,
  SOURCE_CATEGORY, newCandidateId
} from "./types";
import { NormalizedEvent } from "../perception/EventNormalizer";
import { ScreenContext } from "../perception/ScreenContext";
import { MemoryRecord } from "../memory/types";

export interface CandidateContext {
  /** Memories retrieved against the event's own text (fusion input). */
  relatedMemories: { record: MemoryRecord; score: number }[];
  /** Whether the user was recently present/active. */
  userPresent: boolean;
}

/** Base candidate without id/createdAt — generator fills identity fields. */
type CandidateInput = Omit<ProactiveCandidate, "id" | "createdAt"> & {
  category?: ProactiveCategory;
  perceptionEventId?: string;
};

export class CandidateGenerator {
  /**
   * Generate 0..n candidates for one normalized event. Pure function of the
   * event + context — deterministic, testable, no model calls (§43).
   */
  generate(e: NormalizedEvent, ctx: CandidateContext): ProactiveCandidate[] {
    const out: CandidateInput[] = [];
    switch (e.kind) {
      case "SCREEN_CONTEXT_CHANGED":
        out.push(...this.fromScreenChange(e.payload as ScreenContext, ctx, e));
        break;
      case "USER_RETURNED":
        out.push(...this.fromUserReturn(e.payload as { awayMs: number }, ctx));
        break;
      case "BATTERY_CHANGED":
        out.push(...this.fromBattery(e.payload as { level: number; charging: boolean }));
        break;
      case "CONVERSATION_ENDED":
        out.push(...this.fromConversationEnd(ctx));
        break;
      case "TIME_MILESTONE":
        out.push(...this.fromTimeMilestone(e.payload as { label: string }));
        break;
      case "TASK_COMPLETED":
        out.push(...this.fromTaskCompleted(e.payload as { tool: string; verified: boolean }, ctx));
        break;
      case "ACTION_FAILED":
        out.push(...this.fromActionFailed(e.payload as { tool: string; error: string }));
        break;
      case "PROACTIVE_IGNORED":
        out.push(...this.fromProactiveIgnored(e.payload as { backoffMultiplier: number }));
        break;
      case "USER_INTERRUPTED_ZARA":
        out.push(...this.fromInterruption(ctx));
        break;
      default:
        // APP_CHANGED / USER_IDLE / NETWORK_CHANGED / mode events /
        // USER_SPOKE / REMINDER_DUE have dedicated paths elsewhere —
        // reminders go straight to the engine's exempt lane; speaking turns
        // are conversation, not proactivity.
        break;
    }
    return out.map(c => this.finalize(c));
  }

  private finalize(c: CandidateInput): ProactiveCandidate {
    const { perceptionEventId: _pid, ...rest } = c;
    void _pid;
    return {
      ...rest,
      category: rest.category ?? SOURCE_CATEGORY[rest.source as ProactiveSource],
      id: newCandidateId(),
      createdAt: Date.now()
    };
  }

  /* --------------------------- §37 fusion rules --------------------------- */

  private fromScreenChange(screen: ScreenContext, ctx: CandidateContext, e: NormalizedEvent): CandidateInput[] {
    if (screen.screenType === "home") return []; // home screen is not a topic

    // Fusion: find the best memory overlapping this screen context.
    const fused = this.bestFusion(screen, ctx.relatedMemories);
    if (fused) {
      const topic = shortTopic(fused.record.content);
      return [{
        source: "memory_relevance",
        category: "SCREEN_CONTEXT_CHANGED",
        draft: `Back to ${topic}?`,
        relevance: 0.88,
        importance: Math.min(1, fused.record.importance + 0.1),
        novelty: 0.7,
        confidence: 0.55 + 0.3 * screen.confidence,
        timeliness: 0.85,
        personalContext: 0.95,
        annoyanceCost: 0.4,
        memoryIds: [fused.record.id],
        perceptionEventId: e.id
      }];
    }

    // Bare observation (no memory anchor): deliberately weak — the policy
    // threshold usually keeps it silent; it exists so a *repeated* context
    // (written to temporary_context by §38) can later fuse with memory.
    if (screen.detectedEntities.length && (screen.screenType === "video" || screen.screenType === "article")) {
      const entity = screen.detectedEntities[0];
      return [{
        source: "app_context",
        category: "SOMETHING_ZARA_NOTICED",
        draft: `You're checking out ${entity} again?`,
        relevance: 0.55,
        importance: 0.35,
        novelty: 0.6,
        confidence: 0.5 * screen.confidence,
        timeliness: 0.8,
        personalContext: 0.5,
        annoyanceCost: 0.55,
        perceptionEventId: e.id
      }];
    }
    return [];
  }

  /** §37: strongest memory↔screen overlap by shared significant tokens. */
  private bestFusion(screen: ScreenContext, memories: { record: MemoryRecord; score: number }[]): { record: MemoryRecord; score: number } | null {
    if (!memories.length) return null;
    const screenTokens = new Set(tokenize(
      `${screen.app} ${screen.visibleText} ${screen.detectedEntities.join(" ")}`
    ));
    let best: { record: MemoryRecord; overlap: number; rank: number } | null = null;
    for (const m of memories) {
      const memTokens = tokenize(`${m.record.content} ${m.record.relatedEntities.join(" ")}`);
      let overlap = 0;
      for (const t of memTokens) if (screenTokens.has(t)) overlap++;
      if (!best || overlap > best.overlap || (overlap === best.overlap && m.score > best.rank)) {
        best = { record: m.record, overlap, rank: m.score };
      }
    }
    // Require at least one real token overlap — coincidence is not fusion.
    return best && best.overlap >= 1 ? { record: best.record, score: best.rank } : null;
  }

  /* ------------------------- non-screen sources --------------------------- */

  private fromUserReturn(p: { awayMs: number }, ctx: CandidateContext): CandidateInput[] {
    const awayMin = Math.round(p.awayMs / 60000);
    // §36: brief absences stay silent; longer ones may matter.
    if (awayMin < 3) return [];
    const lastProject = ctx.relatedMemories.find(m =>
      m.record.type === "project" || m.record.type === "task");
    if (lastProject && awayMin >= 10) {
      const topic = shortTopic(lastProject.record.content);
      return [{
        source: "user_returned",
        draft: `Welcome back. Picking up ${topic} again?`,
        relevance: 0.82,
        importance: 0.5,
        novelty: 0.75,
        confidence: 0.8,
        timeliness: 0.9,
        personalContext: 0.95,
        annoyanceCost: 0.3,
        memoryIds: [lastProject.record.id]
      }];
    }
    return [{
      source: "user_returned",
      draft: "Welcome back.",
      relevance: 0.75,
      importance: 0.4,
      novelty: 0.7,
      confidence: 0.85,
      timeliness: 0.9,
      personalContext: 0.9,
      annoyanceCost: 0.3
    }];
  }

  private fromBattery(p: { level: number; charging: boolean }): CandidateInput[] {
    if (p.charging || p.level >= 0.2) return [];
    return [{
      source: "battery",
      category: "DEVICE_CONTEXT",
      draft: "Battery's getting low — want me to keep it in mind, or plug in soon?",
      relevance: 0.72, importance: 0.6, novelty: 0.85, confidence: 0.9,
      timeliness: 0.85, personalContext: 0.7, annoyanceCost: 0.35
    }];
  }

  private fromConversationEnd(ctx: CandidateContext): CandidateInput[] {
    // §3 conversation_followup: only when an open project/task thread exists.
    const open = ctx.relatedMemories.find(m =>
      m.record.type === "task" || m.record.type === "project");
    if (!open || open.record.importance < 0.6) return [];
    return [{
      source: "conversation_followup",
      category: "CONVERSATION_FOLLOWUP",
      draft: `By the way — still planning to finish ${shortTopic(open.record.content)} today?`,
      relevance: 0.7, importance: open.record.importance, novelty: 0.5,
      confidence: 0.6, timeliness: 0.6, personalContext: 0.9, annoyanceCost: 0.5,
      memoryIds: [open.record.id]
    }];
  }

  private fromTimeMilestone(p: { label: string }): CandidateInput[] {
    return [{
      source: "time_of_day",
      category: "TIME_CONTEXT",
      draft: `It's ${p.label}.`,
      relevance: 0.4, importance: 0.3, novelty: 0.8, confidence: 1,
      timeliness: 0.9, personalContext: 0.3, annoyanceCost: 0.6
    }];
  }

  private fromTaskCompleted(p: { tool: string; verified: boolean }, ctx: CandidateContext): CandidateInput[] {
    if (!p.verified) return []; // failures have their own lane
    const recent = ctx.relatedMemories[0];
    return [{
      source: "post_action_followup",
      category: "POST_ACTION_FOLLOWUP",
      draft: p.tool === "create_reminder"
        ? "Reminder's set — I'll bring it up at the right time."
        : "That worked.",
      relevance: 0.65, importance: 0.4, novelty: 0.5, confidence: 0.9,
      timeliness: 0.85, personalContext: 0.6, annoyanceCost: 0.4,
      memoryIds: recent ? [recent.record.id] : undefined
    }];
  }

  private fromActionFailed(p: { tool: string; error: string }): CandidateInput[] {
    return [{
      source: "error_recovery",
      category: "ERROR_RECOVERY",
      draft: `That didn't go through (${p.tool}). Want me to try a different way?`,
      relevance: 0.7, importance: 0.6, novelty: 0.7, confidence: 0.9,
      timeliness: 0.9, personalContext: 0.5, annoyanceCost: 0.45
    }];
  }

  private fromProactiveIgnored(p: { backoffMultiplier: number }): CandidateInput[] {
    // §14/§30: silence deepens when lines go unacknowledged — the generator
    // intentionally returns NOTHING here; the event exists for diagnostics
    // and momentum accounting, not for more speech.
    void p;
    return [];
  }

  private fromInterruption(ctx: CandidateContext): CandidateInput[] {
    // §33: follow up on the interrupted topic ONLY when a memory anchors it
    // and the user re-engages later. Kept conservative by design.
    const anchor = ctx.relatedMemories.find(m => m.record.importance >= 0.7);
    if (!anchor) return [];
    return [{
      source: "interruption_followup",
      category: "INTERRUPTION_FOLLOWUP",
      draft: "Want me to pick up where I left off?",
      relevance: 0.6, importance: 0.5, novelty: 0.6, confidence: 0.7,
      timeliness: 0.7, personalContext: 0.8, annoyanceCost: 0.5,
      memoryIds: [anchor.record.id]
    }];
  }
}

/* ------------------------------ helpers ---------------------------------- */

function tokenize(s: string): Set<string> {
  return new Set(
    s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/)
      .filter(w => w.length > 2 && !STOP.has(w))
      .map(stem)
  );
}

/** Light suffix stemmer so "gpus" fuses with "GPU" (same as MemoryStore). */
function stem(w: string): string {
  if (w.length >= 4) {
    if (w.endsWith("ing")) return w.slice(0, -3);
    if (w.endsWith("ed")) return w.slice(0, -2);
    if (w.endsWith("es")) return w.slice(0, -2);
    if (w.endsWith("s")) return w.slice(0, -1);
  }
  return w;
}

const STOP = new Set([
  "the", "and", "for", "that", "this", "with", "you", "your", "have", "has",
  "was", "are", "were", "will", "would", "about", "into", "from", "com",
  "www", "app", "android", "google", "youtube", "video", "search"
]);

/** Trim a memory's third-person content into a short spoken topic. */
export function shortTopic(content: string): string {
  return content
    .replace(/^The user (is|was|has been)\s*/i, "")
    .replace(/\.$/, "")
    .slice(0, 48)
    .trim() || "that";
}
