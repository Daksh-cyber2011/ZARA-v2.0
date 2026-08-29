/**
 * ZARA V1.0 — Memory record types (Directive §20-21).
 *
 * Structured, typed persistent memory — NOT chat history. Every record
 * carries importance, confidence, freshness, expiry, privacy class and
 * entity links so retrieval, ranking and forgetting are all real.
 */

export type MemoryType =
  | "user_fact"         // stable facts about the user
  | "preference"        // likes / dislikes / style
  | "routine"           // recurring behaviors/schedules
  | "project"           // ongoing projects with state
  | "goal"              // aspirations and targets
  | "relationship"      // people in the user's life
  | "episodic"          // important events/interactions
  | "semantic"          // generalized knowledge from repetition
  | "interaction"       // patterns that improve assistance
  | "temporary_context" // short-lived conversational context (auto-expires)
  | "task"              // user tasks / open to-dos (§12 TASK)
  | "decision"          // decisions the user made (§12 DECISION)
  | "device_context";   // device/environment facts (§12 DEVICE_CONTEXT)

export type PrivacyClass = "normal" | "sensitive";

export interface MemoryRecord {
  id: string;
  type: MemoryType;
  content: string;              // third-person declarative statement
  source: "conversation" | "explicit" | "perception" | "system";
  createdAt: number;            // epoch ms
  updatedAt: number;            // epoch ms
  confidence: number;           // 0..1
  importance: number;           // 0..1
  lastAccessed: number;         // epoch ms — freshness/recall tracking
  accessCount: number;
  relatedEntities: string[];    // lowercase entity tokens (names, projects…)
  expiresAt: number | null;     // epoch ms — null = permanent
  privacy: PrivacyClass;
}

export interface MemoryTransaction {
  action: "ADD" | "UPDATE" | "REMOVE" | "NOOP";
  id?: string;                  // target for UPDATE / REMOVE
  type?: MemoryType;
  content?: string;
  importance?: number;          // 0..1
  confidence?: number;          // 0..1
  expiresAt?: number | null;
  reason?: string;              // short consolidation rationale (diagnostics)
}

export const MEMORY_TYPES: readonly MemoryType[] = [
  "user_fact", "preference", "routine", "project", "goal",
  "relationship", "episodic", "semantic", "interaction",
  "temporary_context", "task", "decision", "device_context"
];

/** Memories of these types may drive proactive behavior (§24). */
export const PROACTIVITY_RELEVANT_TYPES: readonly MemoryType[] = [
  "project", "goal", "routine", "preference", "task"
];

export function newMemoryId(): string {
  return "m_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

/** Default importance by type — heuristic prior, refined by consolidator. */
export const DEFAULT_IMPORTANCE: Record<MemoryType, number> = {
  user_fact: 0.8,
  preference: 0.6,
  routine: 0.5,
  project: 0.85,
  goal: 0.85,
  relationship: 0.7,
  episodic: 0.45,
  semantic: 0.5,
  interaction: 0.4,
  temporary_context: 0.3,
  task: 0.7,
  decision: 0.65,
  device_context: 0.35
};

/** Default time-to-live by type — temporary_context decays fast (§13). */
export const DEFAULT_TTL_MS: Partial<Record<MemoryType, number>> = {
  temporary_context: 30 * 60 * 1000, // 30 minutes
  episodic: 24 * 60 * 60 * 1000      // 1 day
};
