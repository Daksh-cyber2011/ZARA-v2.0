/**
 * ZARA V1.0 Phase 2 — Native voice session tests (Directive §10, §11, §34).
 *
 * Covers: language detection (EN/HI/Hinglish), the STT→turn→TTS loop with a
 * mocked plugin transport, real barge-in (speech during a turn cancels it),
 * permission-denial handling, and lifecycle recreation (stop → start again).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NativeVoiceSession, detectSpeechLang } from "../src/voice/NativeVoice";
import { EventBus } from "../src/core/events/EventBus";
import { Diagnostics } from "../src/core/logging/Diagnostics";

/* ----------------------------- fake transport ------------------------------ */

type SttHandler = (e: { type: "partial" | "final" | "error"; text?: string; code?: string; message?: string }) => void;

let sttHandlers: SttHandler[] = [];
let sttStartCalls: string[] = [];
let sttStopCalls = 0;
let voiceAvailable = false;

vi.mock("../src/voice/NativeVoiceBridge", async importOriginal => {
  const actual = await importOriginal<typeof import("../src/voice/NativeVoiceBridge")>();
  return {
    ...actual,
    isVoicePluginAvailable: () => voiceAvailable,
    nativeSttStart: vi.fn(async (lang: string) => {
      sttStartCalls.push(lang);
      return { ok: true };
    }),
    nativeSttStop: vi.fn(async () => {
      sttStopCalls++;
      return { ok: true };
    }),
    nativeTtsSpeak: vi.fn(async () => ({ ok: true, summary: "Speaking." })),
    nativeTtsStop: vi.fn(async () => ({ ok: true })),
    nativeVoiceCapabilities: vi.fn(async () => ({ ttsReady: true, sttAvailable: true, sttListening: false })),
    addSttListener: vi.fn(async (cb: SttHandler) => {
      sttHandlers.push(cb);
      return { remove: async () => {} } as never;
    }),
    addTtsListener: vi.fn(async () => ({ remove: async () => {} } as never))
  };
});

function emitStt(e: Parameters<SttHandler>[0]) {
  for (const h of [...sttHandlers]) h(e);
}

function makeSession() {
  return new NativeVoiceSession(new EventBus(), new Diagnostics());
}

beforeEach(() => {
  sttHandlers = [];
  sttStartCalls = [];
  sttStopCalls = 0;
  voiceAvailable = true;
});

/* ------------------------------- language ---------------------------------- */

describe("detectSpeechLang (§10 language detection)", () => {
  it("Devanagari input → hi-IN", () => {
    expect(detectSpeechLang("मुझे कल सुबह याद दिलाना")).toBe("hi-IN");
  });
  it("Romanized Hinglish markers → hi-IN", () => {
    expect(detectSpeechLang("mujhe kal subah 7 baje yaad karna")).toBe("hi-IN");
    expect(detectSpeechLang("kya haal hai")).toBe("hi-IN");
  });
  it("plain English → en-IN", () => {
    expect(detectSpeechLang("remind me to study tomorrow")).toBe("en-IN");
    expect(detectSpeechLang("what is the weather like")).toBe("en-IN");
  });
  it("mixed but mostly English → en-IN", () => {
    expect(detectSpeechLang("hey can you search youtube for lofi beats please")).toBe("en-IN");
  });
});

/* -------------------------------- session ---------------------------------- */

describe("NativeVoiceSession (§10 PATH A / §11 barge-in / §34)", () => {
  it("starts listening through the native plugin", async () => {
    const s = makeSession();
    const states: string[] = [];
    const ok = await s.start({
      language: "auto",
      onUserText: async () => "ok",
      onBargeIn: () => {},
      onState: st => states.push(st),
      onError: () => {}
    });
    expect(ok).toBe(true);
    expect(sttStartCalls).toContain("en-IN");
    expect(states).toContain("listening");
    await s.stop();
  });

  it("final STT result → barge-in hook + runtime turn (PATH A)", async () => {
    const s = makeSession();
    const bargeIn = vi.fn();
    const turns: string[] = [];
    await s.start({
      language: "auto",
      onUserText: async t => {
        turns.push(t);
        return "reply";
      },
      onBargeIn: bargeIn,
      onState: () => {},
      onError: () => {}
    });
    emitStt({ type: "final", text: "open youtube" });
    await new Promise(r => setTimeout(r, 20));
    expect(bargeIn).toHaveBeenCalled(); // §11: cancellation before the new turn
    expect(turns).toEqual(["open youtube"]);
    await s.stop();
  });

  it("partial results stream but do not trigger turns", async () => {
    const s = makeSession();
    const onUserText = vi.fn(async () => "reply");
    const partials: string[] = [];
    await s.start({
      language: "auto",
      onUserText,
      onBargeIn: () => {},
      onState: () => {},
      onPartial: t => partials.push(t),
      onError: () => {}
    });
    emitStt({ type: "partial", text: "open…" });
    await new Promise(r => setTimeout(r, 20));
    expect(partials).toEqual(["open…"]);
    expect(onUserText).not.toHaveBeenCalled();
    await s.stop();
  });

  it("STT_PERMISSION error → surfaced honestly, session ends (§34 scenario 25)", async () => {
    const s = makeSession();
    const errors: string[] = [];
    const states: string[] = [];
    await s.start({
      language: "auto",
      onUserText: async () => "",
      onBargeIn: () => {},
      onState: st => states.push(st),
      onError: (code, msg) => errors.push(code + ":" + msg)
    });
    emitStt({ type: "error", code: "STT_PERMISSION", message: "mic denied" });
    await new Promise(r => setTimeout(r, 10));
    expect(errors[0]).toContain("STT_PERMISSION");
    expect(states).toContain("error");
    await s.stop();
  });

  it("switches recognizer language after Hindi speech (§10 — no hardcoding)", async () => {
    const s = makeSession();
    await s.start({
      language: "auto",
      onUserText: async () => "",
      onBargeIn: () => {},
      onState: () => {},
      onError: () => {}
    });
    emitStt({ type: "final", text: "मुझे कल याद दिलाना" });
    await new Promise(r => setTimeout(r, 30));
    expect(sttStartCalls).toContain("hi-IN"); // restarted in Hindi
    await s.stop();
  });

  it("lifecycle recreation: stop → start works again (§34 scenario 23)", async () => {
    const s = makeSession();
    const ok1 = await s.start({ language: "auto", onUserText: async () => "", onBargeIn: () => {}, onState: () => {}, onError: () => {} });
    expect(ok1).toBe(true);
    await s.stop();
    expect(sttStopCalls).toBeGreaterThan(0);
    // Re-create on the same object — session must come back cleanly.
    const ok2 = await s.start({ language: "auto", onUserText: async () => "", onBargeIn: () => {}, onState: () => {}, onError: () => {} });
    expect(ok2).toBe(true);
    expect(s.state).toBe("listening");
    await s.stop();
  });

  it("reports honest unavailability when no STT exists anywhere (§32)", async () => {
    voiceAvailable = false; // no native plugin
    const g = globalThis as Record<string, unknown>;
    const hadWeb = g.SpeechRecognition ?? g.webkitSpeechRecognition;
    delete g.SpeechRecognition;
    delete g.webkitSpeechRecognition;
    const s = makeSession();
    const errors: string[] = [];
    const ok = await s.start({
      language: "auto",
      onUserText: async () => "",
      onBargeIn: () => {},
      onState: () => {},
      onError: (code) => errors.push(code)
    });
    expect(ok).toBe(false);
    expect(errors).toContain("VOICE_UNAVAILABLE");
    if (hadWeb) g.SpeechRecognition = hadWeb;
  });
});
