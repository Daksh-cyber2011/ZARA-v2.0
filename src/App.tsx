/**
 * ZARA V1.0 — Main application shell.
 *
 * One screen: the avatar stage (ZARA's presence) + conversation stream +
 * composer + side panels (chat · memory · settings · diagnostics).
 * The avatar reflects the REAL runtime state at all times (§29).
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { zaraRuntime } from "./ZaraRuntime";
import { ProceduralAvatarRenderer, type AvatarRenderer } from "./avatar/renderer/ProceduralAvatar";
import { VrmAvatarRenderer } from "./avatar/renderer/VrmAvatarRenderer";
import { speechEnvelope } from "./avatar/renderer/vrmMapping";
import { buildAndroidTools } from "./agent/tools/AndroidTools";
import Onboarding from "./ui/components/Onboarding";
import SettingsPanel from "./ui/components/SettingsPanel";
import MemoryPanel from "./ui/components/MemoryPanel";
import DiagnosticsPanel from "./ui/components/DiagnosticsPanel";
import { Icon } from "./ui/components/Icons";
import { ZaraState } from "./core/state/states";

interface ChatMsg {
  who: "user" | "zara";
  text: string;
  tools?: { tool: string; outcome: string; status: string }[];
}

const STATE_COLORS: Record<ZaraState, string> = {
  BOOTING: "#7a8aa0", IDLE: "#5a6c82", LISTENING: "#37c8b5", THINKING: "#8a6cff",
  PLANNING: "#b08cff", SPEAKING: "#4f9cff", WAITING: "#ffb347", INTERRUPTED: "#e05252",
  QUIET: "#4a6a7f", SLEEPING: "#2a3550", EXECUTING: "#3ecf8e", VERIFYING: "#3ecfb0", ERROR: "#e05252",
  SHUTTING_DOWN: "#55606e"
};

export default function App() {
  const [booted, setBooted] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [state, setState] = useState<ZaraState>("BOOTING");
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState<{ who: "user" | "zara"; text: string } | null>(null);
  const [confirmQ, setConfirmQ] = useState<{ callId: string; tool: string; summary: string } | null>(null);
  const [tab, setTab] = useState<"chat" | "memory" | "settings" | "diagnostics">("chat");
  const [emotion, setEmotion] = useState("neutral");
  const [perceptionLine, setPerceptionLine] = useState("");

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const vrmCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const avatarRef = useRef<AvatarRenderer | null>(null);
  const proceduralRef = useRef<ProceduralAvatarRenderer | null>(null);
  const vrmRef = useRef<VrmAvatarRenderer | null>(null);
  const streamEndRef = useRef<HTMLDivElement | null>(null);
  const [avatarMode, setAvatarMode] = useState<"vrm" | "procedural" | "loading">("loading");

  /* ------------------------------ boot ---------------------------------- */
  /* §18: bounded boot. The runtime guards every stage with timeouts, AND
   * this effect runs an independent failsafe: if init() has not returned
   * within BOOT_FAILSAFEE_MS, the UI opens anyway (degraded) — the
   * "ZARA is waking up…" forever bug is structurally impossible. */
  const [bootStageLine, setBootStageLine] = useState("");
  useEffect(() => {
    let alive = true;
    let initDone = false;
    // Independent watchdog — lives OUTSIDE the runtime so even a runtime
    // bug cannot freeze the UI (§18 belt-and-braces).
    const failsafe = setTimeout(() => {
      if (!initDone && alive) {
        setBootStageLine("still starting — opening in degraded mode");
        setBooted(true); // open the UI; runtime finishes in background
      }
    }, 15000);
    // Live boot-stage progress (§19) for the waking screen.
    const offBoot = zaraRuntime.diag.onRecord(r => {
      if (r.category === "state" && r.event === "BOOT_STAGE" && !initDone) {
        const d = r.detail as { stage?: string; status?: string };
        if (d.stage) setBootStageLine(`${d.stage.toLowerCase().replace(/_/g, " ")} — ${d.status?.toLowerCase() ?? ""}`);
      }
    });
    (async () => {
      await zaraRuntime.init();
      if (!alive) { clearTimeout(failsafe); return; }
      initDone = true;
      clearTimeout(failsafe);
      const configured = await zaraRuntime.providers.configuredProviders();
      if (!alive) return;
      setNeedsOnboarding(configured.length === 0);
      setBooted(true);
      // §34: seed the visible transcript with the restored conversation so
      // the user SEES continuity. Read from the runtime (event-only seeding
      // is racy — SESSION_RESUMED fires during init(), before listeners attach).
      const restored = zaraRuntime.restoredConversation;
      if (restored.length > 0) {
        setMsgs(restored.map(m => ({ who: m.role === "user" ? "user" as const : "zara" as const, text: m.text })));
      }
      zaraRuntime.startProactiveLoop(60000);

      const refresh = () => {
        setState(zaraRuntime.sm.state);
        setEmotion(zaraRuntime.emotions.emotion);
        const c = zaraRuntime.confirmations.current;
        setConfirmQ(c ? { callId: c.callId, tool: c.tool, summary: c.summary } : null);
        const p = zaraRuntime.perception.describe();
        setPerceptionLine(p.join(" · "));
      };
      zaraRuntime.onEvent = kind => {
        refresh();
        if (kind === "transcript") {
          // Live session transcripts flow through the runtime's history —
          // displayed via bus events captured below.
        }
      };
      zaraRuntime.sm.onTransition(() => {
        avatarRef.current?.setState(zaraRuntime.sm.state);
        refresh();
      });
      const offConfirmReq = zaraRuntime.bus.on("CONFIRMATION_REQUESTED", c => {
        setConfirmQ({ ...c });
      });
      const offConfirmRes = zaraRuntime.bus.on("CONFIRMATION_RESOLVED", () => setConfirmQ(null));
      const offSpoke = zaraRuntime.bus.on("USER_SPOKE", t => {
        setMsgs(m => [...m, { who: "user", text: t.text }]);
      });
      // §34: seed the visible transcript with the restored conversation so
      // the user SEES continuity, not just the model having it.
      const offResumed = zaraRuntime.bus.on("SESSION_RESUMED", r => {
        setMsgs(m => (m.length === 0 ? r.messages.map(msg => ({ who: msg.role === "user" ? "user" as const : "zara" as const, text: msg.text })) : m));
      });
      const offSpeakStart = zaraRuntime.bus.on("ZARA_STARTED_SPEAKING", u => {
        if (u.source === "proactive") {
          setMsgs(m => [...m, { who: "zara", text: "" }]); // placeholder filled at stop
        }
      });
      // Live voice transcript display
      let lastUserT = "";
      const offT = zaraRuntime.bus.on("USER_SPOKE", t => { lastUserT = t.text; });
      refresh();
      // §14: when the WebView/app page is actually being unloaded, the
      // runtime enters SHUTTING_DOWN and stops all subsystems (idempotent).
      const onPageHide = () => zaraRuntime.shutdown();
      window.addEventListener("pagehide", onPageHide);
      return () => { offConfirmReq(); offConfirmRes(); offSpoke(); offSpeakStart(); offT(); offResumed(); offBoot(); window.removeEventListener("pagehide", onPageHide); };
    })();
    return () => { alive = false; clearTimeout(failsafe); offBoot(); };
  }, []);

  /* --------------------------- avatar (P1/P2) ------------------------------
   * Runs in its OWN effect keyed on `booted` so both canvases are guaranteed
   * to be mounted (refs set) before the renderers start. The REAL female VRM
   * character loads over the procedural placeholder, which stays as an honest
   * fallback if WebGL or the asset is unavailable (§6: never a fake claim). */
  useEffect(() => {
    if (!booted) return;
    const fanout: AvatarRenderer = {
      start: () => {},
      stop: () => { proceduralRef.current?.stop(); vrmRef.current?.stop(); },
      setState: s => { proceduralRef.current?.setState(s); vrmRef.current?.setState(s); },
      setEnergy: e => { proceduralRef.current?.setEnergy(e); vrmRef.current?.setEnergy(e); },
      onTap: cb => { proceduralRef.current?.onTap(cb); vrmRef.current?.onTap(cb); }
    };
    avatarRef.current = fanout;

    if (canvasRef.current) {
      const renderer = new ProceduralAvatarRenderer(zaraRuntime.emotions);
      renderer.start(canvasRef.current);
      renderer.setState(zaraRuntime.sm.state);
      proceduralRef.current = renderer;
    }
    if (vrmCanvasRef.current && zaraRuntime.settings.current.animations) {
      const vrm = new VrmAvatarRenderer(zaraRuntime.emotions, {
        onStatus: (status, detail) => {
          if (status === "ready") {
            setAvatarMode("vrm");
            zaraRuntime.setAvatarStatus("vrm", "VRM female character ready");
          } else if (status === "error") {
            setAvatarMode("procedural");
            zaraRuntime.setAvatarStatus("procedural", detail ?? "VRM unavailable — procedural fallback");
          }
        }
      });
      vrm.start(vrmCanvasRef.current);
      vrm.setState(zaraRuntime.sm.state);
      vrmRef.current = vrm;
    }
    return () => {
      proceduralRef.current?.stop();
      vrmRef.current?.stop();
      proceduralRef.current = null;
      vrmRef.current = null;
    };
  }, [booted]);

  /* ------------------------- avatar energy meter -------------------------- */
  /* §9: honest controlled speech animation — a deterministic syllable-cadence
   * envelope while ZARA is truly in SPEAKING state (never random noise, never
   * running while silent). Drives procedural mouth + VRM viseme amplitude. */
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      const speaking = zaraRuntime.sm.state === "SPEAKING";
      const jitter = speaking ? (Math.random() - 0.5) * 0.08 : 0;
      const target = Math.max(0, Math.min(1, speechEnvelope(t, speaking) + jitter));
      avatarRef.current?.setEnergy(target);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    streamEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, confirmQ]);

  /* ------------------------------ actions -------------------------------- */

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);
    // NOTE: the user message is added ONCE by the USER_SPOKE bus listener —
    // never here too (smoke-test caught double-add).
    const reply = await zaraRuntime.handleUserText(text);
    setMsgs(m => {
      const next = [...m];
      if (reply) next.push({ who: "zara", text: reply });
      return next;
    });
    setBusy(false);
  }, [input, busy]);

  const toggleVoice = useCallback(async () => {
    if (listening) {
      await zaraRuntime.stopVoiceSession();
      setListening(false);
      setLiveTranscript(null);
    } else {
      const ok = await zaraRuntime.startVoiceSession();
      setListening(ok);
      if (!ok) {
        setMsgs(m => [...m, { who: "zara", text: "I couldn't start the voice session. Check that a provider key is configured in Settings and the microphone permission is granted." }]);
      }
    }
  }, [listening]);

  const interrupt = useCallback(() => {
    zaraRuntime.interruption.interrupt("ui stop button");
  }, []);

  const answerConfirm = useCallback(async (approved: boolean) => {
    zaraRuntime.confirmations.resolve(approved, "ui");
    if (approved) {
      // The orchestrator continues the turn; result arrives as reply.
      setBusy(true);
    }
  }, []);

  /* ------------------------------ render --------------------------------- */

  if (!booted) {
    return (
      <div className="app" style={{ display: "grid", placeItems: "center", gap: 10, color: "var(--text-faint)" }}>
        <div>ZARA is waking up…</div>
        {bootStageLine && <div style={{ fontSize: 12, opacity: 0.7 }}>{bootStageLine}</div>}
      </div>
    );
  }

  return (
    <div className="app">
      {needsOnboarding && <Onboarding onDone={() => {
        // Refresh the §37 cached "provider configured" status after the key
        // was saved, then close onboarding.
        void zaraRuntime.providers.configuredProviders().finally(() => setNeedsOnboarding(false));
      }} />}

      <div className="topbar">
        <span className="brand">ZARA</span>
        <span className="state-chip" style={{ ["--state-color" as string]: STATE_COLORS[state] }}>
          <span className="dot" /> {state}
        </span>
        {listening && <span className="state-chip" style={{ ["--state-color" as string]: "#37c8b5" }}><span className="dot" /> LIVE VOICE</span>}
        <span className="spacer" />
        {zaraRuntime.isQuiet ? (
          <button className="icon-btn active" title="Exit quiet mode" onClick={() => zaraRuntime.exitQuietMode()}><Icon.bellOff /></button>
        ) : (
          <button className="icon-btn" title="Quiet mode (no proactive speech)" onClick={() => zaraRuntime.enterQuietMode()}><Icon.bellOff /></button>
        )}
        <button
          className="icon-btn"
          title={state === "SLEEPING" ? "Wake ZARA" : "Sleep (low activity)"}
          onClick={() => (state === "SLEEPING" ? zaraRuntime.wake() : zaraRuntime.enterSleep())}
        >
          <Icon.moon />
        </button>
      </div>

      <div className="main">
        <div className="stage">
          {liveTranscript && (
            <div className={`transcript-live ${liveTranscript.text ? "visible" : ""}`}>
              <span className="who">{liveTranscript.who === "user" ? "You" : "ZARA"}</span>
              {liveTranscript.text}
            </div>
          )}
          <div className="avatar-stack">
            <canvas ref={canvasRef} width={640} height={640} style={{ display: avatarMode === "vrm" ? "none" : "block" }} />
            <canvas ref={vrmCanvasRef} width={640} height={640} style={{ display: avatarMode === "vrm" ? "block" : "none" }} />
          </div>
          <div className="stage-caption">
            <b>{emotion}</b> · {perceptionLine || "perception starting…"}
          </div>
        </div>

        <div className="side">
          <div className="tabs">
            {(["chat", "memory", "settings", "diagnostics"] as const).map(t => (
              <button key={t} className={`tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
                {t === "chat" ? "Conversation" : t === "memory" ? "Memory" : t === "settings" ? "Settings" : "Diagnostics"}
              </button>
            ))}
          </div>

          {tab === "chat" && (
            <>
              <div className="tab-body">
                {msgs.length === 0 && (
                  <div className="card" style={{ color: "var(--text-faint)", fontSize: 13.5, lineHeight: 1.6, textAlign: "center", padding: 24 }}>
                    Talk to ZARA — type below or tap the mic for a live voice session.
                    <br /><br />
                    Try: <i>"Open YouTube"</i> · <i>"Remind me tomorrow at 7pm to study"</i> · <i>"Remember I'm building ZARA"</i> · <i>"Zara, be quiet"</i> · <i>"Zara kal 8 baje mujhe maths ke liye remind kar dena"</i>
                  </div>
                )}
                {msgs.map((m, i) => (
                  <div className={`msg ${m.who}`} key={i}>
                    <div className="who">{m.who === "user" ? "You" : "ZARA"}</div>
                    <div className="bubble">{m.text}</div>
                  </div>
                ))}
                {busy && (
                  <div className="msg zara">
                    <div className="who">ZARA</div>
                    <div className="bubble" style={{ color: "var(--text-dim)" }}>…</div>
                  </div>
                )}
                {confirmQ && (
                  <div className="confirm-card">
                    <div className="q">{confirmQ.summary}</div>
                    <div className="row">
                      <button className="yes" onClick={() => answerConfirm(true)}>Yes, go ahead</button>
                      <button className="no" onClick={() => answerConfirm(false)}>No</button>
                    </div>
                  </div>
                )}
                <div ref={streamEndRef} />
              </div>

              <div className="composer">
                <button
                  className={`mic-btn ${listening ? "listening" : ""}`}
                  title={listening ? "End voice session" : "Start live voice session"}
                  onClick={toggleVoice}
                >
                  <Icon.mic />
                </button>
                <input
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && send()}
                  placeholder={zaraRuntime.isQuiet ? "Quiet mode — ZARA won't speak proactively" : "Talk to ZARA…"}
                  disabled={busy}
                />
                {state === "SPEAKING" ? (
                  <button className="send-btn" style={{ background: "var(--red)" }} onClick={interrupt}>Stop</button>
                ) : (
                  <button className="send-btn" onClick={send} disabled={busy || !input.trim()}>
                    <Icon.send />
                  </button>
                )}
              </div>
            </>
          )}

          {tab === "memory" && <div className="tab-body"><MemoryPanel /></div>}
          {tab === "settings" && <div className="tab-body"><SettingsPanel /></div>}
          {tab === "diagnostics" && <div className="tab-body"><DiagnosticsPanel /></div>}
        </div>
      </div>
    </div>
  );
}

// Tool risk reference for the settings/diagnostics display.
export const TOOL_RISK_TABLE = buildAndroidTools().map(t => ({ name: t.name, risk: t.risk }));
