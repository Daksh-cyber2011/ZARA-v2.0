/**
 * ZARA V1.1 — Event normalizer (Directive §3).
 *
 * Every perception/system occurrence enters the proactive pipeline through
 * here: raw signals become TYPED, DEDUPED, SIGNIFICANCE-RANKED events.
 * The normalizer is deterministic (§43 — no model calls) and exists so that:
 *
 *   1. duplicate event storms never reach candidate generation (§41 #24)
 *   2. insignificant events are journaled but generate NO candidates
 *      (§35 — event-driven triggers, silence is normal)
 *   3. every downstream consumer sees one consistent typed contract
 */
import { EventBus, ZaraEventName } from "../core/events/EventBus";
import { Diagnostics } from "../core/logging/Diagnostics";
import { ScreenContext } from "./ScreenContext";

/** All §3 event sources ZARA recognizes, normalized. */
export type NormalizedEventKind =
  | "USER_SPOKE"
  | "USER_STOPPED_SPEAKING"
  | "CONVERSATION_ENDED"
  | "USER_RETURNED"
  | "USER_IDLE"
  | "APP_CHANGED"
  | "SCREEN_CONTEXT_CHANGED"
  | "BATTERY_CHANGED"
  | "NETWORK_CHANGED"
  | "TIME_MILESTONE"
  | "REMINDER_DUE"
  | "TASK_COMPLETED"
  | "ACTION_FAILED"
  | "USER_INTERRUPTED_ZARA"
  | "PROACTIVE_IGNORED"
  | "QUIET_MODE_ENTERED"
  | "QUIET_MODE_EXITED"
  | "SLEEP_ENTERED"
  | "SLEEP_EXITED";

export interface NormalizedEvent<P = unknown> {
  id: string;
  kind: NormalizedEventKind;
  at: number;
  /** 0..1 — deterministic estimate of how much this event deserves attention. */
  significance: number;
  /** Dedup identity: same key within the window is dropped. */
  dedupeKey: string;
  payload: P;
}

/** Per-kind deterministic significance and dedup windows. */
type KindProfile = {
  significance: (p: never) => number;
  dedupeKey: (p: never) => string;
  dedupeMs: number;
};
const KIND_PROFILE: Record<NormalizedEventKind, KindProfile> = {
  USER_SPOKE:             { significance: () => 0.9, dedupeKey: () => "user_spoke", dedupeMs: 1000 },
  USER_STOPPED_SPEAKING:  { significance: () => 0.3, dedupeKey: () => "user_stopped", dedupeMs: 2000 },
  CONVERSATION_ENDED:     { significance: p => (p as { turns: number }).turns > 0 ? 0.6 : 0.2, dedupeKey: () => "conv_ended", dedupeMs: 30000 },
  USER_RETURNED:          { significance: p => awaySignificance((p as { awayMs: number }).awayMs), dedupeKey: p => `returned_${bucket((p as { awayMs: number }).awayMs)}`, dedupeMs: 60000 },
  USER_IDLE:              { significance: () => 0.25, dedupeKey: () => "user_idle", dedupeMs: 300000 },
  APP_CHANGED:            { significance: p => (p as { foreground: boolean }).foreground ? 0.5 : 0.3, dedupeKey: p => `app_${(p as { foreground: boolean }).foreground}`, dedupeMs: 15000 },
  SCREEN_CONTEXT_CHANGED: { significance: p => screenSignificance(p as ScreenContext), dedupeKey: p => `screen_${(p as ScreenContext).packageName}_${(p as ScreenContext).screenType}`, dedupeMs: 45000 },
  BATTERY_CHANGED:        { significance: p => (p as { level: number }).level < 0.2 ? 0.7 : 0.15, dedupeKey: p => `battery_${Math.round((p as { level: number }).level * 10)}`, dedupeMs: 120000 },
  NETWORK_CHANGED:        { significance: () => 0.3, dedupeKey: p => `net_${(p as { online: boolean }).online}`, dedupeMs: 60000 },
  TIME_MILESTONE:         { significance: () => 0.35, dedupeKey: p => `time_${(p as { label: string }).label}`, dedupeMs: 3600000 },
  REMINDER_DUE:           { significance: () => 1.0, dedupeKey: p => `reminder_${(p as { reminderId: string }).reminderId}`, dedupeMs: 60000 },
  TASK_COMPLETED:         { significance: () => 0.55, dedupeKey: p => `task_${(p as { tool: string; callId: string }).callId}`, dedupeMs: 5000 },
  ACTION_FAILED:          { significance: () => 0.65, dedupeKey: p => `action_failed_${(p as { tool: string; callId: string }).callId}`, dedupeMs: 5000 },
  USER_INTERRUPTED_ZARA:  { significance: () => 0.7, dedupeKey: p => `interrupt_${(p as { turnId: string }).turnId}`, dedupeMs: 5000 },
  PROACTIVE_IGNORED:      { significance: () => 0.4, dedupeKey: () => "proactive_ignored", dedupeMs: 60000 },
  QUIET_MODE_ENTERED:     { significance: () => 0.1, dedupeKey: () => "quiet_on", dedupeMs: 5000 },
  QUIET_MODE_EXITED:      { significance: () => 0.1, dedupeKey: () => "quiet_off", dedupeMs: 5000 },
  SLEEP_ENTERED:          { significance: () => 0.1, dedupeKey: () => "sleep_on", dedupeMs: 5000 },
  SLEEP_EXITED:           { significance: () => 0.3, dedupeKey: () => "sleep_off", dedupeMs: 5000 }
};

