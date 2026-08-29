/**
 * ZARA V1.0 — Voice session: Gemini Live client-direct pipeline (§11-12).
 *
 * MIC (16 kHz PCM) → WSS → Gemini Live → AUDIO OUT (24 kHz PCM via Web Audio)
 *
 * Reuses MYRAA's proven DSP math (float→int16 LE, gapless double-buffer
 * scheduling, immediate interrupt stop) inside a provider-isolated session.
 * Barge-in: user speech audio flows upstream WHILE ZARA speaks; Gemini Live
 * handles endpointing; on user-turn we cancel local playback instantly.
 */
import { GoogleGenAI, Modality, LiveServerMessage } from "@google/genai";
import { SecretStore } from "../core/configuration/Settings";
import { EventBus } from "../core/events/EventBus";
import { Diagnostics } from "../core/logging/Diagnostics";

/* ------------------------------ PCM helpers ------------------------------- */

export function floatTo16BitPCM(input: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(input.length * 2);
  const view = new DataView(buffer);
  let offset = 0;
  for (let i = 0; i < input.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

export function pcm16ToFloats(bytes: Uint8Array): Float32Array {
  const int16 = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
  const floats = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) floats[i] = int16[i] / 32768;
  return floats;
}

/* ------------------------------ Session types ----------------------------- */

export type LiveSessionState = "disconnected" | "connecting" | "listening" | "speaking" | "closed" | "error";

export interface LiveSessionOptions {
  model: string;
  voiceName: string;
  systemPrompt: string;
  language: "auto" | "en" | "hi";
  /** Tool declarations for the live session (agent tools). */
  tools?: { name: string; description: string; parameters: Record<string, unknown> }[];
  onState(state: LiveSessionState): void;
  onUserTranscript(text: string): void;
  onModelTranscript(text: string): void;
  /** Live tool call → agent executes → respond via respondToTool(). */
  onToolCall(call: { id: string; name: string; args: Record<string, unknown> }): void;
  onError(code: string, message: string): void;
}

export interface MicLevel {
  /** RMS 0..1 for avatar animation. */
  level: number;
}

/* -------------------------------- Session --------------------------------- */

export class GeminiLiveSession {
  private ai: GoogleGenAI | null = null;
  private session: {
    sendRealtimeInput(input: { audio?: { data: string; mimeType: string } }): void;
    sendToolResponse(resp: unknown): void;
    close(): void;
  } | null = null;
  private inputCtx: AudioContext | null = null;
  private outputCtx: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private nextStartTime = 0;
  private _state: LiveSessionState = "disconnected";
  private closing = false;

  constructor(private secrets: SecretStore, private bus: EventBus, private diag: Diagnostics) {}

  get state(): LiveSessionState { return this._state; }

  private setState(s: LiveSessionState): void {
    if (this._state === s) return;
    this._state = s;
    this.opts.onState(s);
  }

  private opts!: LiveSessionOptions;

  async start(opts: LiveSessionOptions): Promise<boolean> {
    this.opts = opts;
    this.closing = false;
    const key = await this.secrets.read("gemini");
    if (!key) {
      opts.onError("LLM_NOT_CONFIGURED", "No Gemini API key configured — live voice needs Gemini. Add your key in Settings.");
      return false;
    }
    try {
      this.setState("connecting");
      this.ai = new GoogleGenAI({ apiKey: key });

      const langHint = opts.language === "hi"
        ? " The user often speaks Hindi/Hinglish — understand and reply in kind."
        : opts.language === "en" ? " The user prefers English." : "";

      const session = await this.ai.live.connect({
        model: opts.model,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: opts.voiceName } } },
          systemInstruction: opts.systemPrompt + langHint,
          ...(opts.tools?.length ? {
            tools: [{
              functionDeclarations: opts.tools.map(t => ({
                name: t.name, description: t.description, parameters: t.parameters
              }))
            }]
          } : {})
        },
        callbacks: {
          onmessage: (msg: LiveServerMessage) => this.handleMessage(msg),
          onerror: (e: unknown) => {
            this.diag.log("voice", "LIVE_ERROR", { error: String(e) });
            opts.onError("LLM_PROVIDER_ERROR", String((e as Error)?.message ?? e));
            this.setState("error");
          },
          onclose: () => {
            this.diag.log("voice", "LIVE_CLOSED", {});
            this.setState("closed");
          }
        }
      });
      this.session = session as unknown as NonNullable<typeof this.session>;

      // --- Mic capture: AudioWorklet → 16 kHz mono PCM ---
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
      this.inputCtx = new AudioContext({ sampleRate: 16000 });
      const src = this.inputCtx.createMediaStreamSource(this.micStream);
      const workletCode = `
        class ZaraCapture extends AudioWorkletProcessor {
          process(inputs) {
            const ch = inputs[0]?.[0];
            if (ch) this.port.postMessage(ch.slice(0));
            return true;
          }
        }
        registerProcessor('zara-capture', ZaraCapture);
      `;
      const blobUrl = URL.createObjectURL(new Blob([workletCode], { type: "application/javascript" }));
      await this.inputCtx.audioWorklet.addModule(blobUrl);
      URL.revokeObjectURL(blobUrl);
      this.workletNode = new AudioWorkletNode(this.inputCtx, "zara-capture");
      this.workletNode.port.onmessage = (e: MessageEvent<Float32Array>) => {
        if (this.closing || !this.session) return;
        const pcm = floatTo16BitPCM(e.data);
        this.session.sendRealtimeInput({ audio: { data: arrayBufferToBase64(pcm), mimeType: "audio/pcm;rate=16000" } });
      };
      src.connect(this.workletNode);

      this.outputCtx = new AudioContext({ sampleRate: 24000 });
      this.nextStartTime = 0;
      this.setState("listening");
      this.diag.log("voice", "LIVE_STARTED", { model: opts.model, voice: opts.voiceName });
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.diag.log("voice", "LIVE_START_FAILED", { error: msg });
      opts.onError("VOICE_START_FAILED", msg);
      this.setState("error");
      await this.stop();
      return false;
    }
  }

  private handleMessage(msg: LiveServerMessage): void {
    const sc = msg.serverContent as { modelTurn?: { parts?: { inlineData?: { data: string; mimeType?: string }; text?: string }[] }, inputTranscription?: { text?: string }, outputTranscription?: { text?: string }, interrupted?: boolean, generationComplete?: boolean } | undefined;

    if (msg.toolCall?.functionCalls?.length) {
      for (const fc of msg.toolCall.functionCalls) {
        this.opts.onToolCall({
          id: fc.id ?? `live_${Math.random().toString(36).slice(2, 10)}`,
          name: String(fc.name),
          args: (fc.args ?? {}) as Record<string, unknown>
        });
      }
    }

    if (sc?.inputTranscription?.text) {
      this.opts.onUserTranscript(sc.inputTranscription.text);
    }
    if (sc?.outputTranscription?.text) {
      this.opts.onModelTranscript(sc.outputTranscription.text);
    }

    // Barge-in upstream: model noticed it was interrupted.
    if (sc?.interrupted) {
      this.stopPlayback();
      this.bus.emit("ZARA_INTERRUPTED", {
        utteranceId: "live", phase: "speech",
        turnId: "live", at: Date.now(), reason: "user barge-in detected by live model"
      });
    }

    const parts = sc?.modelTurn?.parts ?? [];
    for (const p of parts) {
      if (p.inlineData?.data) {
        this.playPcmChunk(base64ToUint8(p.inlineData.data));
      }
    }
  }

  /** Gapless 24 kHz playback scheduling (MYRAA-proven approach). */
  private playPcmChunk(bytes: Uint8Array): void {
    if (!this.outputCtx || this.closing) return;
    this.setState("speaking");
    this.bus.emit("ZARA_STARTED_SPEAKING", { utteranceId: "live", source: "reply" });
    const floats = pcm16ToFloats(bytes);
    const buf = this.outputCtx.createBuffer(1, floats.length, 24000);
    buf.copyToChannel(floats, 0);
    const src = this.outputCtx.createBufferSource();
    src.buffer = buf;
    src.connect(this.outputCtx.destination);
    const now = this.outputCtx.currentTime;
    if (this.nextStartTime < now + 0.02) this.nextStartTime = now + 0.02;
    src.start(this.nextStartTime);
    this.nextStartTime += buf.duration;
    this.activeSources.push(src);
    src.onended = () => {
      const i = this.activeSources.indexOf(src);
      if (i >= 0) this.activeSources.splice(i, 1);
      if (this.outputCtx && this.nextStartTime - this.outputCtx.currentTime < 0.05) {
        this.setState("listening");
        this.bus.emit("ZARA_STOPPED_SPEAKING", { utteranceId: "live", completed: true });
      }
    };
  }

  /** Immediate playback stop (§10) — barge-in/cancel path. */
  stopPlayback(): void {
    if (!this.outputCtx) return;
    this.nextStartTime = this.outputCtx.currentTime;
    for (const src of this.activeSources.splice(0)) {
      try { src.stop(); } catch { /* already stopped */ }
    }
  }

  private activeSources: AudioBufferSourceNode[] = [];

  /** Send a verified tool result back into the live conversation. */
  sendToolResponse(callId: string, name: string, output: Record<string, unknown>): void {
    this.session?.sendToolResponse({
      functionResponses: [{ id: callId, name, response: { output } }]
    });
  }

  async stop(): Promise<void> {
    this.closing = true;
    try { this.session?.close(); } catch { /* noop */ }
    try { this.workletNode?.disconnect(); } catch { /* noop */ }
    try { this.micStream?.getTracks().forEach(t => t.stop()); } catch { /* noop */ }
    try { await this.inputCtx?.close(); } catch { /* noop */ }
    try { await this.outputCtx?.close(); } catch { /* noop */ }
    this.session = null;
    this.workletNode = null;
    this.micStream = null;
    this.inputCtx = null;
    this.outputCtx = null;
    this.setState("disconnected");
  }
}

/* ------------------------------ base64 helpers ---------------------------- */

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function base64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
