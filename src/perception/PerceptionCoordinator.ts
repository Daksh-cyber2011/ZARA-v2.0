/**
 * ZARA V1.1 — Perception coordinator (Directive §3 pipeline, §37-38, §46).
 *
 * Owns the EVENT-DRIVEN half of the companion loop:
 *
 *   raw bus/native events
 *     → EventNormalizer      (typed + deduped + significance-ranked)
 *     → significance gate    (§35 — insignificant events never speak)
 *     → CandidateGenerator   (deterministic drafts, §37 memory fusion)
 *     → runtime callback     (3-stage engine: policy → GLM → policy)
 *
 * ALSO owns the §38 perception→memory loop: meaningful screen contexts write
 * temporary_context memories (30-min TTL); repeated observation of the same
 * topic deterministically promotes it to a semantic memory — never silently
 * to permanent storage.
 *
 * Extracted from ZaraRuntime (§46) so the composition root stays lean while
 * the event wiring lives in one inspectable, testable place.
 */
import { EventBus, ZaraEventMap, ZaraEventName } from "../core/events/EventBus";
import { Diagnostics } from "../core/logging/Diagnostics";
import { ZaraSettings } from "../core/configuration/Settings";
import { MemoryStore } from "../memory/storage/MemoryStore";
import { MemoryRetriever } from "../memory/retrieval/MemoryRetriever";
import { ProactiveCandidate } from "../proactivity/types";
import { CandidateGenerator } from "../proactivity/CandidateGenerator";
import {
  EventNormalizer, NormalizedEvent, BUS_TO_KIND
} from "./EventNormalizer";
import { ScreenContextProvider, ScreenContext } from "./ScreenContext";
import { PerceptionCapability } from "./capabilities";
import { resolveAppCapability } from "./capabilities";

/** Bus events the coordinator routes through the pipeline. */
const PIPELINE_EVENTS: readonly ZaraEventName[] = [
  "USER_SPOKE", "CONVERSATION_ENDED", "USER_RETURNED", "USER_IDLE",
  "APP_CHANGED", "SCREEN_CONTEXT_CHANGED", "BATTERY_CHANGED",
  "NETWORK_CHANGED", "TIME_MILESTONE", "REMINDER_TRIGGERED",
  "ACTION_COMPLETED", "ACTION_FAILED", "ZARA_INTERRUPTED", "PROACTIVE_IGNORED"
];

/** §3 conversation-end detection: idle after real turns. */
const CONVERSATION_END_IDLE_MS = 90 * 1000;

export interface PerceptionCoordinatorOptions {
  bus: EventBus;
  diag: Diagnostics;
  settings: () => ZaraSettings;
  memory: MemoryStore;
  retriever: MemoryRetriever;
  normalizer?: EventNormalizer;
  screen?: ScreenContextProvider;
  clock?: () => number;
}

export class PerceptionCoordinator {
  readonly normalizer: EventNormalizer;
  readonly screen: ScreenContextProvider;
  private readonly clock: () => number;
  /** Candidates ready for the 3-stage engine — set by the runtime. */
  onCandidates: (candidates: ProactiveCandidate[], event: NormalizedEvent) => void = () => {};

  // §3 conversation-end tracking
  private conversationTimer: ReturnType<typeof setTimeout> | null = null;
  private turnsInConversation = 0;

  // §3 time-milestone ticker
  private milestoneTimer: ReturnType<typeof setInterval> | null = null;
  private lastPartOfDay = "";
  private lastHour = -1;

  // §38 screen-interest tracking (temporary_context promotion)
  private screenInterest = new Map<string, { topic: string; count: number; lastAt: number }>();

  private unsubs: (() => void)[] = [];

  constructor(private opts: PerceptionCoordinatorOptions) {
    this.normalizer = opts.normalizer ?? new EventNormalizer(opts.diag);
    this.screen = opts.screen ?? new ScreenContextProvider(opts.bus, opts.diag);
    this.clock = opts.clock ?? Date.now;
  }

  /* ------------------------------ lifecycle ------------------------------- */

