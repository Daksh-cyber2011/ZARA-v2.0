/**
 * ZARA V1.0 — Speech queue (Directive §12).
 *
 * Cancellable utterance queue with cancellation tokens, current-utterance
 * tracking, interruption cleanup. Guarantees: no orphan audio, no duplicate
 * responses. Backends:
 *   - Native Android TTS (ZaraVoice plugin) — Phase 2 primary on device
 *   - Web Speech Synthesis — web preview + fallback
 *   - silent resolve — no TTS engine at all (tests / headless), honest + fast
 *   - raw PCM playback for Gemini Live audio (fed by the live session)
 */
import { EventBus } from "../core/events/EventBus";
import { Diagnostics } from "../core/logging/Diagnostics";
import { nativeTtsSpeak, nativeTtsStop, addTtsListener } from "./NativeVoiceBridge";

export interface Utterance {
  id: string;
  text: string;
  source: "reply" | "proactive" | "confirmation" | "system";
  /** Called when done OR cancelled (completed=false). */
  onDone?: (completed: boolean) => void;
}

export interface SpeakOptions {
  interruptCurrent?: boolean;   // barge ZARA's own speech (default true for user turns)
  rate?: number;
  pitch?: number;
  lang?: string;
}

type SpeechSynth = {
  speak(u: { text: string; lang?: string; rate?: number; pitch?: number; onend: (() => void) | null; onerror: (() => void) | null }): void;
  cancel(): void;
  getVoices(): { lang: string; name: string }[];
  paused: boolean;
  resume(): void;
};

let uttSeq = 0;

export interface NativeTtsBackend {
  speak(text: string, lang: string, utteranceId: string): Promise<boolean>;
  stop(): void;
}

export class SpeechQueue {
  private queue: Utterance[] = [];
  private current: Utterance | null = null;
  private cancelledIds = new Set<string>();
  private synth: SpeechSynth | null = null;
  private enabled = true;
  private nativeTts: NativeTtsBackend | null = null;
  private nativeLang = "en-IN";
  private nativeWaiting = false;

  constructor(private bus: EventBus, private diag: Diagnostics) {
    const g = globalThis as { speechSynthesis?: unknown };
    if (g.speechSynthesis) {
      this.synth = g.speechSynthesis as SpeechSynth;
    }
  }

  /**
   * Route all queued speech through the Android-native TTS engine.
   * Utterance lifecycle events drive finishCurrent — the queue reflects the
   * REAL speaking state (§28: avatar never lies).
   */
  useNativeTts(backend: NativeTtsBackend, lang: string): void {
    this.nativeTts = backend;
    this.nativeLang = lang;
    void addTtsListener(evt => {
      if (!this.current) return;
      if (evt.type === "done" && this.nativeWaiting) {
        this.nativeWaiting = false;
        this.finishCurrent(true);
      } else if (evt.type === "error" && this.nativeWaiting) {
        this.nativeWaiting = false;
        this.finishCurrent(false);
      }
    });
    this.diag.log("voice", "NATIVE_TTS_ATTACHED", { lang });
  }

  setNativeLang(lang: string): void { this.nativeLang = lang; }

  get isSpeaking(): boolean { return this.current !== null; }
  get currentUtterance(): Utterance | null { return this.current; }
  get queueLength(): number { return this.queue.length; }

  /** Voice output available at all (TTS or live audio path). */
  get ttsAvailable(): boolean { return this.nativeTts !== null || this.synth !== null || this.liveAudioActive; }
  private liveAudioActive = false;

  /** Mark the live-voice path active (Gemini Live audio drives speaking state). */
  setLiveAudioActive(active: boolean): void {
    this.liveAudioActive = active;
    if (!active && this.current?.id.startsWith("live_")) this.finishCurrent(false);
  }

