/**
 * ZARA V1.0 — Conversation continuity across restarts (§34 PERSISTENCE).
 *
 * The §39 acceptance experience requires:
 *   User: "What were we working on yesterday?"
 *   → ZARA retrieves the relevant context.
 *
 * Long-term facts already live in the memory store; what was missing is the
 * RECENT CONVERSATION itself, which previously died with the process. This
 * module persists a bounded transcript tail so a restarted runtime resumes
 * with continuity instead of amnesia.
 *
 * Design (§34 "Temporary state should expire appropriately"):
 *   - only the last MAX_PERSISTED messages are kept (bounded storage);
 *   - the transcript carries a FRESHNESS window (default 48 h) — older
 *     sessions are discarded rather than replayed as if they just happened;
 *   - storage goes through the same KVStorage abstraction as settings
 *     (Capacitor Preferences on device, localStorage on web/tests);
 *   - corrupt or malformed data degrades to "no history" — never a crash.
 */

import type { KVStorage } from "../../core/configuration/Settings";
import type { ChatMessage } from "../provider/types";

const CONVERSATION_KEY = "zara.conversation.v1";

/** How many trailing messages survive a restart. */
export const MAX_PERSISTED = 24;

/** A transcript older than this is considered stale and dropped (ms). */
export const FRESHNESS_MS = 48 * 60 * 60 * 1000; // 48 hours

interface PersistedConversation {
  savedAt: number;
  messages: Array<{ role: ChatMessage["role"]; text: string }>;
}

function sanitize(raw: unknown): PersistedConversation | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Partial<PersistedConversation>;
  if (typeof p.savedAt !== "number" || !Array.isArray(p.messages)) return null;
  const messages: PersistedConversation["messages"] = [];
  for (const m of p.messages) {
    if (!m || typeof m !== "object") continue;
    const r = m as { role?: unknown; text?: unknown };
    const role = r.role === "user" || r.role === "model" ? r.role : null;
    if (!role || typeof r.text !== "string" || !r.text.trim()) continue;
    messages.push({ role, text: r.text.slice(0, 4000) }); // hard char bound
  }
  return { savedAt: p.savedAt, messages };
}

/** Persist the tail of a conversation. Never throws — persistence is
 * best-effort and must not break a live turn. */
export async function persistConversation(
  storage: KVStorage,
  history: readonly ChatMessage[]
): Promise<void> {
  try {
    if (history.length === 0) {
      await storage.remove(CONVERSATION_KEY);
      return;
    }
    const tail = history.slice(-MAX_PERSISTED);
    const payload: PersistedConversation = {
      savedAt: Date.now(),
      messages: tail.map(m => ({ role: m.role, text: m.text }))
    };
    await storage.set(CONVERSATION_KEY, JSON.stringify(payload));
  } catch {
    /* storage unavailable — continuity is a nice-to-have, never a crash */
  }
}

export interface RestoredConversation {
  messages: ChatMessage[];
  /** Age of the restored transcript in ms (0 for fresh saves). */
  ageMs: number;
  /** True when a transcript existed but was older than the freshness window. */
  expired: boolean;
}

/**
 * Restore the persisted conversation tail. A stale, corrupt or missing
 * transcript yields `{ messages: [], expired: true|false }` — the caller
 * simply starts fresh.
 */
export async function restoreConversation(
  storage: KVStorage,
  opts: { now?: () => number; freshnessMs?: number } = {}
): Promise<RestoredConversation> {
  const now = opts.now ?? Date.now;
  const freshnessMs = opts.freshnessMs ?? FRESHNESS_MS;
  try {
    const raw = await storage.get(CONVERSATION_KEY);
    if (!raw) return { messages: [], ageMs: 0, expired: false };
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      await storage.remove(CONVERSATION_KEY); // corrupt → clear
      return { messages: [], ageMs: 0, expired: true };
    }
    const conv = sanitize(parsed);
    if (!conv) {
      await storage.remove(CONVERSATION_KEY);
      return { messages: [], ageMs: 0, expired: true };
    }
    const ageMs = Math.max(0, now() - conv.savedAt);
    if (ageMs > freshnessMs) {
      await storage.remove(CONVERSATION_KEY); // §34: expire stale transcripts
      return { messages: [], ageMs, expired: true };
    }
    return {
      messages: conv.messages.map(m => ({ role: m.role, text: m.text })),
      ageMs,
      expired: false
    };
  } catch {
    return { messages: [], ageMs: 0, expired: false };
  }
}

/** Explicitly clear the persisted transcript (e.g. user resets the app). */
export async function clearConversation(storage: KVStorage): Promise<void> {
  try {
    await storage.remove(CONVERSATION_KEY);
  } catch {
    /* best-effort */
  }
}
