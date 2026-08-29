/**
 * ZARA V1.0 — Runtime composition root (Directive §60: ONE COMPANION).
 *
 * Wires every subsystem into a single coherent runtime:
 *   state machine · event bus · diagnostics · settings/secrets · providers ·
 *   context engine · memory (store/retriever/consolidator) · agent
 *   (registry/confirmations/orchestrator) · proactivity · perception ·
 *   voice (live session + speech queue + barge-in) · avatar.
 *
 * All public methods are the ONLY ways the UI may drive ZARA.
 */
import { StateMachine } from "./core/state/StateMachine";
import { eventBus, EventBus } from "./core/events/EventBus";
import { diagnostics, Diagnostics } from "./core/logging/Diagnostics";
import { settingsStore, secretStore, ZaraSettings, KVStorage } from "./core/configuration/Settings";
import { persistConversation, restoreConversation, clearConversation } from "./cognition/context/ConversationPersistence";
import { buildSystemPrompt } from "./core/configuration/Persona";
import { ProviderRegistry } from "./cognition/provider/ProviderRegistry";
import { ContextEngine, ContextSnapshot } from "./cognition/context/ContextEngine";
import { ChatMessage } from "./cognition/provider/types";
import { MemoryStore, pickMemoryPersistence } from "./memory/storage/MemoryStore";
import { MemoryRetriever } from "./memory/retrieval/MemoryRetriever";
import { MemoryConsolidator } from "./memory/consolidation/Consolidator";
import { ToolRegistry } from "./agent/tools/ToolRegistry";
import { buildAndroidTools } from "./agent/tools/AndroidTools";
import { WebFallbackBridge } from "./agent/tools/WebFallbackBridge";
import { ZaraNativeBridge, isNativeAvailable } from "./native/ZaraNativeBridge";
import { NativeBridge, ToolContext } from "./agent/tools/ToolTypes";
import { ConfirmationManager } from "./agent/confirmation/ConfirmationManager";
import { AgentOrchestrator } from "./agent/orchestrator/AgentOrchestrator";
import { AntiSpamPolicy } from "./proactivity/policy/AntiSpam";
import { ProactiveDecisionEngine } from "./proactivity/ProactiveDecisionEngine";
import { ProactiveRefiner } from "./proactivity/Refiner";
import { ProactiveCandidate } from "./proactivity/types";
import { PerceptionCoordinator } from "./perception/PerceptionCoordinator";
import { PerceptionService } from "./perception/PerceptionService";
import {
  probeScreenCapability, setScreenForwarding,
  onScreenObservation, onServiceState, isPerceptionPluginAvailable
} from "./native/ScreenAwareness";
import { SpeechQueue } from "./voice/SpeechQueue";
import { GeminiLiveSession } from "./voice/LiveVoice";
import { NativeVoiceSession } from "./voice/NativeVoice";
import { isVoicePluginAvailable, nativeTtsSpeak, nativeTtsStop } from "./voice/NativeVoiceBridge";
import { InterruptionController } from "./voice/interruption/InterruptionController";
import { EmotionController } from "./avatar/emotion/EmotionController";
import { emotionFromReply } from "./avatar/emotion/EmotionController";

export interface ZaraRuntimeOptions {
  nativeBridge?: NativeBridge;
  /** Injectable settings/secret stores (tests); production uses the singletons. */
  settings?: import("./core/configuration/Settings").SettingsStore;
  secrets?: import("./core/configuration/Settings").SecretStore;
  /** §34: injectable conversation-persistence storage (tests). */
  conversationStorage?: import("./core/configuration/Settings").KVStorage;
}

/** §37: structured runtime status for the diagnostics panel. */
export interface RuntimeStatus {
  state: string;
  lastTransition: { from: string; to: string; reason: string; at: number } | null;
  quiet: boolean;
  sleeping: boolean;
  provider: { id: string; model: string; configured: boolean };
  voice: { mode: string; ttsBackend: string; queueLength: number; speaking: boolean };
  memory: { enabled: boolean; activeCount: number };
  perception: string[];
  /** §4 V1.1: honest capability states (screen/app/device/notification). */
  capabilities: { id: string; label: string; state: string; detail: string }[];
  /** §5-6: last structured screen context (only when permitted). */
  screen: { app: string; screenType: string; activity: string; at: number } | null;
  /** §25: the most recent normalized perception event. */
  lastPerceptionEvent: { kind: string; significance: number; at: number } | null;
  /** §22: wake-word honesty line (what is really supported). */
  wakeWord: string;
  proactivity: {
    enabled: boolean;
    dailyCount: number;
    dailyLimit: number;
    cooldownRemainingMs: number;
    momentum: { unacknowledged: number; multiplier: number };
    savedCount: number;
    lastDecision: { source: string; category?: string; decision: string; reason: string; at: number } | null;
  };
  lastAction: { tool: string; ok: boolean; verification: string; at: number } | null;
  lastInterruption: { at: number; reason: string; phase: string } | null;
  /** FINAL-INTEGRATION §34: honest avatar status (VRM character / fallback). */
  avatar: { mode: "vrm" | "procedural" | "loading"; detail: string };
  toolsCount: number;
  turn: string;
}

export class ZaraRuntime {
  // Core — §20: runtime boots in BOOTING and reaches IDLE only after init().
  readonly sm = new StateMachine("BOOTING");
  readonly bus: EventBus = eventBus;
  readonly diag: Diagnostics = diagnostics;
  readonly settings: import("./core/configuration/Settings").SettingsStore;
  readonly secrets: import("./core/configuration/Settings").SecretStore;
  readonly emotions = new EmotionController();

  // Cognition
  readonly providers: ProviderRegistry;
  readonly context = new ContextEngine();

