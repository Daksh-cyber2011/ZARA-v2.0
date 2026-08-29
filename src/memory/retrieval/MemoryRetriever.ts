/**
 * ZARA V1.0 — Memory retrieval with relevance ranking (§23).
 *
 * Retrieves a SMALL, ranked set based on the current context — never the
 * whole database. Ranking combines:
 *   keyword overlap · recency · importance · confidence · type relevance.
 */
import { MemoryRecord, PROACTIVITY_RELEVANT_TYPES } from "../types";
import { norm } from "../storage/MemoryStore";

export interface ScoredMemory {
  record: MemoryRecord;
  score: number;
}

/** Words that carry little retrieval signal. */
const STOP = new Set([
  "the", "and", "for", "that", "this", "with", "you", "your", "have", "has",
  "was", "are", "were", "will", "would", "about", "into", "from", "they",
  "them", "their", "what", "when", "where", "which", "who", "how", "why",
  "does", "did", "doing", "just", "like", "some", "more", "very", "much",
  "hai", "hain", "kya", "ka", "ki", "ke", "ko", "mein", "mera", "meri"
]);

function tokens(s: string): Set<string> {
  return new Set(norm(s).split(" ").filter(w => w.length > 2 && !STOP.has(w)));
}

export function scoreMemory(record: MemoryRecord, queryTokens: Set<string>, now: number): number {
  // 1. Keyword overlap with current query/context (0..1, weight 0.45)
  const memTokens = tokens(record.content + " " + record.relatedEntities.join(" "));
  let overlap = 0;
  if (queryTokens.size && memTokens.size) {
    for (const t of queryTokens) if (memTokens.has(t)) overlap++;
    overlap = overlap / queryTokens.size;
  }

  // 2. Recency (0..1, weight 0.2) — half-life of 14 days on access.
  const ageDays = Math.max(0, (now - record.updatedAt) / 86400000);
  const recency = Math.exp(-ageDays / 14);

  // 3. Importance (0..1, weight 0.2)
  const importance = record.importance;

  // 4. Confidence (0..1, weight 0.1)
  const confidence = record.confidence;

  // 5. Type relevance nudge (0/0.05): project/goal/routine memories are
  //    more actionable in companion contexts.
  const typeNudge = PROACTIVITY_RELEVANT_TYPES.includes(record.type) ? 0.05 : 0;

  return 0.45 * overlap + 0.2 * recency + 0.2 * importance + 0.1 * confidence + typeNudge;
}

export class MemoryRetriever {
  constructor(private store: { active(now?: number): readonly MemoryRecord[]; touch(id: string): void }) {}

  /**
   * Rank memories against a query string (current user message + recent
   * conversation tail). Returns top-N, only above `minScore`.
   */
  retrieve(query: string, opts: { limit?: number; minScore?: number; now?: number } = {}): ScoredMemory[] {
    const { limit = 8, minScore = 0.12, now = Date.now() } = opts;
    const qt = tokens(query);
    const scored = this.store.active(now)
      .map(r => ({ record: r, score: scoreMemory(r, qt, now) }))
      .filter(s => s.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    for (const s of scored) this.store.touch(s.record.id);
    return scored;
  }

  /** High-importance memories relevant for proactive triggers (§24). */
  proactivityCandidates(now = Date.now(), limit = 6): ScoredMemory[] {
    return this.store.active(now)
      .filter(r => PROACTIVITY_RELEVANT_TYPES.includes(r.type) && r.importance >= 0.6)
      .map(r => ({ record: r, score: r.importance }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}
