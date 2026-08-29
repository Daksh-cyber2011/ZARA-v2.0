import { describe, it, expect, beforeEach } from "vitest";
import { StateMachine } from "../src/core/state/StateMachine";
import { canTransition } from "../src/core/state/states";

describe("StateMachine (§9)", () => {
  let sm: StateMachine;
  beforeEach(() => { sm = new StateMachine("IDLE"); });

  it("allows legal transitions and records history", () => {
    expect(sm.transition("LISTENING", "wake")).toBe(true);
    expect(sm.state).toBe("LISTENING");
    expect(sm.transition("THINKING", "speech end")).toBe(true);
    expect(sm.transition("SPEAKING", "reply ready")).toBe(true);
    expect(sm.transitionHistory.length).toBe(3);
    expect(sm.transitionHistory[0]).toMatchObject({ from: "IDLE", to: "LISTENING" });
  });

  it("REJECTS illegal transitions without mutating state", () => {
    // INTERRUPTED is only reachable from active-turn states, not from IDLE.
    expect(sm.transition("INTERRUPTED", "illegal")).toBe(false);
    expect(sm.state).toBe("IDLE"); // unchanged
    // SLEEPING can only go to IDLE/LISTENING/ERROR
    sm.transition("SLEEPING", "auto");
    expect(sm.transition("THINKING", "from sleeping")).toBe(false);
    expect(sm.state).toBe("SLEEPING");
  });

  it("supports QUIET from active states (user can always demand silence §7)", () => {
    sm.transition("LISTENING", "wake");
    sm.transition("THINKING", "speech");
    sm.transition("SPEAKING", "reply");
    expect(sm.transition("QUIET", "be quiet")).toBe(true);
    // and exits quiet only via IDLE/LISTENING/SLEEPING
    expect(sm.transition("EXECUTING", "illegal from quiet")).toBe(false);
    expect(sm.transition("IDLE", "quiet lift")).toBe(true);
  });

  it("serializes async transitions (no interleaved mutation)", async () => {
    const results = await Promise.all([
      sm.requestTransition("LISTENING", "a"),
      sm.requestTransition("THINKING", "b"),
      sm.requestTransition("SPEAKING", "c")
    ]);
    expect(results.every(Boolean)).toBe(true);
    expect(sm.state).toBe("SPEAKING");
  });

  it("recover() routes through IDLE hub", () => {
    sm.transition("EXECUTING", "tool");
    // EXECUTING -> LISTENING is legal, but suppose we need IDLE from EXECUTING via hub
    expect(sm.recover("LISTENING", "barge-in")).toBe(true);
    expect(sm.state).toBe("LISTENING");
  });

  it("canTransition table is coherent", () => {
    // ERROR must be reachable from everywhere
    for (const from of ["IDLE", "LISTENING", "THINKING", "SPEAKING", "WAITING", "INTERRUPTED", "QUIET", "SLEEPING", "EXECUTING"] as const) {
      expect(canTransition(from, "ERROR")).toBe(true);
    }
    // QUIET reachable from all active-turn states
    for (const from of ["IDLE", "LISTENING", "THINKING", "SPEAKING", "WAITING", "INTERRUPTED", "EXECUTING"] as const) {
      expect(canTransition(from, "QUIET")).toBe(true);
    }
  });
});