  // Memory
  readonly memory: MemoryStore;
  readonly retriever: MemoryRetriever;
  consolidator: MemoryConsolidator;

  // Agent
  readonly tools = new ToolRegistry();
  readonly confirmations: ConfirmationManager;
  agent: AgentOrchestrator;
  private dialogueLog: Parameters<MemoryConsolidator["processSlice"]>[0] = [];

  // Proactivity
  readonly antiSpam = new AntiSpamPolicy();
  proactive: ProactiveDecisionEngine;
  proactiveRefiner: ProactiveRefiner;
  private proactiveCheckTimer: ReturnType<typeof setInterval> | null = null;

  // Perception
  readonly perception: PerceptionService;
  /** §3 V1.1: event-driven pipeline owner (normalizer → generator → engine). */
  readonly perceptionCoordinator: PerceptionCoordinator;
  private screenUnsubs: (() => void)[] = [];

  // Voice
  readonly speech: SpeechQueue;
  readonly live: GeminiLiveSession;
  readonly nativeVoice: NativeVoiceSession;
  interruption: InterruptionController;

  private history: ChatMessage[] = [];
  /** §34: transcript restored from the previous session (empty on fresh
   * starts). The UI reads this AFTER init() — the SESSION_RESUMED event
   * alone is racy because listeners attach after init completes. */
  restoredConversation: readonly (ChatMessage & { role: "user" | "model" })[] = [];
  /** §34: storage used for conversation continuity across restarts. */
  private conversationStorage: KVStorage;
  private activeTask: string | null = null;
  private quietMode = false;
  private native: NativeBridge;
  private unsubs: (() => void)[] = [];
  private lastProactiveCandidate: ProactiveCandidate | null = null;
  // §19/§33: turn numbering + when the last interruption happened.
  private turnCounter = 0;
  private interruptionTurn = -1;
  onEvent?: (kind: "state" | "transcript" | "reply" | "error" | "confirmation" | "proactive") => void;

  constructor(opts: ZaraRuntimeOptions = {}) {
    this.settings = opts.settings ?? settingsStore;
    this.secrets = opts.secrets ?? secretStore;
    this.conversationStorage = opts.conversationStorage ?? pickConversationStorage();
    this.providers = new ProviderRegistry(this.settings, this.secrets);

    this.memory = new MemoryStore(pickMemoryPersistence(), this.diag);
    this.retriever = new MemoryRetriever(this.memory);
    this.consolidator = new MemoryConsolidator(() => this.providers.active(), this.memory, this.diag);

    for (const tool of buildAndroidTools()) this.tools.register(tool);
    // Device → typed native plugin; web preview/tests → honest fallback.
    this.native = opts.nativeBridge ?? (isNativeAvailable() ? new ZaraNativeBridge() : new WebFallbackBridge());
    this.confirmations = new ConfirmationManager(this.bus, this.diag);

    const toolCtx: ToolContext = {
      emitActionEvent: (name, payload) => this.bus.emit(name as "ACTION_COMPLETED", payload as never),
      hasPermission: perm => this.permissionState.has(perm),
      requestPermission: async perm => {
        try {
          const { request } = await import("./native/Permissions");
          return await request(perm as Parameters<typeof request>[0]);
        } catch { return false; }
      },
      native: this.native,
      now: () => Date.now()
    };

    this.agent = new AgentOrchestrator({
      provider: () => this.providers.active(),
      tools: this.tools,
      confirmations: this.confirmations,
      context: this.context,
      bus: this.bus,
      diag: this.diag,
      sm: this.sm,
      toolCtx,
      consolidator: () => this.consolidator,
      dialogueLog: this.dialogueLog
    });

    this.proactive = new ProactiveDecisionEngine(this.bus, this.diag, this.sm, this.antiSpam, () => this.settings.current);
    // §39 stage 2: bounded model reasoning for proactive candidates.
    this.proactiveRefiner = new ProactiveRefiner(() => this.providers.active(), this.diag);
    this.proactive.attachRefiner(this.proactiveRefiner);

    this.perception = new PerceptionService(this.bus, this.diag);

    // §3 V1.1: the event-driven half of the companion loop. Generated
    // candidates flow into the SAME 3-stage engine as everything else.
    this.perceptionCoordinator = new PerceptionCoordinator({
      bus: this.bus,
      diag: this.diag,
      settings: () => this.settings.current,
      memory: this.memory,
      retriever: this.retriever
    });
    this.perceptionCoordinator.onCandidates = (candidates, event) => {
      // §41 #25: several candidates may arrive together — the engine's
      // commit-on-speak gate guarantees at most one actually lands.
      for (const c of candidates) {
        void this.submitSmartCandidate(
          c,
          `${event.kind} significance=${event.significance.toFixed(2)}`
        );
      }
    };

    this.speech = new SpeechQueue(this.bus, this.diag);
    this.live = new GeminiLiveSession(this.secrets, this.bus, this.diag);
    this.nativeVoice = new NativeVoiceSession(this.bus, this.diag);
    this.interruption = new InterruptionController(this.speech, this.bus, this.diag, this.sm);

    this.wireEvents();
  }

  /* ------------------------------ permissions ----------------------------- */
  private permissionState = new Set<string>();
  grantPermission(perm: string): void { this.permissionState.add(perm); }