  start(): void {
    this.stop();
    // §3: normalize + generate for every pipeline-relevant bus event.
    for (const name of PIPELINE_EVENTS) {
      this.unsubs.push(
        this.opts.bus.on(name, payload => {
          this.handleBusEvent(name, payload);
        })
      );
    }
    // §3 conversation-end: user speech arms a timer; silence ends the thread.
    this.unsubs.push(
      this.opts.bus.on("USER_SPOKE", () => {
        this.turnsInConversation++;
        this.armConversationEnd();
      })
    );
    this.startMilestoneTicker();
  }

  stop(): void {
    for (const u of this.unsubs) { try { u(); } catch { /* noop */ } }
    this.unsubs = [];
    if (this.conversationTimer) clearTimeout(this.conversationTimer);
    this.conversationTimer = null;
    if (this.milestoneTimer) clearInterval(this.milestoneTimer);
    this.milestoneTimer = null;
  }

  /* ------------------------------ pipeline -------------------------------- */

  private handleBusEvent(name: ZaraEventName, payload: unknown): void {
    const kind = BUS_TO_KIND[name];
    if (!kind) return;
    const event = this.normalizer.normalize(kind, payload, this.clock());
    if (!event) return; // duplicate within its window — dropped (§41 #24)
    this.diagJournal(event);

    // §38: screen contexts feed the perception→memory loop regardless of
    // whether they also become candidates.
    if (kind === "SCREEN_CONTEXT_CHANGED") {
      void this.recordScreenInterest(event.payload as ScreenContext);
    }

    if (!this.normalizer.isSignificant(event)) {
      this.opts.diag.log("perception", "EVENT_INSIGNIFICANT", { kind: event.kind });
      return; // §35: journaled, no candidate generation
    }
    this.dispatch(event);
  }

  /** Generate candidates for a normalized event and hand them to the engine. */
  private dispatch(event: NormalizedEvent): void {
    const s = this.opts.settings();
    // §24/§11: memory-disabled or app-awareness-off → screen/app/memory-
    // derived candidates are not generated at all.
    if (!s.proactivityEnabled) return;
    const screenish = event.kind === "SCREEN_CONTEXT_CHANGED" || event.kind === "APP_CHANGED";
    if (screenish && (!s.appAwareness || !s.screenAwareness)) return;
    if (event.kind === "USER_RETURNED" && !s.appAwareness) return;

    // §37 fusion input: memories retrieved against the event's own text.
    const relatedMemories = s.memoryEnabled
      ? this.opts.retriever.retrieve(eventText(event), { limit: 4 }).map(m => ({ record: m.record, score: m.score }))
      : [];

    const candidates = this.generator.generate(event, { relatedMemories, userPresent: true });
    if (candidates.length) this.onCandidates(candidates, event);
  }

  private readonly generator = new CandidateGenerator();

  /* --------------------- §38 perception → memory loop --------------------- */

  /**
   * A meaningful screen context becomes a temporary_context memory with a
   * 30-minute TTL. Repeated observation of the same topic (≥3 times within
   * 2 hours) promotes it to a semantic memory with a 7-day TTL — a
   * deterministic promotion path; permanent memory still requires explicit
   * conversation (consolidator). Never stores raw screenshots (§24).
   */
  private async recordScreenInterest(screen: ScreenContext): Promise<void> {
    const s = this.opts.settings();
    if (!s.memoryEnabled || !s.screenAwareness || !this.screen.isEnabled) return;
    if (!screen.detectedEntities.length) return;
    const topic = screen.detectedEntities[0];
    const key = `${screen.packageName}::${topic.toLowerCase()}`;
    const now = this.clock();
    const entry = this.screenInterest.get(key) ?? { topic, count: 0, lastAt: now };
    entry.count += 1;
    entry.lastAt = now;
    this.screenInterest.set(key, entry);

    const content = `The user is ${screen.userActivity} about ${topic} (on ${screen.app}).`;

    if (entry.count >= 3 && now - entry.lastAt < 2 * 3600 * 1000) {
      // §38 promotion: repeated interest → semantic memory (7-day TTL).
      await this.opts.memory.applyTransaction({
        action: "ADD",
        type: "semantic",
        content: `The user repeatedly engages with ${topic} on ${screen.app}.`,
        importance: 0.5,
        confidence: 0.7,
        expiresAt: now + 7 * 24 * 3600 * 1000
      }, "perception");
      this.opts.diag.log("memory", "PERCEPTION_PROMOTED", { topic, observations: entry.count });
      entry.count = 0; // promotion done; do not re-promote immediately
    } else {
      await this.opts.memory.applyTransaction({
        action: "ADD",
        type: "temporary_context",
        content,
        importance: 0.3,
        confidence: 0.5 + 0.3 * screen.confidence,
        expiresAt: now + 30 * 60 * 1000
      }, "perception");
      this.opts.diag.log("memory", "PERCEPTION_CONTEXT", { topic, app: screen.app, count: entry.count });
    }
  }

