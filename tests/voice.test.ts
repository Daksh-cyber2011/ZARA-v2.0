import { describe, it, expect, beforeEach } from "vitest";
import { SpeechQueue } from "../src/voice/SpeechQueue";
import { EventBus } from "../src/core/events/EventBus";
import { Diagnostics } from "../src/core/logging/Diagnostics";
import { InterruptionController } from "../src/voice/interruption/InterruptionController";
import { StateMachine } from "../src/core/state/StateMachine";
import { floatTo16BitPCM, pcm16ToFloats } from "../src/voice/LiveVoice";
import { emotionFromReply, EmotionController } from "../src/avatar/emotion/EmotionController";

describe("SpeechQueue (§12 — cancellable queue)", () => {
  let q: SpeechQueue;
  let bus: EventBus;
  beforeEach(() => {
    bus = new EventBus();
    q = new SpeechQueue(bus, new Diagnostics());
  });

  it("enqueues and completes utterances without a TTS engine (test env)", async () => {
    const done = new Promise<boolean>(res => q.enqueue({ text: "Hello there, this is a test.", source: "system", onDone: res }));
    const completed = await done;
    expect(completed).toBe(true);
  });

  it("emits ZARA_STARTED_SPEAKING / ZARA_STOPPED_SPEAKING", async () => {
    const events: string[] = [];
    bus.on("ZARA_STARTED_SPEAKING", () => events.push("start"));
    bus.on("ZARA_STOPPED_SPEAKING", () => events.push("stop"));
    await new Promise<void>(res => q.enqueue({ text: "Testing event emission for the speech queue.", source: "system", onDone: () => res() }));
    expect(events).toEqual(["start", "stop"]);
  });

  it("cancelAll resolves pending utterances as cancelled (no orphan audio)", async () => {
    const p1 = new Promise<boolean>(res => q.enqueue({ text: "First utterance that is long enough to be queued.", source: "reply", onDone: res }));
    const p2 = new Promise<boolean>(res => q.enqueue({ text: "Second queued utterance also reasonably long.", source: "reply", onDone: res }));
    q.cancelAll("test-barge-in");
    expect(await p1).toBe(false);
    expect(await p2).toBe(false);
  });

  it("barge-in interrupt: a new utterance cancels the current one by default", async () => {
    const first = new Promise<boolean>(res => q.enqueue({ text: "This will be interrupted soon.", source: "reply", onDone: res }));
    q.enqueue({ text: "The interrupting line takes over now.", source: "reply" });
    expect(await first).toBe(false);
  });
});

describe("InterruptionController (§10 — barge-in taxonomy)", () => {
  it("interrupts speech → INTERRUPTED state and cancels the queue", async () => {
    const bus = new EventBus();
    const diag = new Diagnostics();
    const sm = new StateMachine("IDLE");
    const speech = new SpeechQueue(bus, diag);
    const ctrl = new InterruptionController(speech, bus, diag, sm);

    sm.transition("SPEAKING", "test setup");
    const spoke = new Promise<boolean>(res => speech.enqueue({ text: "Long line that will be interrupted mid-flight.", source: "reply", onDone: res }));
    const events: string[] = [];
    bus.on("ZARA_INTERRUPTED", e => events.push(e.phase));

    ctrl.interrupt("user said stop");
    expect(await spoke).toBe(false);
    expect(sm.state).toBe("INTERRUPTED");
    expect(events).toContain("speech");
  });

  it("cancels tracked reasoning tokens on interrupt", () => {
    const bus = new EventBus();
    const diag = new Diagnostics();
    const sm = new StateMachine("IDLE");
    const ctrl = new InterruptionController(new SpeechQueue(bus, diag), bus, diag, sm);
    const token = ctrl.newToken();
    sm.transition("THINKING", "test setup");
    ctrl.interrupt("barge-in");
    expect(token.cancelled).toBe(true);
  });
});

describe("PCM DSP (voice pipeline primitives)", () => {
  it("float→int16→float round-trips within tolerance", () => {
    const input = new Float32Array([0, 0.5, -0.5, 0.99, -0.99, 0.123, -0.777]);
    const pcm = new Uint8Array(floatTo16BitPCM(input));
    const out = pcm16ToFloats(pcm);
    for (let i = 0; i < input.length; i++) {
      expect(Math.abs(out[i] - input[i])).toBeLessThan(0.001);
    }
  });

  it("clamps out-of-range floats", () => {
    const pcm = new Uint8Array(floatTo16BitPCM(new Float32Array([2.0, -2.0])));
    const out = pcm16ToFloats(pcm);
    expect(out[0]).toBeCloseTo(1.0, 2);
    expect(out[1]).toBeCloseTo(-1.0, 2);
  });
});

describe("EmotionController (§31 — no random emotions)", () => {
  it("derives emotion from reply text deterministically", () => {
    expect(emotionFromReply("That's amazing, let's do it!")).toBe("excited");
    expect(emotionFromReply("I couldn't complete that, sorry.")).toBe("sad");
    expect(emotionFromReply("Let me check on that for you.")).toBe("thinking");
    expect(emotionFromReply("")).toBe("neutral");
  });

  it("respects minimum dwell time between changes (no flicker)", () => {
    const ec = new EmotionController();
    ec.set("happy");
    expect(ec.emotion).toBe("happy");
    ec.set("sad"); // within dwell → ignored
    expect(ec.emotion).toBe("happy");
    ec.set("sad", true); // forced
    expect(ec.emotion).toBe("sad");
  });
});