  /* -------------------------------- wiring -------------------------------- */
  private wireEvents(): void {
    this.unsubs.push(
      this.sm.onTransition(t => {
        this.bus.emit("STATE_CHANGED", { from: t.from, to: t.to, reason: t.reason });
        this.onEvent?.("state");
        this.syncEmotionToState();
      }),
      this.bus.on("USER_SPOKE", () => { this.antiSpam.noteUserEngaged(); this.perception.noteUserInteraction(); }),
      this.bus.on("ZARA_INTERRUPTED", i => {
        // §33: remember WHEN the interruption happened for continuity context.
        this.interruptionTurn = this.turnCounter;
        void i; // metadata already logged by the controller
      }),
      this.bus.on("CONFIRMATION_REQUESTED", () => this.onEvent?.("confirmation")),
      this.bus.on("CONFIRMATION_RESOLVED", () => this.onEvent?.("confirmation")),
      this.bus.on("ERROR", e => this.onEvent?.("error")),
      this.bus.on("REMINDER_TRIGGERED", r => {
        // User-requested reminder → highest-priority proactive path.
        const candidate: ProactiveCandidate = {
          id: "rem_" + r.reminderId,
          source: "reminder",
          draft: `Reminder: ${r.content}`,
          relevance: 1, importance: 1, novelty: 0.8, confidence: 1,
          timeliness: 1, personalContext: 1, annoyanceCost: 0,
          createdAt: Date.now()
        };
        this.lastProactiveCandidate = candidate;
        this.onEvent?.("proactive");
      }),
      /* §30 momentum → typed event: an unacknowledged proactive line is a
       * real occurrence the pipeline should know about (backoff decision). */
      this.antiSpam.onMomentumChange(msg => {
        const m = this.antiSpam.momentumStatus;
        if (m.unacknowledged > 0) {
          this.bus.emit("PROACTIVE_IGNORED", { at: Date.now(), backoffMultiplier: m.multiplier });
        }
        this.diag.log("proactivity", "MOMENTUM", { msg });
      })
    );
    /* V1.1 §3: BATTERY_CHANGED / USER_RETURNED / SCREEN_CONTEXT_CHANGED /
     * CONVERSATION_ENDED / TIME_MILESTONE / ACTION_* now flow through the
     * PerceptionCoordinator pipeline (normalizer → generator → engine). */
  }

  private lastBatteryLevel: number | null = null;

  private syncEmotionToState(): void {
    const s = this.sm.state;
    if (s === "LISTENING") this.emotions.set("listening");
    else if (s === "THINKING" || s === "PLANNING" || s === "VERIFYING") this.emotions.set("thinking");
    else if (s === "SPEAKING") this.emotions.set("speaking");
    else if (s === "SLEEPING") this.emotions.set("sleepy");
    else if (s === "QUIET") this.emotions.set("quiet");
    else if (s === "ERROR") this.emotions.set("error", true);
    else if (s === "IDLE") { if (!["quiet", "sleepy"].includes(this.emotions.emotion)) this.emotions.set("neutral"); }
  }

  /* ------------------------------ lifecycle ------------------------------- */

  async init(): Promise<void> {
    await this.settings.load();
    // §11 privacy toggles take effect before anything else starts.
    this.diag.setEnabled(this.settings.current.diagnosticsEnabled);
    await this.memory.ensureLoaded();
    if (this.settings.current.memoryEnabled) {
      await this.memory.sweepExpired();
    }
    await this.perception.start();

    // §3 V1.1: start the event-driven pipeline (normalizer + generator +
    // milestone ticker + conversation-end detection).
    await this.initScreenAwareness();
    this.perceptionCoordinator.start();

    // §21 V1.1: opt-in foreground keep-alive service.
    await this.applyKeepAlive();

    this.providers.invalidate();
    this.applyProactivitySettings();

    // §34: restore recent conversation continuity (bounded tail, 48 h
    // freshness). Enables the §39 flow — "What were we working on
    // yesterday?" — even after a full process restart.
    const restored = await restoreConversation(this.conversationStorage);
    if (restored.messages.length > 0) {
      this.history = restored.messages.slice(-24);
      this.restoredConversation = this.history.filter((m): m is ChatMessage & { role: "user" | "model" } => m.role === "user" || m.role === "model");
      this.diag.log("memory", "SESSION_RESUMED", {
        messages: this.history.length,
        ageMinutes: Math.round(restored.ageMs / 60000)
      });
      this.bus.emit("SESSION_RESUMED", {
        messages: this.restoredConversation.map(m => ({ role: m.role, text: m.text })),
        ageMs: restored.ageMs
      });
    } else if (restored.expired) {
      this.diag.log("memory", "SESSION_EXPIRED", { ageMs: restored.ageMs });
    }
    // Android device: route ALL speech through the native TTS engine so the
    // queue reflects real utterance lifecycle (§28). Web keeps speechSynthesis.
    if (isVoicePluginAvailable()) {
      const lang = this.settings.current.language === "hi" ? "hi-IN" : "en-IN";
      this.speech.useNativeTts({
        speak: (text, l, id) => nativeTtsSpeak(text, l, id).then(r => r.ok),
        stop: () => { void nativeTtsStop(); }
      }, lang);
    }
    this.diag.log("state", "RUNTIME_READY", {
      provider: this.settings.current.providerId,
      configured: await this.providers.configuredProviders()
    });
    // §20: BOOTING → IDLE — subsystems ready, companion alive.
    this.sm.transition("IDLE", "init complete");
  }

  applyProactivitySettings(): void {
    const s = this.settings.current;
    this.antiSpam.configure({
      cooldownMs: s.proactivityCooldownMin * 60000,
      dailyLimit: s.proactivityDailyLimit
    });
    // §11 toggles re-applied whenever settings change.
    this.diag.setEnabled(s.diagnosticsEnabled);
    // §24: re-evaluate the screen capability when the user flips the toggle.
    void this.refreshScreenCapability();
    void this.applyKeepAlive();
  }

