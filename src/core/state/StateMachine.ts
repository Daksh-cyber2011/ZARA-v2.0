/**
 * ZARA V1.0 — Deterministic, race-condition-resistant StateMachine (§9).
 *
 * - All transitions pass through `transition()`; illegal transitions are
 *   rejected and logged, never silently applied.
 * - Async actors (voice callbacks, tool completions, UI) must go through
 *   `requestTransition`, which serializes via a micro-queue so no two
 *   callbacks can interleave a read-modify-write.
 * - Every transition is observable (subscribers) and recorded (history)
 *   for the Diagnostics panel (§46).
 */
import { ZaraState, StateTransition, canTransition } from "./states";

type Listener = (t: StateTransition) => void;

export class StateMachine {
  private _state: ZaraState;
  private readonly history: StateTransition[] = [];
  private readonly listeners = new Set<Listener>();
  private chain: Promise<unknown> = Promise.resolve(); // serialization queue

  constructor(initial: ZaraState = "IDLE") {
    this._state = initial;
  }

  get state(): ZaraState {
    return this._state;
  }

  get transitionHistory(): readonly StateTransition[] {
    return this.history;
  }

  onTransition(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  /** Synchronous guarded transition. Returns false if rejected. */
  transition(to: ZaraState, reason: string): boolean {
    const from = this._state;
    if (!canTransition(from, to)) {
      // Illegal transitions are recorded but NOT applied — deterministic.
      console.warn(`[StateMachine] REJECTED ${from} -> ${to} (${reason})`);
      return false;
    }
    if (from === to) return true; // no-op
    const t: StateTransition = { from, to, reason, at: Date.now() };
    this._state = to;
    this.history.push(t);
    if (this.history.length > 200) this.history.shift();
    for (const l of this.listeners) {
      try { l(t); } catch (e) { console.error("[StateMachine] listener error", e); }
    }
    return true;
  }

  /**
   * Serialized async transition. All async subsystems (voice, tools, timers)
   * must use this so state can never be torn by interleaved callbacks.
   */
  requestTransition(to: ZaraState, reason: string): Promise<boolean> {
    this.chain = this.chain.then(() => this.transition(to, reason));
    return this.chain as Promise<boolean>;
  }

  /**
   * Force-recovery path: used ONLY by the interruption controller and error
   * recovery, where we must reach a target state even through an
   * intermediate. Each hop is still validated; illegal hops are skipped.
   */
  recover(to: ZaraState, reason: string): boolean {
    if (this._state === to) return true;
    if (canTransition(this._state, to)) return this.transition(to, reason);
    // Route through IDLE as the universal hub.
    if (canTransition(this._state, "IDLE")) {
      this.transition("IDLE", `recover-hub: ${reason}`);
      return this.transition(to, reason);
    }
    return false;
  }

  /** Test helper — inspect without touching internals. */
  isIn(...states: ZaraState[]): boolean {
    return states.includes(this._state);
  }
}