function awaySignificance(awayMs: number): number {
  // §36: 20 s away → nothing; 20 min → relevant; hours → relevant.
  if (awayMs < 3 * 60000) return 0.15;
  if (awayMs < 20 * 60000) return 0.55;
  return 0.7;
}

function bucket(awayMs: number): string {
  if (awayMs < 60000) return "brief";
  if (awayMs < 10 * 60000) return "minutes";
  if (awayMs < 60 * 60000) return "long";
  return "hours";
}

function screenSignificance(c: ScreenContext): number {
  // Video/article contexts with entity text are the strongest signals;
  // unknown screens are weak; home screen is not worth attention.
  if (c.screenType === "home") return 0.15;
  if (c.screenType === "unknown") return 0.25;
  let s = 0.5 + 0.2 * c.confidence;
  if (c.detectedEntities.length) s += 0.15;
  return Math.min(1, s);
}

/** Events below this significance are journaled but never become candidates. */
export const SIGNIFICANCE_FLOOR = 0.45;

export class EventNormalizer {
  private recent: { key: string; at: number }[] = [];
  private journal: NormalizedEvent[] = [];

  constructor(private diag: Diagnostics) {}

  /**
   * Normalize one raw occurrence. Returns the typed event if it survived
   * dedup, or null when it is a duplicate inside its window.
   */
  normalize<P>(kind: NormalizedEventKind, payload: P, at = Date.now()): NormalizedEvent<P> | null {
    const profile = KIND_PROFILE[kind];
    const key = profile.dedupeKey(payload as never);
    const dup = this.recent.find(r => r.key === key && at - r.at < profile.dedupeMs);
    if (dup) {
      this.diag.log("perception", "EVENT_DEDUPLICATED", { kind, key });
      return null;
    }
    this.recent.push({ key, at });
    if (this.recent.length > 200) this.recent.splice(0, this.recent.length - 200);

    const event: NormalizedEvent<P> = {
      id: "ev_" + at.toString(36) + "_" + Math.random().toString(36).slice(2, 6),
      kind,
      at,
      significance: profile.significance(payload as never),
      dedupeKey: key,
      payload
    };
    this.journal.push(event as NormalizedEvent);
    if (this.journal.length > 100) this.journal.shift();
    return event;
  }

  /** True when the event may drive candidate generation (§35 significance gate). */
  isSignificant(e: NormalizedEvent): boolean {
    return e.significance >= SIGNIFICANCE_FLOOR;
  }

  /** Recent normalized events (diagnostics §25 "current perception event"). */
  get recentEvents(): readonly NormalizedEvent[] { return this.journal; }
  get lastEvent(): NormalizedEvent | null { return this.journal[this.journal.length - 1] ?? null; }

  reset(): void { this.recent = []; this.journal = []; }
}

/**
 * §3 source adapter: maps a typed bus event to its normalized kind when one
 * exists. Bus events that are pure bookkeeping (STATE_CHANGED, ERROR…) have
 * no normalized counterpart.
 */
export const BUS_TO_KIND: Partial<Record<ZaraEventName, NormalizedEventKind>> = {
  USER_SPOKE: "USER_SPOKE",
  USER_STOPPED_SPEAKING: "USER_STOPPED_SPEAKING",
  CONVERSATION_ENDED: "CONVERSATION_ENDED",
  USER_RETURNED: "USER_RETURNED",
  USER_IDLE: "USER_IDLE",
  APP_CHANGED: "APP_CHANGED",
  SCREEN_CONTEXT_CHANGED: "SCREEN_CONTEXT_CHANGED",
  BATTERY_CHANGED: "BATTERY_CHANGED",
  NETWORK_CHANGED: "NETWORK_CHANGED",
  TIME_MILESTONE: "TIME_MILESTONE",
  REMINDER_TRIGGERED: "REMINDER_DUE",
  ACTION_COMPLETED: "TASK_COMPLETED",
  ACTION_FAILED: "ACTION_FAILED",
  ZARA_INTERRUPTED: "USER_INTERRUPTED_ZARA",
  PROACTIVE_IGNORED: "PROACTIVE_IGNORED"
};