  /** §4/§24: probe REAL platform/permission state and configure the provider. */
  private async refreshScreenCapability(): Promise<void> {
    const s = this.settings.current;
    if (!isPerceptionPluginAvailable()) {
      this.perceptionCoordinator.screen.configure({
        platformSupported: false, permissionGranted: false, userEnabled: s.screenAwareness
      });
      return;
    }
    const probe = await probeScreenCapability();
    this.perceptionCoordinator.screen.configure({
      platformSupported: probe.platformSupported,
      permissionGranted: probe.permissionGranted,
      userEnabled: s.screenAwareness
    });
    // Second privacy gate: native forwarding only when ZARA's toggle is ON.
    await setScreenForwarding(s.screenAwareness);
  }

  /**
   * §4-6 wiring: native accessibility observations → ScreenContextProvider
   * → (permission + settings gated) meaningful-change detector → bus.
   */
  private async initScreenAwareness(): Promise<void> {
    await this.refreshScreenCapability();
    if (!isPerceptionPluginAvailable()) return;
    const unObs = await onScreenObservation(obs => {
      // Hard privacy gate lives INSIDE the provider: if the user's toggle or
      // the OS permission is off, observations are dropped right here.
      this.perceptionCoordinator.screen.observe({
        packageName: obs.packageName,
        appLabel: obs.appLabel,
        className: obs.className,
        text: obs.text,
        at: obs.at
      });
    });
    if (unObs) this.screenUnsubs.push(unObs);
    const unState = await onServiceState(connected => {
      // The user may toggle the accessibility service in Android settings at
      // any time — re-probe so the capability stays honest.
      void this.refreshScreenCapability();
      this.diag.log("perception", "ACCESSIBILITY_SERVICE", { connected });
    });
    if (unState) this.screenUnsubs.push(unState);
  }

  /** §21: start/stop the opt-in foreground service to match settings. */
  private async applyKeepAlive(): Promise<void> {
    if (!isNativeAvailable()) return;
    try {
      const { ZaraActionsLifecycle } = await import("./native/CompanionService");
      await ZaraActionsLifecycle.apply(this.settings.current.keepAliveInBackground);
    } catch { /* honest no-op on web/tests */ }
  }

  private shutDownStarted = false;

  /** §14: explicit runtime teardown. Enters the terminal SHUTTING_DOWN state
   * FIRST (the state machine must reflect real runtime behavior), then stops
   * every subsystem. Idempotent — safe to call from multiple lifecycle hooks. */
  shutdown(): void {
    if (this.shutDownStarted) return;
    this.shutDownStarted = true;
    this.sm.transition("SHUTTING_DOWN", "runtime shutdown");
    this.diag.log("state", "SHUTTING_DOWN", { timestamp: Date.now() });
    this.perception.stop();
    this.perceptionCoordinator.stop();
    for (const u of this.screenUnsubs) { try { u(); } catch { /* noop */ } }
    this.screenUnsubs = [];
    void setScreenForwarding(false);
    this.speech.cancelAll("shutdown");
    void this.live.stop();
    void this.nativeVoice.stop();
    for (const u of this.unsubs) { try { u(); } catch { /* noop */ } }
    if (this.proactiveCheckTimer) clearInterval(this.proactiveCheckTimer);
  }

  /* ------------------------------ modes (§7-8) ---------------------------- */

  get isQuiet(): boolean { return this.quietMode; }

  enterQuietMode(viaVoice = false): void {
    this.quietMode = true;
    this.speech.cancelAll("quiet-mode");
    this.sm.recover("QUIET", viaVoice ? "user said quiet" : "ui");
    this.bus.emit("QUIET_MODE_CHANGED", { active: true, viaVoice });
    this.diag.log("proactivity", "QUIET_MODE_ON", {});
  }

  exitQuietMode(): void {
    this.quietMode = false;
    this.sm.recover("IDLE", "quiet off");
    this.bus.emit("QUIET_MODE_CHANGED", { active: false, viaVoice: false });
    this.speakSystem("I'm back.");
    this.diag.log("proactivity", "QUIET_MODE_OFF", {});
  }

  enterSleep(): void {
    this.speech.cancelAll("sleep");
    this.sm.recover("SLEEPING", "auto/user sleep");
    this.bus.emit("SLEEP_MODE_CHANGED", { active: true, reason: "sleep entered" });
    this.diag.log("state", "SLEEP_MODE_ON", {});
  }

  wake(): void {
    this.sm.recover("IDLE", "wake");
    this.bus.emit("SLEEP_MODE_CHANGED", { active: false, reason: "wake" });
    this.perception.noteUserInteraction();
  }

  /* ---------------------------- main turn (text) --------------------------- */

