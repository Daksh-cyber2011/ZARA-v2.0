/**
 * ZARA V1.0 Phase 2 — Native voice session (Directive §10, §11, PATH A).
 *
 * The GLM voice pipeline on Android:
 *
 *   MIC → SpeechRecognizer (STT, hi/en/Hinglish)
 *       → language detection + normalization
 *       → [runtime turn: GLM 5.2 reasoning + tools]
 *       → reply → SpeechQueue (native TTS) → speaker
 *
 * Barge-in (§11) is REAL: recognition keeps running while ZARA speaks; a
 * final STT result during speech stops TTS, cancels the in-flight reasoning
 * token, and processes the new input. Nothing resumes afterwards.
 *
 * The session NEVER reasons itself — it delegates every turn to the runtime
 * (single companion loop, §4). Web preview falls back to the Web Speech API
 * where available; otherwise it reports honestly that voice is unavailable.
 */
import { EventBus } from "../core/events/EventBus";
import { Diagnostics } from "../core/logging/Diagnostics";
import {
  isVoicePluginAvailable, nativeSttStart, nativeSttStop, addSttListener,
  nativeTtsSpeak, nativeTtsStop, nativeVoiceCapabilities
} from "./NativeVoiceBridge";

export type NativeVoiceState = "inactive" | "listening" | "processing" | "error";

export interface NativeVoiceOptions {
  language: "auto" | "en" | "hi";
  /** Runtime turn handler (text in → reply out). */
  onUserText(text: string): Promise<string>;
  /** Barge-in hook: stop current speech + cancel in-flight reasoning. */
  onBargeIn(): void;
  onState(state: NativeVoiceState): void;
  onPartial?(text: string): void;
  onError(code: string, message: string): void;
}

/* --------------------------- language detection ---------------------------- */

const HINDI_MARKERS = [
  "kya", "hai", "mujhe", "karo", "kar", "baje", "nahi", "haan", "aap", "tum",
  "kal", "aaj", "batao", "bata", "kaise", "kaisa", "kaam", "yaad", "rakho",
  "dena", "de", "kholo", "khol", "chal", "shuru", "band", "banao", "jaldi",
  "thoda", "bahut", "acha", "theek", "matlab", "kuch", "koi", "mera", "meri",
  "tera", "aapka", "kyun", "kyu", "kab", "kahan", "kaun", "subah", "shaam",
  "raat", "dopahar", "ghanta", "ghante", "minute", "baad", "pehle", "abhi"
];

/** Devanagari ratio + Hindi word markers → recognizer language hint. */
export function detectSpeechLang(text: string): "hi-IN" | "en-IN" {
  const t = text.trim();
  if (!t) return "en-IN";
  // Devanagari script → definitely Hindi
  const devanagari = (t.match(/[\u0900-\u097F]/g) ?? []).length;
  if (devanagari / t.length > 0.2) return "hi-IN";
  // Romanized Hindi/Hinglish markers
  const words = t.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = words.filter(w => HINDI_MARKERS.includes(w.replace(/[^a-z]/g, ""))).length;
  return hits / Math.max(words.length, 1) > 0.2 ? "hi-IN" : "en-IN";
}

/* ------------------------------- the session -------------------------------- */

type WebSpeechRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  onresult: ((e: { resultIndex: number; results: { isFinal: boolean; 0: { transcript: string } }[] }) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

export class NativeVoiceSession {
  private _state: NativeVoiceState = "inactive";
  private opts!: NativeVoiceOptions;
  private sttLang = "en-IN";
  private active = false;
  private processing = false;
  private lastFinalAt = 0;
  private webRec: WebSpeechRecognition | null = null;
  private webRecRestart: ReturnType<typeof setTimeout> | null = null;

  constructor(private bus: EventBus, private diag: Diagnostics) {}

  get state(): NativeVoiceState { return this._state; }

  private setState(s: NativeVoiceState): void {
    if (this._state === s) return;
    this._state = s;
    this.opts?.onState(s);
  }

  async start(opts: NativeVoiceOptions): Promise<boolean> {
    this.opts = opts;
    this.active = true;
    this.processing = false;
    this.sttLang = opts.language === "hi" ? "hi-IN" : "en-IN";

    if (isVoicePluginAvailable()) {
      const caps = await nativeVoiceCapabilities();
      if (!caps?.sttAvailable) {
        opts.onError("STT_UNAVAILABLE", "No speech recognition service is available on this device.");
        this.setState("error");
        return false;
      }
      const listener = await addSttListener(evt => this.handleSttEvent(evt));
      if (!listener) {
        opts.onError("STT_UNAVAILABLE", "Could not attach to the speech recognizer.");
        this.setState("error");
        return false;
      }
      const r = await nativeSttStart(this.sttLang);
      if (!r.ok) {
        opts.onError("STT_START_FAILED", r.error ?? "Speech recognition failed to start.");
        this.setState("error");
        return false;
      }
      this.setState("listening");
      this.diag.log("voice", "NATIVE_SESSION_STARTED", { lang: this.sttLang, tts: caps.ttsReady });
      return true;
    }

    // ---- Web preview fallback: Web Speech API (recognition), if present ----
    const g = globalThis as { SpeechRecognition?: new () => WebSpeechRecognition; webkitSpeechRecognition?: new () => WebSpeechRecognition };
    const Rec = g.SpeechRecognition ?? g.webkitSpeechRecognition;
    if (Rec) {
      this.webRec = new Rec();
      this.webRec.lang = this.sttLang;
      this.webRec.continuous = true;
      this.webRec.interimResults = true;
      this.webRec.maxAlternatives = 1;
      this.webRec.onresult = e => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          const text = res[0]?.transcript?.trim() ?? "";
          if (!text) continue;
          if (res.isFinal) this.onFinal(text);
          else opts.onPartial?.(text);
        }
      };
      this.webRec.onerror = e => {
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
          this.diag.log("voice", "WEB_STT_PERMISSION", {});
          opts.onError("STT_PERMISSION", "Microphone permission was denied.");
          this.setState("error");
          this.active = false;
        }
      };
      this.webRec.onend = () => {
        // Chrome stops the recognizer periodically — restart while active.
        if (this.active && this.webRec) {
          this.webRecRestart = setTimeout(() => {
            try { this.active && this.webRec?.start(); } catch { /* already started */ }
          }, 250);
        }
      };
      try {
        this.webRec.start();
        this.setState("listening");
        this.diag.log("voice", "WEB_SESSION_STARTED", { lang: this.sttLang });
        return true;
      } catch (e) {
        opts.onError("STT_START_FAILED", e instanceof Error ? e.message : String(e));
        this.setState("error");
        return false;
      }
    }

    opts.onError(
      "VOICE_UNAVAILABLE",
      "Voice input is not available here. On the Android app, ZARA uses the on-device speech recognizer; in a desktop browser she needs the Web Speech API."
    );
    this.setState("error");
    return false;
  }

  async stop(): Promise<void> {
    this.active = false;
    if (this.webRecRestart) clearTimeout(this.webRecRestart);
    try { this.webRec?.stop(); } catch { /* noop */ }
    this.webRec = null;
    await nativeSttStop();
    await nativeTtsStop();
    this.setState("inactive");
    this.diag.log("voice", "NATIVE_SESSION_STOPPED", {});
  }

  /* ------------------------------ STT events -------------------------------- */

  private handleSttEvent(evt: { type: "partial" | "final" | "error"; text?: string; code?: string; message?: string }): void {
    if (!this.active) return;
    if (evt.type === "error") {
      if (evt.code === "STT_PERMISSION") {
        this.opts.onError("STT_PERMISSION", evt.message ?? "Microphone permission denied.");
        this.setState("error");
        this.active = false;
        return;
      }
      // Transient recognizer errors are logged; the native side auto-restarts.
      this.diag.log("voice", "STT_ERROR", { code: evt.code ?? "unknown", message: evt.message ?? "" });
      return;
    }
    if (evt.type === "partial") {
      this.opts.onPartial?.(evt.text ?? "");
      return;
    }
    // final
    const text = (evt.text ?? "").trim();
    if (!text) return;
    this.onFinal(text);
  }

  private async onFinal(text: string): Promise<void> {
    if (!this.active) return;
    // Debounce: native auto-restart can re-emit the same final result.
    const now = Date.now();
    if (now - this.lastFinalAt < 700 && this.processing) return;
    this.lastFinalAt = now;

    // Adapt recognizer language to what the user actually spoke (§10 language
    // detection — never hardcode one language).
    const detected = detectSpeechLang(text);
    if (detected !== this.sttLang) {
      this.sttLang = detected;
      if (isVoicePluginAvailable()) {
        void nativeSttStop().then(() => { if (this.active) void nativeSttStart(detected); });
      } else if (this.webRec) {
        this.webRec.lang = detected;
      }
      this.diag.log("voice", "STT_LANG_SWITCH", { lang: detected });
    }

    // Barge-in (§11): speech arrived while ZARA was talking or thinking →
    // cancel speech AND the in-flight reasoning, then process the new input.
    this.opts.onBargeIn();

    this.bus.emit("USER_SPOKE", { text });
    this.setState("processing");
    this.processing = true;
    try {
      // The runtime turn speaks the reply itself through the SpeechQueue
      // (native TTS). We just await completion of the turn.
      await this.opts.onUserText(text);
    } catch (err) {
      this.diag.log("voice", "VOICE_TURN_FAILED", { error: String(err) });
    } finally {
      this.processing = false;
      if (this.active) this.setState("listening");
    }
  }
}
