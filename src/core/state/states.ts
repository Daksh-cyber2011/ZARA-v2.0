/**
 * ZARA V1.0 — Core state definitions (Directive §9).
 *
 * Explicit, deterministic, centrally-owned states. Nothing in ZARA may
 * mutate global state except through the StateMachine.
 */

export type ZaraState =
  | "BOOTING"       // runtime initializing — subsystems not yet ready
  | "IDLE"          // alive, aware, not listening — quiet presence
  | "LISTENING"     // mic active, capturing user speech
  | "THINKING"      // LLM reasoning in progress
  | "PLANNING"      // model produced a plan/tool calls — selecting tools (§20)
  | "SPEAKING"      // TTS / live voice output active
  | "WAITING"       // awaiting user confirmation (high-risk action gate)
  | "INTERRUPTED"   // user barged in; cleanup in progress
  | "QUIET"         // proactive speech suppressed by user request
  | "SLEEPING"      // low-activity mode, minimal processing
  | "EXECUTING"     // tool/action in progress
  | "VERIFYING"     // verifying action outcome before reporting (§20)
  | "SHUTTING_DOWN" // runtime tearing down — terminal (§14: 14th state)
  | "ERROR";        // explicit failure state (recoverable)

export interface StateTransition {
  from: ZaraState;
  to: ZaraState;
  reason: string;
  at: number; // epoch ms
}

/**
 * The legal transition table. Any transition not listed here is rejected.
 * QUIET is intentionally reachable from most states (user can say "be quiet"
 * at any time) and intentionally exits back to IDLE only.
 * SHUTTING_DOWN is reachable from EVERY state (§14: shutdown may begin at any
 * point in the lifecycle) and is TERMINAL — the runtime never leaves it.
 */
export const VALID_TRANSITIONS: Readonly<Record<ZaraState, readonly ZaraState[]>> = {
  BOOTING:     ["IDLE", "ERROR", "SHUTTING_DOWN"],
  IDLE:        ["LISTENING", "THINKING", "SPEAKING", "SLEEPING", "QUIET", "EXECUTING", "ERROR", "SHUTTING_DOWN"],
  LISTENING:   ["THINKING", "IDLE", "INTERRUPTED", "QUIET", "SLEEPING", "ERROR", "SHUTTING_DOWN"],
  THINKING:    ["PLANNING", "SPEAKING", "EXECUTING", "WAITING", "IDLE", "INTERRUPTED", "QUIET", "ERROR", "SHUTTING_DOWN"],
  PLANNING:    ["EXECUTING", "WAITING", "VERIFYING", "THINKING", "SPEAKING", "IDLE", "INTERRUPTED", "QUIET", "ERROR", "SHUTTING_DOWN"],
  SPEAKING:    ["LISTENING", "IDLE", "INTERRUPTED", "THINKING", "QUIET", "ERROR", "SHUTTING_DOWN"],
  WAITING:     ["EXECUTING", "THINKING", "PLANNING", "IDLE", "LISTENING", "QUIET", "ERROR", "SHUTTING_DOWN"],
  INTERRUPTED: ["LISTENING", "THINKING", "IDLE", "SPEAKING", "QUIET", "ERROR", "SHUTTING_DOWN"],
  QUIET:       ["IDLE", "LISTENING", "SLEEPING", "ERROR", "SHUTTING_DOWN"],
  SLEEPING:    ["IDLE", "LISTENING", "ERROR", "SHUTTING_DOWN"],
  EXECUTING:   ["VERIFYING", "THINKING", "SPEAKING", "IDLE", "WAITING", "INTERRUPTED", "QUIET", "ERROR", "SHUTTING_DOWN"],
  VERIFYING:   ["THINKING", "PLANNING", "SPEAKING", "WAITING", "IDLE", "INTERRUPTED", "QUIET", "ERROR", "SHUTTING_DOWN"],
  ERROR:       ["IDLE", "LISTENING", "SLEEPING", "QUIET", "SHUTTING_DOWN"],
  SHUTTING_DOWN: [] // terminal — no legal exit (§14)
};

/** States in which proactive speech is forbidden outright. */
export const NON_INTERRUPTIBLE_BY_SYSTEM: readonly ZaraState[] = [
  "LISTENING", "THINKING", "PLANNING", "SPEAKING", "WAITING", "INTERRUPTED", "EXECUTING", "VERIFYING"
];

/** §14: SHUTTING_DOWN is terminal — once entered, the runtime is going down. */
export function isTerminal(state: ZaraState): boolean {
  return VALID_TRANSITIONS[state].length === 0;
}

/** States that represent "user is actively engaged in a turn". */
export const ACTIVE_TURN_STATES: readonly ZaraState[] = [
  "LISTENING", "THINKING", "PLANNING", "SPEAKING", "WAITING", "EXECUTING", "VERIFYING", "INTERRUPTED"
];

export function canTransition(from: ZaraState, to: ZaraState): boolean {
  if (from === to) return true; // idempotent re-entry allowed (no-op)
  return VALID_TRANSITIONS[from].includes(to);
}
