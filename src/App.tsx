/**
 * MYRAA — application shell.
 *
 * Layers (back to front):
 *   theme orb → PMX character canvas → hologram particles → status chips →
 *   subtitles → transcript → composer → voice controls → panels.
 *
 * The voice lifecycle is a deterministic state machine:
 *   disconnected → connecting → connected → listening ⇄ (talking)
 * Any failure lands in "error" with a recoverable action; nothing deadlocks.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CharacterView } from "./character/CharacterView";
import { ApiKeyGate } from "./components/ApiKeyGate";
import { Composer } from "./components/Composer";
import { MemoryPanel } from "./components/MemoryPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { themeColors, themeOrbClass, type ThemeName } from "./lib/themes";
import { useSettings } from "./lib/settings";
import type { Memory } from "./lib/memoryTypes";
import {
  MyraaVoiceClient,
  type ConnectionState,
  type ToolCallInfo,
  type TranscriptEntry,
} from "./lib/voiceClient";

type ActivityMode = "idle" | "listening" | "thinking" | "talking";

interface StatusChip {
  label: string;
  tone: "cyan" | "emerald" | "amber" | "rose" | "slate";
}

// Playful core suggestions for the TOPICS flyout (functional equivalent of the
// original's suggestion chips; RECONSTRUCTED — original list not observable).
const TOPIC_SUGGESTIONS: string[] = [
  "What have you been thinking about lately?",
  "Tell me something new you learned today",
  "I want to plan something for this week",
  "Remind me what we talked about yesterday",
];

export default function App() {
  const { settings, update } = useSettings();

  // --- Backend configuration -------------------------------------------------
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);
  const [showKeyGate, setShowKeyGate] = useState(false);
  const [agentOnline, setAgentOnline] = useState(false);

  // --- Voice client -----------------------------------------------------------
  const voiceRef = useRef<MyraaVoiceClient | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const [statusLine, setStatusLine] = useState("disconnected");
  const [activity, setActivity] = useState<ActivityMode>("idle");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [subtitle, setSubtitle] = useState<string | null>(null);
  const [outputAnalyser, setOutputAnalyser] = useState<AnalyserNode | null>(null);
  const [inputAnalyser, setInputAnalyser] = useState<AnalyserNode | null>(null);
  const [screenVisionState, setScreenVisionState] = useState<string>("OFF");
  const [micVolume, setMicVolume] = useState(0);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  // --- Panels -----------------------------------------------------------------
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [topicsOpen, setTopicsOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [memories, setMemories] = useState<Memory[]>([]);

  // --- Screen share -----------------------------------------------------------
  const [screenSharing, setScreenSharing] = useState(false);
  const [screenPaused, setScreenPaused] = useState(false);

  // Wake word (Web Speech API fallback listener)
  const wakeRecognitionRef = useRef<any>(null);

  const theme: ThemeName = settings.theme;

  // ---------------------------------------------------------------------------
  // Config + agent health
  // ---------------------------------------------------------------------------
  const refreshConfig = useCallback(async () => {
    try {
      const response = await fetch("/api/config");
      const data = (await response.json()) as { hasApiKey?: boolean };
      setHasApiKey(Boolean(data.hasApiKey));
    } catch {
      setHasApiKey(false);
    }
  }, []);

  useEffect(() => {
    void refreshConfig();
    const timer = setInterval(async () => {
      try {
        const response = await fetch("/api/agent-health");
        const data = (await response.json()) as { online?: boolean };
        setAgentOnline(Boolean(data.online));
      } catch {
        setAgentOnline(false);
      }
    }, 10_000);
    return () => clearInterval(timer);
  }, [refreshConfig]);

  // ---------------------------------------------------------------------------
  // Memory sync
  // ---------------------------------------------------------------------------
  const refreshMemories = useCallback(async () => {
    try {
      const response = await fetch("/api/memories");
      const data = (await response.json()) as Memory[];
      setMemories(Array.isArray(data) ? data : []);
    } catch {
      /* keep last known list */
    }
  }, []);

  useEffect(() => {
    void refreshMemories();
  }, [refreshMemories]);

  // ---------------------------------------------------------------------------
  // Voice client wiring
  // ---------------------------------------------------------------------------
  const handleToolCall = useCallback(
    (info: ToolCallInfo) => {
      // Browser-side tools echo back to the live session.
      const output: Record<string, unknown> =
        info.name === "changeBackground"
          ? { result: `Background changed to ${(info.args.color as string) || "default"}.` }
          : { result: "Handled by client." };
      if (info.name === "changeBackground") {
        const color = String(info.args.color || "charcoal");
        update({ theme: color as ThemeName });
      }
      voiceRef.current?.respondToTool(info.callId, info.name, { output });
    },
    [update],
  );

  useEffect(() => {
    const client = new MyraaVoiceClient({
      onState: (state) => {
        setConnectionState(state);
        setStatusLine(state);
        if (state === "listening") setActivity("listening");
        if (state === "disconnected") setActivity("idle");
      },
      onStatus: (status) => setStatusLine(status),
      onTranscription: (entry) => {
        setTranscript((current) => [...current.slice(-80), entry]);
        if (entry.role === "model") {
          setSubtitle(entry.text);
        } else if (entry.text) {
          setActivity("thinking");
        }
      },
      onTurnComplete: () => {
        setActivity("listening");
      },
      onInterrupted: () => {
        setActivity("listening");
      },
      onToolCall: handleToolCall,
      onMemorySync: (incoming) => {
        setMemories((incoming as Memory[]) || []);
      },
      onError: (message, code) => {
        setStatusLine(`error: ${message}`);
        setConnectionState("error");
        if (code === "INVALID_API_KEY") {
          void fetch("/api/config")
            .then((r) => r.json())
            .then((data: { hasApiKey?: boolean }) => setHasApiKey(Boolean(data.hasApiKey)))
            .catch(() => setHasApiKey(false));
        }
      },
      onScreenVisionState: (state) => setScreenVisionState(state.toUpperCase()),
      onOutputAnalyser: (analyser) => setOutputAnalyser(analyser),
      onInputAnalyser: (analyser) => setInputAnalyser(analyser),
    });
    voiceRef.current = client;
    return () => {
      client.disconnect();
      voiceRef.current = null;
    };
  }, [handleToolCall]);

  // Mic volume meter for the orb halo + wake word hook
  useEffect(() => {
    if (!inputAnalyser) return;
    const data = new Uint8Array(inputAnalyser.fftSize);
    const timer = setInterval(() => {
      inputAnalyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i += 1) {
        const value = (data[i] - 128) / 128;
        sum += value * value;
      }
      setMicVolume(Math.min(1, Math.sqrt(sum / data.length) * 3));
    }, 120);
    return () => clearInterval(timer);
  }, [inputAnalyser]);

  // Web Speech API wake-word listener (browser-native fallback; the primary
  // wake path is the server's streaming transcription).
  useEffect(() => {
    if (!settings.wakeWordEnabled) {
      wakeRecognitionRef.current?.stop?.();
      wakeRecognitionRef.current = null;
      return;
    }
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    const phrase = settings.wakePhrase.trim().toLowerCase() || "hey myraa";
    recognition.onresult = (event: any) => {
      const result = event.results[event.results.length - 1];
      const text = String(result?.[0]?.transcript || "").toLowerCase();
      if (text.includes(phrase) && connectionState === "disconnected") {
        void startVoice(true);
      }
    };
    try {
      recognition.start();
      wakeRecognitionRef.current = recognition;
    } catch {
      /* recognition unavailable — voice button still works */
    }
    return () => {
      try {
        recognition.stop();
      } catch {
        /* already stopped */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.wakeWordEnabled, settings.wakePhrase, connectionState]);

  // ---------------------------------------------------------------------------
  // Voice lifecycle
  // ---------------------------------------------------------------------------
  const startVoice = useCallback(
    async (force = false) => {
      const client = voiceRef.current;
      if (!client) return;
      if (connectionState !== "disconnected" && !force) {
        return;
      }
      if (!hasApiKey) {
        setShowKeyGate(true);
        return;
      }
      try {
        await client.connect({ useMicrophone: true });
      } catch (error) {
        setStatusLine(error instanceof Error ? error.message : String(error));
        setConnectionState("error");
      }
    },
    [connectionState, hasApiKey],
  );

  const stopVoice = useCallback(() => {
    voiceRef.current?.disconnect();
    setTranscript([]);
    setSubtitle(null);
    setScreenSharing(false);
    setScreenPaused(false);
    setScreenVisionState("OFF");
  }, []);

  // Subtitle expiry
  useEffect(() => {
    if (!subtitle) return;
    const timer = setTimeout(() => setSubtitle(null), 6000);
    return () => clearTimeout(timer);
  }, [subtitle]);

  // Transcript autoscroll
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  const sendText = useCallback((text: string) => {
    voiceRef.current?.sendText(text);
    setActivity("thinking");
  }, []);

  const toggleScreenShare = useCallback(async () => {
    const client = voiceRef.current;
    if (!client) return;
    if (screenSharing) {
      client.stopScreenShare();
      setScreenSharing(false);
      setScreenPaused(false);
      return;
    }
    try {
      await client.startScreenShare();
      setScreenSharing(true);
      setScreenPaused(false);
    } catch (error) {
      setStatusLine(error instanceof Error ? error.message : "Could not see your screen");
    }
  }, [screenSharing]);

  const togglePauseShare = useCallback(() => {
    const client = voiceRef.current;
    if (!client || !screenSharing) return;
    if (client.isScreenPaused) {
      client.resumeScreenShare();
      setScreenPaused(false);
    } else {
      client.pauseScreenShare();
      setScreenPaused(true);
    }
  }, [screenSharing]);

  // ---------------------------------------------------------------------------
  // Derived UI state
  // ---------------------------------------------------------------------------
  const statusChips = useMemo<StatusChip[]>(() => {
    const chips: StatusChip[] = [];
    if (screenSharing) {
      chips.push(
        screenPaused
          ? { label: "SCREEN VISION PAUSED", tone: "amber" }
          : { label: "SCREEN VISION ACTIVE", tone: "cyan" },
      );
    } else if (screenVisionState === "ACTIVE") {
      chips.push({ label: "SCREEN VISION MODE", tone: "cyan" });
    }
    if (transcript.length > 0) {
      chips.push({ label: "MEM-SYNC STREAM ACTIVE", tone: "emerald" });
    }
    chips.push(
      agentOnline
        ? { label: "Agent Online", tone: "emerald" }
        : { label: "Agent Offline", tone: "rose" },
    );
    return chips;
  }, [agentOnline, screenPaused, screenSharing, screenVisionState, transcript.length]);

  const statusText = useMemo(() => {
    if (connectionState === "listening") return "I am listening. Speak freely...";
    if (connectionState === "connecting") return "Materializing presence links...";
    if (connectionState === "error") return statusLine || "Something went wrong.";
    if (connectionState === "connected") return "Holographic Live link active.";
    if (!hasApiKey) return "Connect memory core to awaken my voice.";
    return "Awake Myraa";
  }, [connectionState, hasApiKey, statusLine]);

  const toneClass = (tone: StatusChip["tone"]) => {
    switch (tone) {
      case "cyan":
        return "border-cyan-400/60 bg-cyan-500/15 text-cyan-200";
      case "emerald":
        return "border-emerald-400/25 bg-emerald-400/10 text-emerald-300";
      case "amber":
        return "border-amber-400/60 bg-amber-500/15 text-amber-200";
      case "rose":
        return "border-rose-500/30 bg-rose-500/10 text-rose-400";
      default:
        return "border-white/10 text-slate-400";
    }
  };

  const colors = themeColors(theme);
  const connected = connectionState === "listening" || connectionState === "connected";

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#0a0a0f] text-slate-200">
      {/* Ambient theme orb */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
        <div
          className={`w-[500px] h-[500px] rounded-full blur-[140px] opacity-25 bg-gradient-to-tr transition-all duration-1000 ${themeOrbClass(theme)}`}
        />
      </div>

      {/* PMX character */}
      <CharacterView
        activity={activity}
        outputAnalyser={outputAnalyser}
        inputAnalyser={inputAnalyser}
        controlsEnabled={connected}
        reflectionStrength={1}
      />

      {/* Hologram particles canvas */}
      <canvas
        id="myraa-hologram-living-canvas"
        className="absolute inset-0 w-full h-full pointer-events-none z-[15]"
      />

      {/* Top status bar — original layout: MYRAA wordmark left, TOPICS / RECALLS / SHARE SCREEN / SETTINGS right */}
      <div className="absolute inset-x-0 top-0 z-20 flex items-start justify-between p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-2 font-mono text-sm font-semibold tracking-[0.35em] text-white">
            MYRAA
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{
                background: connected ? "#34d399" : "#64748b",
                boxShadow: connected ? "0 0 8px #34d399" : "none",
              }}
            />
          </span>
          {statusChips.map((chip) => (
            <span key={chip.label} className={`myraa-chip ${toneClass(chip.tone)}`}>
              {chip.label}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-5">
          <button
            onClick={() => setTopicsOpen((open) => !open)}
            className="myraa-chip border-transparent bg-transparent px-0 hover:text-white transition text-slate-400"
            title="Playful core suggestions"
          >
            TOPICS
          </button>
          <button
            onClick={() => setMemoryOpen(true)}
            className="myraa-chip border-transparent bg-transparent px-0 hover:text-white transition text-slate-400"
            title="Recollections Database"
          >
            RECALLS
          </button>
          <button
            onClick={() => void toggleScreenShare()}
            disabled={!connected}
            className="myraa-chip border-transparent bg-transparent px-0 hover:text-white transition text-slate-400 disabled:opacity-40"
            title={screenSharing ? "Stop sharing your screen" : "Share Screen with Myraa"}
          >
            {screenSharing ? "STOP SHARE" : "SHARE SCREEN"}
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            className="myraa-chip border-transparent bg-transparent px-0 hover:text-white transition text-slate-400"
          >
            SETTINGS
          </button>
        </div>
      </div>

      {/* Topics flyout — playful core suggestions (functional equivalent) */}
      {topicsOpen && (
        <div className="absolute right-5 top-16 z-30 w-72 rounded-2xl border border-white/10 bg-black/70 p-4 backdrop-blur-xl">
          <p className="mb-3 text-[10px] font-mono uppercase tracking-[0.3em] text-slate-500">
            Playful core suggestions
          </p>
          <div className="space-y-2">
            {TOPIC_SUGGESTIONS.map((topic) => (
              <button
                key={topic}
                onClick={() => {
                  setTopicsOpen(false);
                  window.dispatchEvent(new CustomEvent("myraa:prefill", { detail: topic }));
                }}
                className="block w-full rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2 text-left text-xs text-slate-300 transition hover:border-white/20 hover:text-white"
              >
                {topic}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Transmission status */}
      {connectionState === "connecting" && (
        <div className="absolute left-1/2 top-20 z-20 -translate-x-1/2">
          <span className="myraa-chip border-cyan-400/60 bg-cyan-500/15 text-cyan-200 animate-pulse">
            {statusLine === "connecting_gemini" ? "LINKING GEMINI LIVE" : "MATERIALIZING PRESENCE LINKS"}
          </span>
        </div>
      )}

      {/* Center subtitles */}
      <div className="pointer-events-none absolute inset-x-0 bottom-36 z-20 flex justify-center px-6">
        <div className="min-h-[6rem] max-w-3xl text-center">
          <AnimatePresence mode="wait">
            {subtitle ? (
              <motion.p
                key={subtitle.slice(0, 48)}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.35 }}
                className="cinematic-subtitles text-balance text-lg leading-relaxed text-white/95"
              >
                {subtitle}
              </motion.p>
            ) : (
              <motion.p
                key="status"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-xs font-mono uppercase tracking-[0.3em] text-slate-500"
              >
                {settings.animations ? statusText : ""}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Transcript rail */}
      {transcript.length > 0 && (
        <div className="myraa-scroll absolute bottom-40 left-6 z-20 max-h-[38vh] w-[330px] max-w-[80vw] space-y-2 overflow-y-auto rounded-2xl border border-white/5 bg-black/35 p-4 backdrop-blur-md">
          {transcript.slice(-24).map((entry, index) => (
            <div key={`${entry.at}-${index}`} className="space-y-0.5">
              <p
                className={`text-[9px] font-mono uppercase tracking-widest ${
                  entry.role === "user" ? "text-cyan-300/80" : "text-rose-300/80"
                }`}
              >
                {entry.role === "user" ? "You" : "MYRAA"}
              </p>
              <p className="text-xs leading-relaxed text-slate-300">{entry.text}</p>
            </div>
          ))}
          <div ref={transcriptEndRef} />
        </div>
      )}

      {/* Bottom controls — original layout: composer, then a single circular power button */}
      <div className="absolute inset-x-0 bottom-0 z-30 flex flex-col items-center gap-3 p-5">
        <Composer
          disabled={!connected}
          onSend={sendText}
          onUserSpeechStarted={() => voiceRef.current?.sendConversationEvent("user_started_speaking")}
        />
        {/* Awake / sleep power button */}
        <button
          onClick={() => (connected ? stopVoice() : void startVoice())}
          aria-label={connected ? "Terminate Stream" : "Awake Myraa"}
          title={connected ? "Terminate Stream" : "Awake Myraa"}
          className={`relative mt-1 flex h-16 w-16 items-center justify-center rounded-full border backdrop-blur-md transition ${
            connected
              ? "border-rose-400/60 bg-rose-500/15 text-rose-300 hover:bg-rose-500/25"
              : "border-white/15 bg-white/[0.06] text-slate-300 hover:bg-white/[0.12]"
          }`}
        >
          <span
            className="absolute inset-0 rounded-full"
            style={{
              boxShadow: connected
                ? `0 0 ${18 + micVolume * 30}px rgba(251,113,133,0.45)`
                : "0 0 22px rgba(148,163,184,0.12)",
            }}
          />
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            className="h-6 w-6"
          >
            <path d="M12 2v10" />
            <path d="M18.4 6.6a9 9 0 1 1-12.77.04" />
          </svg>
        </button>
        {!connected && !hasApiKey && (
          <p className="text-[11px] text-slate-500">Microphone required for holographic Live link.</p>
        )}
      </div>

      {/* Panels */}
      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        update={update}
        hasApiKey={Boolean(hasApiKey)}
        onReplaceKey={() => setShowKeyGate(true)}
      />
      <MemoryPanel
        open={memoryOpen}
        onClose={() => setMemoryOpen(false)}
        memories={memories}
        onMemoriesChanged={() => void refreshMemories()}
      />

      {/* API key gate */}
      {showKeyGate && (
        <ApiKeyGate
          onSaved={() => {
            setShowKeyGate(false);
            void refreshConfig();
          }}
        />
      )}
      {hasApiKey === false && !showKeyGate && <ApiKeyGate onSaved={() => void refreshConfig()} />}
    </div>
  );
}