  /** Text-driven turn (typed input or resolved voice transcript). */
  async handleUserText(text: string): Promise<string> {
    const clean = text.trim();
    if (!clean) return "";

    this.turnCounter++;
    this.interruption.beginTurn();
    this.perception.noteUserInteraction();
    this.bus.emit("USER_SPOKE", { text: clean });

    // Immediate local commands (no LLM round-trip for mode control — §7, §10)
    const local = this.tryLocalCommands(clean);
    if (local.handled) return local.reply;

    // §11 cloud-reasoning toggle: honest typed refusal, never a fake reply.
    if (!this.settings.current.cloudReasoning) {
      this.diag.log("provider", "TURN_REFUSED", { reason: "CLOUD_REASONING_DISABLED" });
      const msg = "Cloud reasoning is switched off in settings, so I can't think right now.";
      this.pushHistory({ role: "user", text: clean }, { role: "model", text: msg });
      this.speakSystem(msg);
      this.onEvent?.("error");
      return msg;
    }

    const token = this.interruption.newToken();
    const memories = this.settings.current.memoryEnabled
      ? this.retriever.retrieve(clean + " " + this.recentTurnText())
      : [];
    const snapshot = this.currentSnapshot();

    const result = await this.agent.runTurn({
      userText: clean,
      history: this.trimmedHistory(),
      memories: memories.map(m => ({ id: m.record.id, text: m.record.content, score: m.score, category: m.record.type })),
      snapshot,
      activeTask: this.activeTask,
      interruptedContext: this.buildInterruptedContext(),
      systemPromptBase: buildSystemPrompt({
        language: this.settings.current.language,
        quietMode: this.quietMode
      })
    }, token);

    this.interruption.clearReasoning();

    if (result.interrupted) {
      this.sm.recover("IDLE", "turn interrupted");
      return "";
    }

    if (result.error) {
      this.sm.recover("ERROR", result.error);
      const userMsg = this.errorToUserMessage(result.error);
      if (userMsg) {
        this.speakSystem(userMsg);
        // Surface the typed failure in the conversation too (§47 — the user
        // must SEE the real reason, not just hear/be met with silence).
        this.pushHistory({ role: "user", text: clean }, { role: "model", text: userMsg });
        this.onEvent?.("error");
        return userMsg;
      }
      this.onEvent?.("error");
      return "";
    }

    // Update conversation history (§34: persist for restart continuity)
    this.pushHistory({ role: "user", text: clean });
    if (result.reply) this.pushHistory({ role: "model", text: result.reply });

    // Speak the reply
    this.emotions.set(emotionFromReply(result.reply));
    if (result.reply) {
      await this.sm.requestTransition("SPEAKING", "reply");
      this.speech.enqueue(
        { text: result.reply, source: "reply" },
        { interruptCurrent: true }
      );
    }
    this.sm.recover("IDLE", "turn complete");

    // Background memory consolidation (never blocks the user)
    if (this.settings.current.memoryEnabled) this.agent.scheduleConsolidation();
    this.onEvent?.("reply");
    return result.reply;
  }

  /** §34: append to the in-memory history AND persist the bounded tail so a
 * restarted runtime resumes with conversation continuity. Never blocks the
 * turn — persistence is fire-and-forget and failure-tolerant. */
  private pushHistory(...msgs: ChatMessage[]): void {
    this.history.push(...msgs);
    if (this.history.length > 24) this.history.splice(0, this.history.length - 24);
    void persistConversation(this.conversationStorage, this.history);
  }

  /** Fast local command handling — deterministic, no LLM. */
  private tryLocalCommands(text: string): { handled: boolean; reply: string } {
    const t = text.toLowerCase().trim();
    const wake = this.settings.current.wakePhrase.toLowerCase();

    // Barge-in / stop (§10)
    if (/^(zara,?\s+)?(stop|stop talking|be quiet|quiet|chup|chup ho jao|shush|silence)\b/.test(t)) {
      this.interruption.interrupt("user said stop/quiet");
      if (/\b(quiet|chup|silence)\b/.test(t) && !/stop talking/.test(t)) {
        this.enterQuietMode(true);
        this.speech.enqueue({ text: "Okay.", source: "system" }, { interruptCurrent: true });
        return { handled: true, reply: "Okay." };
      }
      return { handled: true, reply: "" };
    }
    // Wake word alone → just become attentive
    if (t === wake || t === `${wake}?`) {
      this.sm.recover("IDLE", "wake word");
      return { handled: true, reply: "I'm listening." };
    }
    if (/^(wake up|zara wake up|are you there)/.test(t) && this.sm.state === "SLEEPING") {
      this.wake();
      return { handled: true, reply: "I'm awake." };
    }
    return { handled: false, reply: "" };
  }

  /* --------------------------- live voice mode ---------------------------- */

  /**
   * Voice session selection (FINAL-INTEGRATION §1 — Gemini primary):
   *  - provider "gemini" + Gemini key → Gemini Live (two-way audio WSS)
   *  - anything else (OpenAI-compat, optional GLM…) → native session:
   *    STT → runtime turn (provider reasoning) → TTS (Directive §10 PATH A)
   */
  async startVoiceSession(): Promise<boolean> {
    const s = this.settings.current;
    // §11 voice toggle — honest refusal, no silent no-op.
    if (!s.voiceEnabled) {
      this.diag.log("voice", "VOICE_REFUSED", { reason: "VOICE_DISABLED_IN_SETTINGS" });
      return false;
    }
    if (s.providerId === "gemini" && await this.secrets.has("gemini")) {
      return this.startGeminiLiveSession();
    }
    return this.startNativeVoiceSession();
  }

  get voiceMode(): "gemini-live" | "native" | "none" {
    const s = this.settings.current;
    if (s.providerId === "gemini") return "gemini-live";
    return "native";
  }

  /** Native STT → GLM turn → native TTS, with real barge-in (§11). */
  async startNativeVoiceSession(): Promise<boolean> {
    const s = this.settings.current;
    const ok = await this.nativeVoice.start({
      language: s.language,
      onUserText: text => this.handleUserText(text),
      onBargeIn: () => {
        // §11: user speech while ZARA speaks/thinks → cancel BOTH, for real.
        this.interruption.interrupt("voice barge-in");
      },
      onState: st => {
        if (st === "listening") this.sm.recover("LISTENING", "native voice listening");
        else if (st === "processing") this.sm.recover("THINKING", "native voice processing");
        else if (st === "inactive") this.sm.recover("IDLE", "native voice ended");
        this.onEvent?.("state");
      },
      onPartial: () => this.onEvent?.("transcript"),
      onError: (code, message) => {
        this.diag.log("voice", "NATIVE_SESSION_ERROR", { code, message });
        this.bus.emit("ERROR", { code, message });
        this.onEvent?.("error");
      }
    });
    return ok;
  }

