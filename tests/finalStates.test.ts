/**
 * ZARA V1.0 FINAL — §20 state machine completeness tests.
 *
 * The directive requires ≥14 states including BOOTING, PLANNING and VERIFYING.
 * These tests pin the full legal-turn walk and the new-state rejections.
 */
import { describe, it, expect } from "vitest";
import { StateMachine } from "../src/core/state/StateMachine";
import {
  VALID_TRANSITIONS, ACTIVE_TURN_STATES, NON_INTERRUPTIBLE_BY_SYSTEM,
  isTerminal, type ZaraState
} from "../src/core/state/states";

describe("§20 state machine — 14 required states", () => {
  it("contains all 14 directive states", () => {
    const required = [
      "BOOTING", "IDLE", "LISTENING", "THINKING", "PLANNING", "AWAITING_CONFIRMATION",
      "SPEAKING", "WAITING", "INTERRUPTED", "QUIET", "SLEEPING", "EXECUTING",
      "VERIFYING", "ERROR", "SHUTTING_DOWN"
    ];
    // WAITING plays the AWAITING_CONFIRMATION role (existing architecture, §55).
    const have = new Set(Object.keys(VALID_TRANSITIONS));
    for (const s of required) {
      expect(have.has(s) || s === "AWAITING_CONFIRMATION" && have.has("WAITING")).toBe(true);
    }
    expect(Object.keys(VALID_TRANSITIONS).length).toBeGreaterThanOrEqual(14);
  });

  it("boots: BOOTING → IDLE is legal; BOOTING → SPEAKING is rejected", () => {
    const sm = new StateMachine("BOOTING");
    expect(sm.state).toBe("BOOTING");
    expect(sm.transition("IDLE", "init complete")).toBe(true);
    expect(sm.state).toBe("IDLE");

    const sm2 = new StateMachine("BOOTING");
    expect(sm2.transition("SPEAKING", "premature")).toBe(false);
    expect(sm2.state).toBe("BOOTING");
  });

  it("BOOTING can only reach IDLE, ERROR or SHUTTING_DOWN", () => {
    expect(VALID_TRANSITIONS.BOOTING).toEqual(["IDLE", "ERROR", "SHUTTING_DOWN"]);
  });

  it("agent turn walk: THINKING → PLANNING → EXECUTING → VERIFYING → THINKING", () => {
    const sm = new StateMachine("IDLE");
    expect(sm.transition("THINKING", "turn")).toBe(true);
    expect(sm.transition("PLANNING", "plan:open_app")).toBe(true);
    expect(sm.transition("EXECUTING", "tool:open_app")).toBe(true);
    expect(sm.transition("VERIFYING", "verify:open_app")).toBe(true);
    expect(sm.transition("THINKING", "tool-round-done")).toBe(true);
    expect(sm.transition("SPEAKING", "reply")).toBe(true);
    expect(sm.state).toBe("SPEAKING");
  });

  it("confirmation path may route WAITING → PLANNING (re-plan after approval)", () => {
    const sm = new StateMachine("IDLE");
    sm.transition("THINKING", "t");
    sm.transition("PLANNING", "plan");
    sm.transition("WAITING", "confirm");
    expect(sm.transition("PLANNING", "re-plan")).toBe(true);
    expect(sm.transition("EXECUTING", "approved")).toBe(true);
  });

  it("PLANNING and VERIFYING are active-turn states (proactivity gated)", () => {
    expect(ACTIVE_TURN_STATES).toContain("PLANNING");
    expect(ACTIVE_TURN_STATES).toContain("VERIFYING");
    expect(NON_INTERRUPTIBLE_BY_SYSTEM).toContain("PLANNING");
    expect(NON_INTERRUPTIBLE_BY_SYSTEM).toContain("VERIFYING");
  });

  it("illegal exits from the new states are rejected", () => {
    const sm = new StateMachine("BOOTING");
    expect(sm.transition("PLANNING", "hack")).toBe(false); // BOOTING→PLANNING illegal

    const sm2 = new StateMachine("IDLE");
    sm2.transition("THINKING", "t");
    sm2.transition("PLANNING", "plan");
    expect(sm2.transition("LISTENING", "hack")).toBe(false); // PLANNING→LISTENING illegal
    expect(sm2.state).toBe("PLANNING");

    sm2.transition("EXECUTING", "exec");
    sm2.transition("VERIFYING", "verify");
    expect(sm2.transition("SLEEPING", "hack")).toBe(false); // VERIFYING→SLEEPING illegal
    expect(sm2.state).toBe("VERIFYING");
  });

  it("VERIFYING is reachable from EXECUTING and exits to SPEAKING", () => {
    const sm = new StateMachine("IDLE");
    sm.transition("EXECUTING", "tool");
    expect(sm.transition("VERIFYING", "verify")).toBe(true);
    expect(sm.transition("SPEAKING", "report result")).toBe(true);
  });
});

describe("§14 SHUTTING_DOWN — the 14th state", () => {
  it("is reachable from EVERY state (shutdown may begin anywhere)", () => {
    for (const from of Object.keys(VALID_TRANSITIONS) as ZaraState[]) {
      const sm = new StateMachine(from);
      expect(sm.transition("SHUTTING_DOWN", `shutdown from ${from}`)).toBe(true);
      expect(sm.state).toBe("SHUTTING_DOWN");
    }
  });

  it("is TERMINAL — no legal exit, isTerminal() reports it", () => {
    expect(VALID_TRANSITIONS.SHUTTING_DOWN).toEqual([]);
    expect(isTerminal("SHUTTING_DOWN")).toBe(true);
    expect(isTerminal("IDLE")).toBe(false);
    const sm = new StateMachine("SHUTTING_DOWN");
    for (const to of ["IDLE", "ERROR", "BOOTING", "LISTENING"] as ZaraState[]) {
      expect(sm.transition(to, "illegal revive")).toBe(false);
    }
    expect(sm.state).toBe("SHUTTING_DOWN");
  });

  it("mid-turn shutdown: SPEAKING → SHUTTING_DOWN directly (no forced hop)", () => {
    const sm = new StateMachine("IDLE");
    sm.transition("THINKING", "turn");
    sm.transition("SPEAKING", "reply");
    expect(sm.transition("SHUTTING_DOWN", "app closed while speaking")).toBe(true);
  });
});
