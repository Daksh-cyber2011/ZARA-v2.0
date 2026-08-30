/**
 * ZARA V2 — Main application shell.
 *
 * One immersive screen: ZARA's holographic presence fills the viewport;
 * floating glass HUD layers (status bar · composer dock · slide-over panels)
 * keep her front-and-center. The whole interface breathes with the REAL
 * runtime state + emotion theme (§8/§29/§30) — nothing is decorative.
 *
 * Layers (bottom → top):
 *   backdrop glow (emotion-themed) → living layer (canvas) → VRM avatar →
 *   camera chips → transcript overlay → HUD bar → dock composer → panels.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { zaraRuntime } from "./ZaraRuntime";
import { ProceduralAvatarRenderer, type AvatarRenderer } from "./avatar/renderer/ProceduralAvatar";
import { VrmAvatarRenderer, type CameraView } from "./avatar/renderer/VrmAvatarRenderer";
import { speechEnvelope } from "./avatar/renderer/vrmMapping";
import { LivingLayer } from "./avatar/stage/LivingLayer";
import { themeFor, STATE_HUD_COLORS, STATE_LABELS } from "./avatar/stage/themes";
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

const BOOT_STAGES = [
  "LINKING COGNITION CORE",
  "RESTORING MEMORY LATTICE",
  "CALIBRATING VOICE PIPELINE",
  "MATERIALIZING PRESENCE"
];

const QUICK_ACTIONS: { label: string; hint: string }[] = [
  { label: "YouTube", hint: "Open YouTube" },
  { label: "Remind me", hint: "Remind me tomorrow at 7pm to study" },
  { label: "Remember", hint: "Remember that I'm building ZARA" },
  { label: "Be quiet", hint: "Zara, be quiet" }
];

export default function App() {
  const [booted, setBooted] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [state, setState] = useState<ZaraState>("BOOTING");
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [confirmQ, setConfirmQ] = useState<{ callId: string; tool: string; summary: string } | null>(null);
  const [panel, setPanel] = useState<"chat" | "memory" | "settings" | "diagnostics" | null>(null);
  const [emotion, setEmotion] = useState("neutral");
  const [perceptionLine, setPerceptionLine] = useState("");
  const [avatarReady, setAvatarReady] = useState(false);
  const [avatarError, setAvatarError] = useState("");
  const [bootPhase, setBootPhase] = useState(0);
  const [bootRatio, setBootRatio] = useState(0);
  const [bootStageLine, setBootStageLine] = useState("");
  const [eyeTracking, setEyeTracking] = useState(true);
  const [viewLocked, setViewLocked] = useState(false);
  const [cameraView, setCameraView] = useState<CameraView>("threeQuarter");
  const [nativeOnline, setNativeOnline] = useState<boolean | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const vrmCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const livingRef = useRef<HTMLCanvasElement | null>(null);
  const avatarRef = useRef<AvatarRenderer | null>(null);
  const proceduralRef = useRef<ProceduralAvatarRenderer | null>(null);
  const vrmRef = useRef<VrmAvatarRenderer | null>(null);
  const livingRef2 = useRef<LivingLayer | null>(null);
  const streamEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const theme = themeFor(emotion as never);
  const lastZaraMsg = [...msgs].reverse().find(m => m.who === "zara");

  /* ------------------------------ boot ---------------------------------- */
  useEffect(() => {
    let alive = true;
    let initDone = false;
    const failsafe = setTimeout(() => {
      if (!initDone && alive) {
        setBootStageLine("still starting — opening in degraded mode");
        setBooted(true);
      }
    }, 15000);
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
      zaraRuntime.onEvent = () => refresh();
      zaraRuntime.sm.onTransition(() => {
        avatarRef.current?.setState(zaraRuntime.sm.state);
        refresh();
      });
      const offConfirmReq = zaraRuntime.bus.on("CONFIRMATION_REQUESTED", c => setConfirmQ({ ...c }));
      const offConfirmRes = zaraRuntime.bus.on("CONFIRMATION_RESOLVED", () => setConfirmQ(null));
      const offSpoke = zaraRuntime.bus.on("USER_SPOKE", t => {
        setMsgs(m => [...m, { who: "user", text: t.text }]);
      });
      const offResumed = zaraRuntime.bus.on("SESSION_RESUMED", r => {
        setMsgs(m => (m.length === 0 ? r.messages.map(msg => ({ who: msg.role === "user" ? "user" as const : "zara" as const, text: msg.text })) : m));
      });
      const offSpeakStart = zaraRuntime.bus.on("ZARA_STARTED_SPEAKING", u => {
        if (u.source === "proactive") setMsgs(m => [...m, { who: "zara", text: "" }]);
      });
      refresh();
      const onPageHide = () => zaraRuntime.shutdown();
      window.addEventListener("pagehide", onPageHide);
      return () => { offConfirmReq(); offConfirmRes(); offSpoke(); offSpeakStart(); offResumed(); offBoot(); window.removeEventListener("pagehide", onPageHide); };
    })();
    return () => { alive = false; clearTimeout(failsafe); offBoot(); };
  }, []);

  /* --------------------------- avatar + stage ---------------------------- */
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

    // Living layer — the holographic stage behind her.
    if (livingRef.current) {
      const living = new LivingLayer();
      living.setEmotion(zaraRuntime.emotions.emotion);
      living.start(livingRef.current);
      livingRef2.current = living;
    }

    if (canvasRef.current) {
      const renderer = new ProceduralAvatarRenderer(zaraRuntime.emotions);
      renderer.start(canvasRef.current);
      renderer.setState(zaraRuntime.sm.state);
      proceduralRef.current = renderer;
    }
    if (vrmCanvasRef.current && zaraRuntime.settings.current.animations) {
      const vrm = new VrmAvatarRenderer(zaraRuntime.emotions, {
        onProgress: (phase, ratio) => {
          setBootPhase(3);
          setBootRatio(ratio);
          setBootStageLine(phase);
        },
        onStatus: (status, detail) => {
          if (status === "ready") {
            setAvatarReady(true);
            setBootRatio(1);
            zaraRuntime.setAvatarStatus("vrm", "VRM female character ready");
          } else if (status === "error") {
            setAvatarError(detail ?? "VRM unavailable — procedural fallback");
            zaraRuntime.setAvatarStatus("procedural", detail ?? "VRM unavailable — procedural fallback");
          }
        }
      });
      vrm.start(vrmCanvasRef.current);
      vrm.setState(zaraRuntime.sm.state);
      vrmRef.current = vrm;
    } else {
      // Animations disabled by the user (or no canvas): open immediately
      // with the procedural core visual — never a forever-boot.
      setAvatarError("ANIMATIONS OFF — CORE VISUAL");
    }
    return () => {
      proceduralRef.current?.stop();
      vrmRef.current?.stop();
      livingRef2.current?.stop();
      proceduralRef.current = null;
      vrmRef.current = null;
      livingRef2.current = null;
    };
  }, [booted]);

  /* ------------------------- energy + emotion feed ------------------------ */
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      const speaking = zaraRuntime.sm.state === "SPEAKING";
      const jitter = speaking ? (Math.random() - 0.5) * 0.08 : 0;
      const target = Math.max(0, Math.min(1, speechEnvelope(t, speaking) + jitter));
      avatarRef.current?.setEnergy(target);
      livingRef2.current?.setEnergy(target);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  /* emotion → living layer theme */
  useEffect(() => { livingRef2.current?.setEmotion(emotion as never); }, [emotion]);

  /* native bridge status probe (honest — shows real capability state) */
  useEffect(() => {
    if (!booted) return;
    let on = false;
    try {
      on = typeof (window as never as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform === "function"
        && (window as never as { Capacitor: { isNativePlatform: () => boolean } }).Capacitor.isNativePlatform();
    } catch { on = false; }
    setNativeOnline(on);
  }, [booted]);

  useEffect(() => {
    streamEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, confirmQ, panel]);

  /* ------------------------------ actions -------------------------------- */

  const send = useCallback(async (raw?: string) => {
    const text = (raw ?? input).trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);
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
    if (approved) setBusy(true);
  }, []);

  const applyCamera = useCallback((view: CameraView) => {
    vrmRef.current?.setView(view);
    vrmRef.current?.setViewLocked(false);
    setViewLocked(false);
    setCameraView(view);
  }, []);

  const toggleEyeTracking = useCallback(() => {
    const next = !eyeTracking;
    vrmRef.current?.setEyeTracking(next);
    setEyeTracking(next);
  }, [eyeTracking]);

  const toggleViewLock = useCallback(() => {
    const next = !viewLocked;
    vrmRef.current?.setViewLocked(next);
    setViewLocked(next);
  }, [viewLocked]);

  /* ------------------------------ boot gate ------------------------------ */

  /* The stage canvases mount as soon as the runtime is up so the VRM model
   * starts loading immediately; the boot overlay floats ON TOP until the
   * character is ready, failed (→ procedural fallback), or timed out
   * (never a forever-boot: §18 belt-and-braces). No chicken-and-egg between
   * the overlay and the canvas mount — that deadlock is what hid the model. */
  const [stageTimedOut, setStageTimedOut] = useState(false);
  useEffect(() => {
    if (booted && !avatarReady && !avatarError) {
      const t = setTimeout(() => setStageTimedOut(true), 15000);
      return () => clearTimeout(t);
    }
  }, [booted, avatarReady, avatarError]);
  const stageOpen = avatarReady || !!avatarError || stageTimedOut;

  if (!booted) {
    return (
      <div className="boot">
        <div className="boot-inner">
          <div className="boot-mark">
            <div className="boot-core" />
            <div className="boot-ring r1" />
            <div className="boot-ring r2" />
          </div>
          <div className="boot-title">ZARA</div>
          <div className="boot-sub">PERSISTENT AI COMPANION</div>
          <div className="boot-progress">
            <div className="boot-bar"><div className="boot-fill" style={{ width: `${Math.round(bootRatio * 100)}%` }} /></div>
            <div className="boot-meta">
              <span>{bootStageLine || BOOT_STAGES[bootPhase] || "LINKING COGNITION CORE"}</span>
              <span>{Math.round(bootRatio * 100)}%</span>
            </div>
          </div>
        </div>
        <div className="boot-grid" />
      </div>
    );
  }

  /* ------------------------------ main render ---------------------------- */

  const hudColor = STATE_HUD_COLORS[state];

  return (
    <div className="app" style={{ ["--z-primary" as string]: theme.primary, ["--z-secondary" as string]: theme.secondary }}>
      {/* boot overlay — floats above the stage while the character loads */}
      {!stageOpen && (
        <div className="boot overlay">
          <div className="boot-inner">
            <div className="boot-mark">
              <div className="boot-core" />
              <div className="boot-ring r1" />
              <div className="boot-ring r2" />
            </div>
            <div className="boot-title">ZARA</div>
            <div className="boot-sub">PERSISTENT AI COMPANION</div>
            <div className="boot-progress">
              <div className="boot-bar"><div className="boot-fill" style={{ width: `${Math.round(bootRatio * 100)}%` }} /></div>
              <div className="boot-meta">
                <span>{bootStageLine || BOOT_STAGES[bootPhase] || "LINKING COGNITION CORE"}</span>
                <span>{Math.round(bootRatio * 100)}%</span>
              </div>
            </div>
            {avatarError && <div className="boot-fallback">PROJECTION DEGRADED — SWITCHING TO CORE VISUAL</div>}
          </div>
          <div className="boot-grid" />
        </div>
      )}

      {needsOnboarding && <Onboarding onDone={() => {
        void zaraRuntime.providers.configuredProviders().finally(() => setNeedsOnboarding(false));
      }} />}

      {/* ---------- stage ---------- */}
      <div className="stage">
        <div className="stage-orb" />
        <canvas ref={livingRef} className="stage-living" />
        <div className="avatar-stack">
          <canvas ref={canvasRef} style={{ display: avatarError ? "block" : "none" }} />
          <canvas ref={vrmCanvasRef} style={{ display: avatarError ? "none" : "block" }} />
        </div>

        {/* camera controls */}
        <div className="cam-dock">
          <div className="cam-row">
            <button className={`cam-chip ${eyeTracking ? "on" : ""}`} onClick={toggleEyeTracking}>
              {eyeTracking ? "EYES LIVE" : "EYES AUTO"}
            </button>
            <button className={`cam-chip ${viewLocked ? "lock" : ""}`} onClick={toggleViewLock}>
              {viewLocked ? "VIEW LOCKED" : "VIEW FREE"}
            </button>
          </div>
          <div className="cam-row">
            {(["portrait", "front", "threeQuarter", "side", "back", "full"] as CameraView[]).map(v => (
              <button key={v} className={`cam-view ${cameraView === v ? "on" : ""}`} onClick={() => applyCamera(v)}>
                {v === "threeQuarter" ? "¾" : v === "portrait" ? "BUST" : v.toUpperCase()}
              </button>
            ))}
          </div>
          <div className="cam-hint">DRAG ROTATE · PINCH ZOOM · DOUBLE-TAP RESET</div>
        </div>

        {/* emotion + perception readout */}
        <div className="stage-caption">
          <span className="mood">{theme.label}</span>
          <span className="sep">·</span>
          <span className="perc">{perceptionLine || "perception starting…"}</span>
        </div>
      </div>

      {/* ---------- HUD top bar ---------- */}
      <div className="hud">
        <div className="hud-brand">
          <span className="logo-dot" />
          ZARA
        </div>
        <div className="state-chip" style={{ ["--hud" as string]: hudColor }}>
          <span className="dot" />
          {STATE_LABELS[state]}
        </div>
        {listening && <div className="state-chip live"><span className="dot" />LIVE VOICE</div>}
        <div className="hud-chips">
          <div className={`chip ${nativeOnline === null ? "" : nativeOnline ? "ok" : "dim"}`}>
            <span className="chip-dot" />{nativeOnline === null ? "WEB" : nativeOnline ? "CORE ONLINE" : "WEB PREVIEW"}
          </div>
          <div className="chip ok"><span className="chip-dot" />MEM-LINK ACTIVE</div>
        </div>
        <div className="hud-spacer" />
        {zaraRuntime.isQuiet ? (
          <button className="hud-btn active" title="Exit quiet mode" onClick={() => zaraRuntime.exitQuietMode()}><Icon.bellOff /></button>
        ) : (
          <button className="hud-btn" title="Quiet mode (no proactive speech)" onClick={() => zaraRuntime.enterQuietMode()}><Icon.bellOff /></button>
        )}
        <button
          className={`hud-btn ${state === "SLEEPING" ? "active" : ""}`}
          title={state === "SLEEPING" ? "Wake ZARA" : "Sleep (low activity)"}
          onClick={() => (state === "SLEEPING" ? zaraRuntime.wake() : zaraRuntime.enterSleep())}
        >
          <Icon.moon />
        </button>
      </div>

      {/* ---------- latest message toast (chat panel closed) ---------- */}
      {panel !== "chat" && lastZaraMsg?.text && (
        <div className="toast" onClick={() => setPanel("chat")}>
          <span className="toast-who">ZARA</span>
          <span className="toast-text">{lastZaraMsg.text}</span>
        </div>
      )}

      {/* ---------- composer dock ---------- */}
      <div className="dock">
        {confirmQ && (
          <div className="confirm-card">
            <div className="q">{confirmQ.summary}</div>
            <div className="row">
              <button className="yes" onClick={() => answerConfirm(true)}>YES, GO AHEAD</button>
              <button className="no" onClick={() => answerConfirm(false)}>NO</button>
            </div>
          </div>
        )}
        <div className="composer">
          <button
            className={`mic-orb ${listening ? "listening" : ""} ${state === "LISTENING" ? "hot" : ""}`}
            title={listening ? "End voice session" : "Start live voice session"}
            onClick={toggleVoice}
          >
            <span className="orb-ring" />
            <Icon.mic />
          </button>
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && send()}
            placeholder={zaraRuntime.isQuiet ? "Quiet mode — ZARA won't speak proactively" : "Message ZARA…"}
            disabled={busy}
          />
          {state === "SPEAKING" ? (
            <button className="stop-btn" onClick={interrupt}>STOP</button>
          ) : (
            <button className="send-btn" onClick={() => send()} disabled={busy || !input.trim()}>
              <Icon.send />
            </button>
          )}
        </div>
      </div>

      {/* ---------- slide-over panels ---------- */}
      <aside className={`panel ${panel ? "open" : ""}`}>
        {panel && (
          <>
            <div className="panel-head">
              <span className="panel-title">
                {panel === "chat" ? "CONVERSATION" : panel === "memory" ? "MEMORY CORE" : panel === "settings" ? "SETTINGS" : "DIAGNOSTICS"}
              </span>
              <button className="panel-close" onClick={() => setPanel(null)}><Icon.x /></button>
            </div>
            <div className="panel-body">
              {panel === "chat" && (
                <>
                  {msgs.length === 0 && (
                    <div className="empty-state">
                      <div className="empty-title">TALK TO ZARA</div>
                      <div className="empty-sub">Type below, tap the mic for live voice, or try a quick action.</div>
                      <div className="quick-grid">
                        {QUICK_ACTIONS.map(qa => (
                          <button key={qa.label} className="quick-chip" onClick={() => send(qa.hint)}>
                            {qa.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {msgs.map((m, i) => (
                    <div className={`msg ${m.who}`} key={i}>
                      <div className="who">{m.who === "user" ? "YOU" : "ZARA"}</div>
                      <div className="bubble">{m.text}</div>
                    </div>
                  ))}
                  {busy && (
                    <div className="msg zara">
                      <div className="who">ZARA</div>
                      <div className="bubble thinking">
                        <span /><span /><span />
                      </div>
                    </div>
                  )}
                  <div ref={streamEndRef} />
                </>
              )}
              {panel === "memory" && <MemoryPanel />}
              {panel === "settings" && <SettingsPanel />}
              {panel === "diagnostics" && <DiagnosticsPanel />}
            </div>
          </>
        )}
      </aside>

      {panel && <div className="panel-scrim" onClick={() => setPanel(null)} />}

      {/* ---------- panel launcher rail ---------- */}
      <div className="rail">
        <button className={`rail-btn ${panel === "chat" ? "on" : ""}`} title="Conversation" onClick={() => setPanel(panel === "chat" ? null : "chat")}>
          <Icon.send /><span>CHAT</span>
        </button>
        <button className={`rail-btn ${panel === "memory" ? "on" : ""}`} title="Memory core" onClick={() => setPanel(panel === "memory" ? null : "memory")}>
          <Icon.brain /><span>MEMORY</span>
        </button>
        <button className={`rail-btn ${panel === "settings" ? "on" : ""}`} title="Settings" onClick={() => setPanel(panel === "settings" ? null : "settings")}>
          <Icon.settings /><span>SETTINGS</span>
        </button>
        <button className={`rail-btn ${panel === "diagnostics" ? "on" : ""}`} title="Diagnostics" onClick={() => setPanel(panel === "diagnostics" ? null : "diagnostics")}>
          <Icon.activity /><span>CORE</span>
        </button>
      </div>
    </div>
  );
}

// Tool risk reference for the settings/diagnostics display.
export const TOOL_RISK_TABLE = buildAndroidTools().map(t => ({ name: t.name, risk: t.risk }));