  /** Start a Gemini Live voice session with tool support. */
  private async startGeminiLiveSession(): Promise<boolean> {
    const s = this.settings.current;
    const ok = await this.live.start({
      model: s.liveModel,
      voiceName: s.voiceName,
      systemPrompt: buildSystemPrompt({ language: s.language, quietMode: this.quietMode }),
      language: s.language,
      tools: this.tools.declarations().map(d => ({
        name: d.name,
        description: d.description,
        parameters: d.parameters as unknown as Record<string, unknown>
      })),
      onState: st => {
        if (st === "listening") this.sm.recover("IDLE", "live listening");
        else if (st === "speaking") this.sm.recover("SPEAKING", "live speaking");
        this.onEvent?.("state");
      },
      onUserTranscript: text => {
        this.bus.emit("USER_SPOKE", { text });
        this.antiSpam.noteUserActivity();
        this.onEvent?.("transcript");
      },
      onModelTranscript: () => this.onEvent?.("transcript"),
      onToolCall: async call => {
        // Live tool calls run through the SAME registry + confirmation gates.
        const tool = this.tools.get(call.name);
        if (!tool) {
          this.live.sendToolResponse(call.id, call.name, { ok: false, error: `Unknown tool ${call.name}` });
          return;
        }
        const needsConfirm = tool.risk === "HIGH" || tool.requiresConfirmation;
        let approved = true;
        if (needsConfirm) {
          approved = await this.confirmations.request(call.id, call.name, buildConfirmQ(call.name, call.args));
        }
        if (!approved) {
          this.live.sendToolResponse(call.id, call.name, { ok: false, cancelled: true, error: "User declined." });
          return;
        }
        const result = await this.tools.execute(call.name, call.args, {
          emitActionEvent: (name, payload) => this.bus.emit(name as "ACTION_COMPLETED", payload as never),
          hasPermission: p => this.permissionState.has(p),
          requestPermission: async p => {
            try {
              const { request } = await import("./native/Permissions");
              return await request(p as Parameters<typeof request>[0]);
            } catch { return false; }
          },
          native: this.native,
          now: () => Date.now()
        });
        this.live.sendToolResponse(call.id, call.name, {
          ok: result.ok,
          summary: result.summary,
          ...(result.data ?? {})
        });
      },
      onError: (code, message) => {
        this.diag.log("voice", "LIVE_SESSION_ERROR", { code, message });
        this.bus.emit("ERROR", { code, message });
        this.onEvent?.("error");
      }
    });
    return ok;
  }

  async stopVoiceSession(): Promise<void> {
    await this.nativeVoice.stop();
    await this.live.stop();
    this.sm.recover("IDLE", "voice session end");
  }

  /* ----------------------------- proactivity ------------------------------ */

  /** Submit an observation candidate; the engine decides speak/wait/ignore. */
  submitProactiveCandidate(c: Omit<ProactiveCandidate, "id" | "createdAt">): "SPEAK_NOW" | "WAIT" | "SAVE_FOR_LATER" | "IGNORE" {
    const candidate: ProactiveCandidate = { ...c, id: "pc_" + Math.random().toString(36).slice(2, 9), createdAt: Date.now() };
    const scored = this.proactive.evaluate(candidate, {
      state: this.sm.state,
      quietMode: this.quietMode,
      sleepMode: this.sm.state === "SLEEPING",
      foreground: this.perception.snapshot.foreground,
      userPresent: Date.now() - this.perception.snapshot.lastUserInteraction < 10 * 60000
    });
    if (scored.decision === "SPEAK_NOW") {
      this.speakProactive(scored.candidate.draft);
    }
    this.onEvent?.("proactive");
    return scored.decision;
  }

  /**
   * Phase 2 §39 three-stage submission: deterministic gate → model reasoning
   * (if justified) → policy gate. Async; never throws; used by the proactive
   * loop and perception events.
   */
  private async submitSmartCandidate(
    c: Omit<ProactiveCandidate, "id" | "createdAt">,
    contextLine = ""
  ): Promise<"SPEAK_NOW" | "WAIT" | "SAVE_FOR_LATER" | "IGNORE"> {
    const candidate: ProactiveCandidate = { ...c, id: "pc_" + Math.random().toString(36).slice(2, 9), createdAt: Date.now() };
    const memoryLines = this.retriever.retrieve(candidate.draft).slice(0, 4).map(m => m.record.content);
    const scored = await this.proactive.evaluateWithModel(candidate, {
      state: this.sm.state,
      quietMode: this.quietMode,
      sleepMode: this.sm.state === "SLEEPING",
      foreground: this.perception.snapshot.foreground,
      userPresent: Date.now() - this.perception.snapshot.lastUserInteraction < 10 * 60000
    }, {
      memoryLines,
      contextLine: contextLine || this.perception.describe().join(" · ")
    });
    if (scored.decision === "SPEAK_NOW") {
      this.speakProactive(scored.candidate.draft);
    }
    this.onEvent?.("proactive");
    return scored.decision;
  }

  /** Speak a proactive line (state-gated). Anti-spam counting happens at
   * the ENGINE's decision point — never here (no double counting). */
  private speakProactive(text: string): void {
    if (this.sm.isIn("LISTENING", "THINKING", "PLANNING", "SPEAKING", "WAITING", "INTERRUPTED", "EXECUTING", "VERIFYING")) return;
    this.emotions.set("curious");
    this.sm.recover("SPEAKING", "proactive");
    this.speech.enqueue({ text, source: "proactive" }, { interruptCurrent: false });
    this.sm.recover("IDLE", "proactive done");
  }

