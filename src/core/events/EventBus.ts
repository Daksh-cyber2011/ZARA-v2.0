/**
 * ZARA V1.0 — Typed event bus (Directive §38).
 *
 * The single nervous system connecting perception, memory, proactivity,
 * voice and the agent loop. Proactivity listens here; nothing polls.
 */

export interface ZaraEventMap {
  // Voice / conversation
  USER_SPOKE: { text: string; language?: string };
  USER_STOPPED_SPEAKING: { approxDurationMs: number };
  ZARA_STARTED_SPEAKING: { utteranceId: string; source: "reply" | "proactive" | "confirmation" | "system" };
  ZARA_STOPPED_SPEAKING: { utteranceId: string; completed: boolean };
  ZARA_INTERRUPTED: {
    utteranceId: string;
    phase: "speech" | "reasoning" | "tool";
    /** §19: structured interruption metadata. */
    turnId: string;
    at: number;
    reason: string;
    /** Partial text ZARA was saying when interrupted (§33 continuity). */
    interruptedText?: string;
  };
  // Agent
  ACTION_STARTED: { tool: string; callId: string };
  ACTION_COMPLETED: { tool: string; callId: string; verified: boolean };
  ACTION_FAILED: { tool: string; callId: string; error: string };
  CONFIRMATION_REQUESTED: { callId: string; tool: string; summary: string };
  CONFIRMATION_RESOLVED: { callId: string; approved: boolean };
  // Perception
  APP_CHANGED: { foreground: boolean };
  BATTERY_CHANGED: { level: number; charging: boolean };
  NETWORK_CHANGED: { online: boolean };
  TIMER_TRIGGERED: { timerId: string };
  REMINDER_TRIGGERED: { reminderId: string; content: string };
  USER_IDLE: { idleMs: number };
  USER_RETURNED: { awayMs: number };
  // §3 event-driven companion: conversation/lifecycle/mode events
  CONVERSATION_ENDED: { idleMs: number; turns: number };
  QUIET_MODE_CHANGED: { active: boolean; viaVoice: boolean };
  SLEEP_MODE_CHANGED: { active: boolean; reason: string };
  /** §30: a proactive line went unacknowledged past the ack window. */
  PROACTIVE_IGNORED: { at: number; backoffMultiplier: number };
  /** §3: deterministic clock milestone (morning/afternoon/evening/night/hour). */
  TIME_MILESTONE: { label: string; kind: "morning" | "afternoon" | "evening" | "night" | "hour" };
  /** §5-6: structured, meaningful screen-context change (permission-gated). */
  SCREEN_CONTEXT_CHANGED: {
    app: string;
    packageName: string;
    screenType: string;
    visibleText: string;
    detectedEntities: string[];
    userActivity: string;
    confidence: number;
    timestamp: number;
    perceptionEventId: string;
  };
  /** §4: a perception capability changed state (off → permission_required → active…). */
  CAPABILITY_CHANGED: { capability: string; state: string; detail: string };
  // Memory
  MEMORY_RELEVANT: { memoryIds: string[]; trigger: string };
  MEMORY_UPDATED: { added: number; updated: number; removed: number };
  /** §34: recent conversation restored after an app/process restart. */
  SESSION_RESUMED: { messages: Array<{ role: "user" | "model"; text: string }>; ageMs: number };
  // System
  STATE_CHANGED: { from: string; to: string; reason: string };
  ERROR: { code: string; message: string };
}

export type ZaraEventName = keyof ZaraEventMap;
export type ZaraEventHandler<K extends ZaraEventName> = (payload: ZaraEventMap[K]) => void;

export class EventBus {
  private handlers = new Map<ZaraEventName, Set<(p: unknown) => void>>();
  private journal: { name: string; at: number; payload: unknown }[] = [];

  on<K extends ZaraEventName>(name: K, h: ZaraEventHandler<K>): () => void {
    if (!this.handlers.has(name)) this.handlers.set(name, new Set());
    this.handlers.get(name)!.add(h as (p: unknown) => void);
    return () => this.handlers.get(name)?.delete(h as (p: unknown) => void);
  }

  emit<K extends ZaraEventName>(name: K, payload: ZaraEventMap[K]): void {
    this.journal.push({ name, at: Date.now(), payload });
    if (this.journal.length > 300) this.journal.shift();
    const set = this.handlers.get(name);
    if (!set) return;
    for (const h of [...set]) {
      try { h(payload); } catch (e) { console.error(`[EventBus] handler for ${name} failed`, e); }
    }
  }

  /** Read-only recent event journal for the diagnostics panel (§46). */
  get recentEvents(): readonly { name: string; at: number; payload: unknown }[] {
    return this.journal;
  }

  clear(): void {
    this.handlers.clear();
    this.journal = [];
  }
}

/** Process-wide bus. Subsystems receive it via constructor injection (testable). */
export const eventBus = new EventBus();