  /* ------------------------- §3 conversation end -------------------------- */

  private armConversationEnd(): void {
    if (this.conversationTimer) clearTimeout(this.conversationTimer);
    this.conversationTimer = setTimeout(() => {
      if (this.turnsInConversation === 0) return;
      const turns = this.turnsInConversation;
      this.turnsInConversation = 0;
      this.opts.bus.emit("CONVERSATION_ENDED", { idleMs: CONVERSATION_END_IDLE_MS, turns });
    }, CONVERSATION_END_IDLE_MS);
  }

  /* ------------------------- §3 time milestones ---------------------------- */

  private startMilestoneTicker(): void {
    const tick = () => {
      const d = new Date(this.clock());
      const hour = d.getHours();
      const part =
        hour < 5 ? "night" : hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 21 ? "evening" : "night";
      if (part !== this.lastPartOfDay && this.lastPartOfDay !== "") {
        this.opts.bus.emit("TIME_MILESTONE", { label: part, kind: part as "morning" });
        this.lastPartOfDay = part;
      } else if (this.lastPartOfDay === "") {
        this.lastPartOfDay = part;
      }
      if (hour !== this.lastHour) {
        if (this.lastHour !== -1) {
          this.opts.bus.emit("TIME_MILESTONE", {
            label: `${String(hour).padStart(2, "0")}:00`,
            kind: "hour"
          });
        }
        this.lastHour = hour;
      }
    };
    tick();
    this.milestoneTimer = setInterval(tick, 60 * 1000);
  }

  /* ----------------------------- §4 snapshot ------------------------------ */

  /** Honest capability snapshot for diagnostics + the model context. */
  capabilities(): PerceptionCapability[] {
    const s = this.opts.settings();
    return [
      this.screen.screenCapability,
      {
        id: "app_awareness",
        label: "App awareness",
        state: resolveAppCapability({ platformSupported: true, userEnabled: s.appAwareness }),
        detail: s.appAwareness
          ? "Active — own-app lifecycle and (when screen awareness is on) other-app context events."
          : "Off in Settings."
      },
      {
        id: "device_context",
        label: "Device context",
        state: "active",
        detail: "Battery, connectivity, clock, idle — normal permissions only."
      },
      {
        id: "notification_awareness",
        label: "Notification awareness",
        state: "unavailable",
        detail: "Not implemented — ZARA does not read notifications (§4 honest absence)."
      }
    ];
  }

  private diagJournal(event: NormalizedEvent): void {
    this.opts.diag.log("perception", "EVENT_NORMALIZED", {
      kind: event.kind, significance: +event.significance.toFixed(2), id: event.id
    });
  }
}

/** Extract the text used for §37 memory retrieval against an event. */
function eventText(e: NormalizedEvent): string {
  const p = e.payload as Partial<ZaraEventMap[keyof ZaraEventMap]> & { visibleText?: string; content?: string; app?: string };
  if (e.kind === "SCREEN_CONTEXT_CHANGED" && p && typeof p === "object") {
    const sc = p as unknown as ScreenContext;
    return `${sc.app} ${sc.visibleText} ${sc.detectedEntities.join(" ")}`;
  }
  if (p && typeof p === "object") {
    return String((p as { content?: string; label?: string; tool?: string }).content
      ?? (p as { label?: string }).label
      ?? (p as { tool?: string }).tool
      ?? "");
  }
  return "";
}