  enqueue(u: Omit<Utterance, "id">, opts: SpeakOptions = {}): string {
    if (!this.enabled) {
      u.onDone?.(false);
      return "";
    }
    const id = `utt_${++uttSeq}`;
    const utt: Utterance = { ...u, id };

    if (opts.interruptCurrent !== false && this.current) {
      this.cancelAll("barge-in");
    }

    this.queue.push(utt);
    this.diag.log("voice", "ENQUEUE", { id, source: utt.source, len: utt.text.length, queued: this.queue.length });
    this.pump();
    return id;
  }

  private pump(): void {
    if (this.current || !this.queue.length) return;
    const next = this.queue.shift()!;
    if (this.cancelledIds.has(next.id)) {
      next.onDone?.(false);
      return this.pump();
    }
    this.current = next;
    this.bus.emit("ZARA_STARTED_SPEAKING", { utteranceId: next.id, source: next.source });

    // --- Native Android TTS (Phase 2 primary backend on device) ---
    if (this.nativeTts) {
      this.nativeWaiting = true;
      const myId = next.id;
      let settled = false;
      // Safety net: if the plugin never emits done/error (OEM quirk), resolve
      // after a generous estimate so the queue can never wedge.
      const watchdog = setTimeout(() => {
        if (this.current?.id === myId && this.nativeWaiting) {
          this.nativeWaiting = false;
          this.finishCurrent(true);
        }
      }, Math.min(4000 + next.text.length * 120, 60000));
      this.cancelHooks.push(() => { settled = true; clearTimeout(watchdog); });
      void this.nativeTts.speak(next.text, this.nativeLang, myId).then(ok => {
        if (settled || this.current?.id !== myId) { clearTimeout(watchdog); return; }
        if (!ok) {
          clearTimeout(watchdog);
          this.nativeWaiting = false;
          this.diag.log("voice", "NATIVE_TTS_REJECTED", { id: myId });
          this.finishCurrent(false);
        }
      });
      return;
    }

    if (!this.synth) {
      // No TTS engine (silent env / tests) — resolve immediately, honestly.
      const t = setTimeout(() => {
        this.finishCurrent(true);
      }, Math.min(400 + next.text.length * 30, 6000));
      this.cancelHooks.push(() => clearTimeout(t));
      return;
    }

    try {
      const su: { text: string; lang?: string; rate?: number; pitch?: number; onend: (() => void) | null; onerror: (() => void) | null } = {
        text: next.text,
        onend: () => this.finishCurrent(true),
        onerror: () => this.finishCurrent(false)
      };
      this.synth.speak(su);
    } catch (err) {
      this.diag.log("voice", "TTS_ERROR", { error: String(err) });
      this.finishCurrent(false);
    }
  }

  private cancelHooks: (() => void)[] = [];

  private finishCurrent(completed: boolean): void {
    const cur = this.current;
    if (!cur) return;
    this.current = null;
    for (const h of this.cancelHooks.splice(0)) { try { h(); } catch { /* noop */ } }
    this.bus.emit("ZARA_STOPPED_SPEAKING", { utteranceId: cur.id, completed });
    cur.onDone?.(completed);
    this.pump();
  }

  /**
   * Immediate stop (§10): cancel current + queued speech. Every pending
   * utterance resolves cancelled (no orphan audio, no stacked duplicates).
   */
  cancelAll(reason: string): void {
    const cur = this.current;
    this.cancelledIds = new Set([...this.queue.map(q => q.id), ...(cur ? [cur.id] : [])]);
    if (this.nativeTts) {
      this.nativeWaiting = false;
      void nativeTtsStop();
    }
    try { this.synth?.cancel(); } catch { /* noop */ }
    for (const h of this.cancelHooks.splice(0)) { try { h(); } catch { /* noop */ } }
    if (cur) this.finishCurrent(false);
    for (const q of this.queue.splice(0)) {
      q.onDone?.(false);
    }
    this.cancelledIds.clear();
    this.diag.log("voice", "SPEECH_CANCELLED", { reason });
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.cancelAll("disabled");
  }
}
