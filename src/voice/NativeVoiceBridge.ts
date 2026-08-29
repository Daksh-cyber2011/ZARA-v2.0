/**
 * ZARA V1.0 Phase 2 — Native voice bridge (ZaraVoice Capacitor plugin).
 *
 * Typed TS surface for the Android-native STT/TTS plugin:
 *   - STT: continuous recognition sessions with partial/final events
 *   - TTS: utterance lifecycle events (start/done/error)
 *
 * Falls back to null-availability on web/tests (the NativeVoiceSession then
 * uses the Web Speech API when present, or reports honestly that voice is
 * unavailable — §32: no fabricated capabilities).
 */
import { registerPlugin, PluginListenerHandle } from "@capacitor/core";

export interface VoiceCapabilities {
  ttsReady: boolean;
  sttAvailable: boolean;
  sttListening: boolean;
}

export interface TtsResult {
  ok: boolean;
  summary: string;
  utteranceId?: string;
  degraded?: boolean;
  error?: { code: string; message: string };
}

export interface SttEvent {
  type: "partial" | "final" | "error";
  text?: string;
  code?: string;
  message?: string;
}

export interface TtsEvent {
  type: "start" | "done" | "error";
  utteranceId?: string;
}

interface ZaraVoicePlugin {
  capabilities(): Promise<VoiceCapabilities>;
  ttsSpeak(options: { text: string; lang: string; utteranceId: string }): Promise<TtsResult>;
  ttsStop(): Promise<{ ok: boolean }>;
  sttStart(options: { lang: string }): Promise<{ ok: boolean; summary?: string; error?: { code: string; message: string } }>;
  sttStop(): Promise<{ ok: boolean }>;
  addListener(eventName: "sttEvent" | "ttsEvent", listenerFunc: (data: never) => void): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}

const ZaraVoice = registerPlugin<ZaraVoicePlugin>("ZaraVoice");

export function isVoicePluginAvailable(): boolean {
  const g = globalThis as { Capacitor?: { isNativePlatform?: () => boolean; isPluginAvailable?: (n: string) => boolean } };
  return !!(g.Capacitor?.isNativePlatform?.() && g.Capacitor?.isPluginAvailable?.("ZaraVoice"));
}

/** Native STT start (auto-restart sessions; results arrive via onSttEvent). */
export async function nativeSttStart(lang: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await ZaraVoice.sttStart({ lang });
    return r.ok ? { ok: true } : { ok: false, error: r.error?.message ?? r.error?.code ?? "STT failed to start" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function nativeSttStop(): Promise<void> {
  try { await ZaraVoice.sttStop(); } catch { /* already stopped */ }
}

/** Speak one utterance natively; resolves when accepted (not when finished). */
export async function nativeTtsSpeak(text: string, lang: string, utteranceId: string): Promise<TtsResult> {
  try {
    return await ZaraVoice.ttsSpeak({ text, lang, utteranceId });
  } catch (e) {
    return { ok: false, summary: "Native TTS call failed.", error: { code: "TTS_CALL_FAILED", message: e instanceof Error ? e.message : String(e) } };
  }
}

export async function nativeTtsStop(): Promise<void> {
  try { await ZaraVoice.ttsStop(); } catch { /* already stopped */ }
}

export async function nativeVoiceCapabilities(): Promise<VoiceCapabilities | null> {
  if (!isVoicePluginAvailable()) return null;
  try { return await ZaraVoice.capabilities(); } catch { return null; }
}

export async function addSttListener(cb: (e: SttEvent) => void): Promise<PluginListenerHandle | null> {
  try { return await ZaraVoice.addListener("sttEvent", cb as unknown as (data: never) => void); }
  catch { return null; }
}

export async function addTtsListener(cb: (e: TtsEvent) => void): Promise<PluginListenerHandle | null> {
  try { return await ZaraVoice.addListener("ttsEvent", cb as unknown as (data: never) => void); }
  catch { return null; }
}
