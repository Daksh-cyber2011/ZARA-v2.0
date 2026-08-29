/**
 * ZARA V1.0 — Proactive candidate types (Directive §5).
 *
 * Every observation that *could* become proactive speech becomes a scored
 * candidate. Sources: timer/reminder events, time, user interaction,
 * conversation state, memory, unfinished tasks, action results,
 * connectivity changes, meaningful context changes.
 */

export type ProactiveSource =
  | "reminder"
  | "timer"
  | "memory_relevance"
  | "unfinished_task"
  | "action_result"
  | "connectivity"
  | "battery"
  | "time_of_day"
  | "app_context"
  | "user_idle"
  | "user_returned"
  | "interruption_followup"   // §6 #9 — ZARA was interrupted; follow up later
  | "conversation_followup"   // §6 #10 — open conversational thread
  | "post_action_followup"    // §6 #19 — verified action outcome worth noting
  | "periodic_check"          // §6 #18 — low-frequency ambient check
  | "error_recovery"          // §6 #20 — recovering from a failure
  | "important_event";        // §6 #15 — genuinely important event

/** §6 candidate category taxonomy (diagnostic labeling + policy bands). */
export type ProactiveCategory =
  | "NEW_CONTEXT"
  | "APP_CHANGED"
  | "SCREEN_CONTEXT_CHANGED"
  | "USER_RETURNED"
  | "USER_AWAY"
  | "MEMORY_TRIGGER"
  | "REMINDER_APPROACHING"
  | "TASK_CONTINUATION"
  | "INTERRUPTION_FOLLOWUP"
  | "CONVERSATION_FOLLOWUP"
  | "TIME_CONTEXT"
  | "DEVICE_CONTEXT"
  | "USER_IDLE"
  | "IMPORTANT_EVENT"
  | "SYSTEM_EVENT"
  | "EXPLICIT_USER_INTEREST"
  | "SOMETHING_ZARA_NOTICED"
  | "PERIODIC_CHECK"
  | "POST_ACTION_FOLLOWUP"
  | "ERROR_RECOVERY";

/** Default category per source — explicit category may override. */
export const SOURCE_CATEGORY: Readonly<Record<ProactiveSource, ProactiveCategory>> = {
  reminder: "REMINDER_APPROACHING",
  timer: "REMINDER_APPROACHING",
  memory_relevance: "MEMORY_TRIGGER",
  unfinished_task: "TASK_CONTINUATION",
  action_result: "POST_ACTION_FOLLOWUP",
  connectivity: "SYSTEM_EVENT",
  battery: "DEVICE_CONTEXT",
  time_of_day: "TIME_CONTEXT",
  app_context: "APP_CHANGED",
  user_idle: "USER_IDLE",
  user_returned: "USER_RETURNED",
  interruption_followup: "INTERRUPTION_FOLLOWUP",
  conversation_followup: "CONVERSATION_FOLLOWUP",
  post_action_followup: "POST_ACTION_FOLLOWUP",
  periodic_check: "PERIODIC_CHECK",
  error_recovery: "ERROR_RECOVERY",
  important_event: "IMPORTANT_EVENT"
};

export interface ProactiveCandidate {
  id: string;
  source: ProactiveSource;
  /** §6 category label (defaults from SOURCE_CATEGORY when omitted). */
  category?: ProactiveCategory;
  /** What ZARA might say (draft; final phrasing happens at speak time). */
  draft: string;
  /** 0..1 — how related to the user's current context. */
  relevance: number;
  /** 0..1 — how much it matters if ignored. */
  importance: number;
  /** 0..1 — how new this information is (vs. something just said). */
  novelty: number;
  /** 0..1 — how sure the system is the observation is correct. */
  confidence: number;
  /** 0..1 — is NOW the right time window. */
  timeliness: number;
  /** 0..1 — how personal (about the user's own life/projects). */
  personalContext: number;
  /** 0..1 — estimated cost of interrupting the user right now. */
  annoyanceCost: number;
  /** Optional: memory ids backing this candidate (§24). */
  memoryIds?: string[];
  /** Candidate creation time (epoch ms). */
  createdAt: number;
}

export type ProactiveDecision =
  | "SPEAK_NOW"
  | "WAIT"
  | "SAVE_FOR_LATER"
  | "IGNORE";

export interface ScoredCandidate {
  candidate: ProactiveCandidate;
  score: number;
  decision: ProactiveDecision;
  reason: string;           // structured diagnostic string (§46 — no CoT)
}

export function newCandidateId(): string {
  return "pc_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
}