  /** Periodic proactivity tick — drains saved candidates + time-based ones. */
  startProactiveLoop(intervalMs = 60000): void {
    if (this.proactiveCheckTimer) clearInterval(this.proactiveCheckTimer);
    this.proactiveCheckTimer = setInterval(() => {
      if (this.quietMode || this.sm.state === "SLEEPING") return;
      const s = this.settings.current;
      if (!s.proactivityEnabled) return;

      // Reminder candidate pending?
      if (this.lastProactiveCandidate) {
        const c = this.lastProactiveCandidate;
        this.lastProactiveCandidate = null;
        this.submitProactiveCandidate(c);
        return;
      }

      // Memory-driven proactivity (§24): high-importance project/goal memories.
      // Phase 2 §39: routed through the 3-stage path (model shapes the line).
      // §11: memory toggle off → no memory-derived candidates.
      const candidates = this.settings.current.memoryEnabled
        ? this.retriever.proactivityCandidates(4)
          .filter(m => m.record.type === "project" || m.record.type === "goal")
          .map(m => ({
            source: "memory_relevance" as const,
            draft: `Back to ${m.record.content.replace(/^The user (is|was)\s*/i, "").slice(0, 60)}?`,
            relevance: 0.6,
            importance: m.record.importance,
            novelty: 0.5,
            confidence: 0.6,
            timeliness: 0.55,
            personalContext: 0.95,
            annoyanceCost: 0.5,
            memoryIds: [m.record.id]
          }))
        : [];
      if (candidates.length) {
        // Async 3-stage submission; no early return — anti-spam + state gates
        // inside the engine guarantee at most one line lands per window.
        void this.submitSmartCandidate(candidates[0]);
      }

      // Saved-for-later candidates
      const saved = this.proactive.drainSaved({
        state: this.sm.state, quietMode: this.quietMode, sleepMode: false,
        foreground: this.perception.snapshot.foreground, userPresent: true
      });
      if (saved.length) {
        this.speakProactive(saved[0].candidate.draft);
      }

      // Auto-sleep (§8)
      const idleMin = s.autoSleepMinutes;
      if (idleMin > 0 && this.sm.state === "IDLE") {
        const idleMs = Date.now() - this.perception.snapshot.lastUserInteraction;
        if (idleMs > idleMin * 60000) this.enterSleep();
      }
    }, intervalMs);
  }

  /* ------------------------------- helpers -------------------------------- */

  private recentTurnText(): string {
    return this.history.slice(-4).map(h => h.text).join(" ");
  }

  /** §33: continuity context for the 2 turns after an interruption. */
  private buildInterruptedContext(): { reason: string; partialText?: string; turnsAgo: number } | null {
    const rec = this.interruption.lastInterruption;
    if (!rec || this.interruptionTurn < 0) return null;
    const turnsAgo = this.turnCounter - this.interruptionTurn;
    if (turnsAgo < 1 || turnsAgo > 2) return null;
    return { reason: rec.reason, partialText: rec.interruptedText, turnsAgo };
  }

  private trimmedHistory(): ChatMessage[] {
    return this.history.slice(-12);
  }

  private currentSnapshot(): ContextSnapshot {
    const p = this.perception.snapshot;
    const screen = this.perceptionCoordinator.screen.current;
    const lastEvent = this.perceptionCoordinator.normalizer.lastEvent;
    return {
      state: this.sm.state,
      quietMode: this.quietMode,
      perception: {
        batteryLevel: p.batteryLevel,
        charging: p.charging,
        online: p.online,
        localTime: new Date().toLocaleString(),
        foreground: p.foreground
      },
      // §29 V1.1: the model context contract gains honest capability +
      // permitted screen context — the model may never assume more.
      screenContext: screen ? {
        app: screen.app,
        screenType: screen.screenType,
        activity: screen.userActivity,
        visibleText: screen.visibleText.slice(0, 80)
      } : null,
      capabilities: this.perceptionCoordinator.capabilities()
        .map(c => `${c.id}=${c.state}`),
      lastPerceptionEvent: lastEvent ? lastEvent.kind : null,
      recentEvents: this.bus.recentEvents.slice(-6).map(e => e.name),
      activeGoal: this.activeTask
    };
  }

  speakSystem(text: string): void {
    if (this.quietMode) return; // quiet mode: system speech also suppressed (§7)
    this.speech.enqueue({ text, source: "system" }, { interruptCurrent: true });
  }

  private errorToUserMessage(code: string): string {
    switch (code) {
      case "LLM_NOT_CONFIGURED": return "I need an API key to think. Open Settings and add your Google Gemini key (recommended), or an OpenAI-compatible or optional GLM key.";
      case "LLM_TIMEOUT": return "That took too long. The connection might be slow — try again.";
      case "NETWORK_ERROR": return "I can't reach the network right now.";
      case "LLM_AUTH_ERROR": return "My API key was rejected. Please check it in settings.";
      case "LLM_RATE_LIMIT": return "I'm being rate limited. Give me a moment and try again.";
      default: return ""; // no vague "something went wrong" (§47)
    }
  }

  setActiveTask(task: string | null): void { this.activeTask = task; }

  /* ------------------------- §37 status snapshot --------------------------- */

  /** Everything the Diagnostics panel needs, gathered in one honest call. */
  statusSnapshot(): RuntimeStatus {
    const s = this.settings.current;
    // Last proactive decision + last tool round from the diagnostics journal.
    const recs = this.diag.all;
    let lastDecision: RuntimeStatus["proactivity"]["lastDecision"] = null;
    let lastAction: RuntimeStatus["lastAction"] = null;
    for (let i = recs.length - 1; i >= 0; i--) {
      const r = recs[i];
      if (!lastDecision && r.category === "proactivity" && r.event === "EVALUATED") {
        const d = r.detail as { source?: string; category?: string; decision?: string; reason?: string };
        lastDecision = {
          source: d.source ?? "?", category: d.category,
          decision: d.decision ?? "?", reason: d.reason ?? "", at: r.at
        };
      }
      if (!lastAction && r.category === "agent" && r.event === "TOOL_ROUND") {
        const d = r.detail as { tool?: string; ok?: boolean; verification?: string };
        lastAction = { tool: d.tool ?? "?", ok: !!d.ok, verification: d.verification ?? "?", at: r.at };
      }
      if (lastDecision && lastAction) break;
    }
    const momentum = this.antiSpam.momentumStatus;
    const screen = this.perceptionCoordinator.screen.current;
    const lastEvent = this.perceptionCoordinator.normalizer.lastEvent;
    return {
      state: this.sm.state,
      lastTransition: this.sm.transitionHistory.length
        ? this.sm.transitionHistory[this.sm.transitionHistory.length - 1]
        : null,
      quiet: this.quietMode,
      sleeping: this.sm.state === "SLEEPING",
      provider: {
        id: s.providerId,
        model: s.providerId === "glm" ? s.glmModel : s.providerId === "gemini" ? s.chatModel : s.openaiModel,
        configured: this.providers.cachedConfigured
      },
      voice: {
        mode: this.voiceMode,
        ttsBackend: isVoicePluginAvailable() ? "native" : "web-speech",
        queueLength: this.speech.queueLength,
        speaking: this.speech.isSpeaking
      },
      memory: {
        enabled: s.memoryEnabled,
        activeCount: this.memory.active().length
      },
      perception: this.perception.describe(),
      capabilities: this.perceptionCoordinator.capabilities().map(c => ({
        id: c.id, label: c.label, state: c.state, detail: c.detail
      })),
      screen: screen ? {
        app: screen.app, screenType: screen.screenType,
        activity: screen.userActivity, at: screen.timestamp
      } : null,
      lastPerceptionEvent: lastEvent
        ? { kind: lastEvent.kind, significance: +lastEvent.significance.toFixed(2), at: lastEvent.at }
        : null,
      wakeWord: "In-session phrase only (\u201czara\u201d while the app is open) — no always-listening wake-word monitor is implemented.",
      proactivity: {
        enabled: s.proactivityEnabled,
        dailyCount: this.antiSpam.proactiveCountToday(),
        dailyLimit: s.proactivityDailyLimit,
        cooldownRemainingMs: this.antiSpam.cooldownRemainingMs(),
        momentum: { unacknowledged: momentum.unacknowledged, multiplier: momentum.multiplier },
        savedCount: this.proactive.savedCount,
        lastDecision
      },
      lastAction,
      lastInterruption: this.interruption.lastInterruption
        ? {
            at: this.interruption.lastInterruption.at,
            reason: this.interruption.lastInterruption.reason,
            phase: this.interruption.lastInterruption.phase
          }
        : null,
      avatar: { ...this.avatarStatus },
      toolsCount: this.tools.size,
      turn: this.interruption.currentTurnId
    };
  }

  /** FINAL-INTEGRATION §34: avatar status — reported by the renderer layer
   * (VRM female character ready / procedural fallback / loading). Honest: the
   * UI layer is the only place that knows which canvas actually rendered. */
  private avatarStatus: RuntimeStatus["avatar"] = { mode: "loading", detail: "loading VRM character…" };

  setAvatarStatus(mode: "vrm" | "procedural" | "loading", detail: string): void {
    this.avatarStatus = { mode, detail };
    this.diag.log("avatar", "AVATAR_STATUS", { mode, detail });
  }
}

function buildConfirmQ(toolName: string, args: Record<string, unknown>): string {
  if (toolName === "prepare_message") return `Send this to ${args.contact}: "${args.message}"?`;
  if (toolName === "call_contact") return `Call ${args.contact}?`;
  return `Go ahead with ${toolName.replace(/_/g, " ")}?`;
}

/** §34: conversation-continuity storage — Capacitor Preferences on device,
 * localStorage on web/tests (same selection rule as the settings store). */
function pickConversationStorage(): KVStorage {
  const g = globalThis as { Capacitor?: { isNativePlatform?: () => boolean } };
  if (g.Capacitor?.isNativePlatform?.()) {
    // Lazy import keeps unit tests free of any Capacitor global.
    return new (class implements KVStorage {
      private prefs: { get(k: string): Promise<{ value: string | null }>; set(k: string, v: string): Promise<void>; remove(k: string): Promise<void> } | null = null;
      private async load() {
        if (this.prefs) return this.prefs;
        try {
          const mod = (await import("@capacitor/preferences")) as unknown as {
            Preferences: { get(k: string): Promise<{ value: string | null }>; set(k: string, v: string): Promise<void>; remove(k: string): Promise<void> };
          };
          this.prefs = mod.Preferences;
        } catch {
          this.prefs = null;
        }
        return this.prefs;
      }
      async get(key: string): Promise<string | null> {
        const p = await this.load();
        if (!p) return localStorage.getItem(key);
        return (await p.get(key)).value;
      }
      async set(key: string, value: string): Promise<void> {
        const p = await this.load();
        if (!p) { localStorage.setItem(key, value); return; }
        await p.set(key, value);
      }
      async remove(key: string): Promise<void> {
        const p = await this.load();
        if (!p) { localStorage.removeItem(key); return; }
        await p.remove(key);
      }
    })();
  }
  return {
    async get(key) { return localStorage.getItem(key); },
    async set(key, value) { localStorage.setItem(key, value); },
    async remove(key) { localStorage.removeItem(key); }
  };
}

/** Process-wide runtime singleton (UI reads this; tests construct their own). */
export const zaraRuntime = new ZaraRuntime();
