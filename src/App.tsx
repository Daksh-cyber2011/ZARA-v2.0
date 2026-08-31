/**
 * ZARA V2.1 — Main application shell.
 *
 * One adaptive interface, two presentations:
 *
 *  PHONE (portrait, narrow) — immersive single stage: ZARA fills the screen,
 *  a compact composer dock at the bottom, chat/memory/settings as a slide-over.
 *
 *  COMPANION (tablets ≥768px, desktop, landscape phones) — a persistent
 *  conversation column lives beside the stage, messenger-style, so the
 *  dialogue is ALWAYS visible on big screens instead of hidden in a drawer.
 *  Tabbed panel head replaces the floating rail.
 *
 * The layout switch is done in CSS (media queries) AND mirrored in JS
 * (useWideLayout) so React knows which content to render by default.
 *
 * The whole interface breathes with the REAL runtime state + emotion theme —
 * nothing is decorative.
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

type PanelId = "chat" | "memory" | "settings" | "diagnostics";

/** Humanized fallback boot lines — real stage lines arrive from diagnostics. */
const BOOT_STAGES = [
  "Warming up…",
  "Remembering what matters…",
  "Tuning my voice…",
  "Almost there…"
];

const QUICK_ACTIONS: { label: string; hint: string }[] = [
  { label: "Open YouTube", hint: "Open YouTube" },
  { label: "Remind me", hint: "Remind me tomorrow at 7pm to study" },
  { label: "Remember this", hint: "Remember that I'm building ZARA" },
  { label: "Be quiet", hint: "Zara, be quiet" }
];

const VIEW_LABELS: Record<CameraView, string> = {
  portrait: "Close-up",
  front: "Front",
  threeQuarter: "¾ view",
  side: "Side",
  back: "Back",
  full: "Full body"
};

const PANEL_TITLES: Record<PanelId, string> = {
  chat: "Chat",
  memory: "Memory",
  settings: "Settings",
  diagnostics: "System"
};

/* Media queries that enable the companion split layout. MUST match CSS. */
const WIDE_QUERY = "(min-width: 768px) and (min-height: 480px)";
const WIDE_LANDSCAPE_QUERY = "(min-width: 640px) and (max-height: 479px) and (orientation: landscape)";

/** Reactive viewport mode — true when the persistent chat column is shown. */
function useWideLayout(): boolean {
  const [wide, setWide] = useState(() => {
    try {
      return window.matchMedia(WIDE_QUERY).matches || window.matchMedia(WIDE_LANDSCAPE_QUERY).matches;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    const mqs = [window.matchMedia(WIDE_QUERY), window.matchMedia(WIDE_LANDSCAPE_QUERY)];
    const update = () => setWide(mqs[0].matches || mqs[1].matches);
    update();
    mqs.forEach(m => m.addEventListener("change", update));
    return () => mqs.forEach(m => m.removeEventListener("change", update));
  }, []);
  return wide;
}

export default function App() {
  const [booted, setBooted] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [state, setState] = useState<ZaraState>("BOOTING");
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [confirmQ, setConfirmQ] = useState<{ callId: string; tool: string; summary: string } | null>(null);
  const [panel, setPanel] = useState<PanelId | null>(null);
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
  const [camOpen, setCamOpen] = useState(false);
  const [nativeOnline, setNativeOnline] = useState<boolean | null>(null);

  const wide = useWideLayout();
  /* In companion mode the column is always mounted — chat is the default tab. */
  const activePanel: PanelId | null = panel ?? (wide ? "chat" : null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const vrmCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const livingRef = useRef<HTMLCanvasElement | null>(null);
  const avatarRef = useRef<AvatarRenderer | null>(null);
  const proceduralRef = useRef<ProceduralAvatarRenderer | null>(null);
  const vrmRef = useRef<VrmAvatarRenderer | null>(null);
  const livingRef2 = useRef<LivingLayer | null>(null);
  const streamEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  /* Composer never locks: typed messages queue naturally while ZARA thinks. */
  const busyRef = useRef(false);
  const queueRef = useRef<string[]>([]);

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
            setAvatarError(detail ?? "VRM unavailable — simplified presence");
            zaraRuntime.setAvatarStatus("procedural", detail ?? "VRM unavailable — simplified presence");
          }
        }
      });
      vrm.start(vrmCanvasRef.current);
      vrm.setState(zaraRuntime.sm.state);
      vrmRef.current = vrm;
    } else {
      // Animations disabled by the user (or no canvas): open immediately
      // with the procedural core visual — never a forever-boot.
      setAvatarError("Animations are off — using the simplified presence");
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
  }, [msgs, confirmQ, activePanel]);

  /* ------------------------------ actions -------------------------------- */

  /**
   * Send a message. The composer is NEVER disabled — if ZARA is mid-turn,
   * new messages queue and flow out as soon as she finishes. Typing while
   * she thinks is normal messenger behaviour, not an error state.
   */
  const send = useCallback(async (raw?: string) => {
    const text = (raw ?? input).trim();
    if (!text) return;
    setInput("");
    if (busyRef.current) {
      queueRef.current.push(text);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      const reply = await zaraRuntime.handleUserText(text);
      setMsgs(m => {
        const next = [...m];
        if (reply) next.push({ who: "zara", text: reply });
        return next;
      });
    } finally {
      busyRef.current = false;
      setBusy(false);
      const next = queueRef.current.shift();
      if (next) void send(next);
    }
  }, [input]);

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
    setCamOpen(false);
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

  const openPanel = useCallback((p: PanelId) => {
    setPanel(cur => (cur === p && !wide ? null : p));
  }, [wide]);

  /* ------------------------------ boot gate ------------------------------ */

  /* The stage canvases mount as soon as the runtime is up so the VRM model
   * starts loading immediately; the boot overlay floats ON TOP until the
   * character is ready, failed (→ procedural fallback), or timed out
   * (never a forever-boot: belt-and-braces). No chicken-and-egg between
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
          <div className="boot-sub">your AI companion</div>
          <div className="boot-progress">
            <div className="boot-bar"><div className="boot-fill" style={{ width: `${Math.round(bootRatio * 100)}%` }} /></div>
            <div className="boot-meta">
              <span>{bootStageLine || BOOT_STAGES[bootPhase] || "Warming up…"}</span>
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
    <div className={`app ${wide ? "wide" : ""}`} style={{ ["--z-primary" as string]: theme.primary, ["--z-secondary" as string]: theme.secondary }}>
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
            <div className="boot-sub">your AI companion</div>
            <div className="boot-progress">
              <div className="boot-bar"><div className="boot-fill" style={{ width: `${Math.round(bootRatio * 100)}%` }} /></div>
              <div className="boot-meta">
                <span>{bootStageLine || BOOT_STAGES[bootPhase] || "Warming up…"}</span>
                <span>{Math.round(bootRatio * 100)}%</span>
              </div>
            </div>
            {avatarError && <div className="boot-fallback">Taking a moment — opening with the simplified look</div>}
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

        {/* camera controls — one quiet button, expands when wanted */}
        <div className={`cam-wrap ${camOpen ? "open" : ""}`}>
          <button
            className={`cam-fab ${camOpen ? "on" : ""}`}
            title="Camera views"
            onClick={() => setCamOpen(o => !o)}
          >
            <Icon.camera />
          </button>
          {camOpen && (
            <div className="cam-pop">
              <div className="cam-pop-title">Camera</div>
              <div className="cam-grid">
                {(["portrait", "front", "threeQuarter", "side", "back", "full"] as CameraView[]).map(v => (
                  <button key={v} className={`cam-view ${cameraView === v ? "on" : ""}`} onClick={() => applyCamera(v)}>
                    {VIEW_LABELS[v]}
                  </button>
                ))}
              </div>
              <div className="cam-pop-row">
                <button className={`cam-chip ${eyeTracking ? "on" : ""}`} onClick={toggleEyeTracking}>
                  Eye contact {eyeTracking ? "on" : "off"}
                </button>
                <button className={`cam-chip ${viewLocked ? "lock" : ""}`} onClick={toggleViewLock}>
                  {viewLocked ? "View locked" : "Free view"}
                </button>
              </div>
              <div className="cam-hint">Drag to rotate · pinch to zoom · double-tap to reset</div>
            </div>
          )}
        </div>

        {/* mood + awareness readout */}
        <div className="stage-caption">
          <span className="mood">{theme.label}</span>
          <span className="sep">·</span>
          <span className="perc">{perceptionLine || "settling in…"}</span>
        </div>
      </div>

      {/* ---------- top bar ---------- */}
      <div className="hud">
        <div className="hud-brand">
          <span className="logo-dot" />
          ZARA
        </div>
        <div className="state-chip" style={{ ["--hud" as string]: hudColor }}>
          <span className="dot" />
          {STATE_LABELS[state]}
        </div>
        {listening && <div className="state-chip live"><span className="dot" />Voice live</div>}
        <div className="hud-chips">
          <div className={`chip ${nativeOnline ? "ok" : "dim"}`}>
            <span className="chip-dot" />{nativeOnline === null ? "Starting…" : nativeOnline ? "On device" : "Web preview"}
          </div>
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

      {/* ---------- latest message toast (chat not on screen) ---------- */}
      {activePanel !== "chat" && lastZaraMsg?.text && (
        <div className="toast" onClick={() => setPanel("chat")}>
          <span className="toast-who">ZARA</span>
          <span className="toast-text">{lastZaraMsg.text}</span>
        </div>
      )}

      {/* ---------- composer dock (bottom of stage on phone / bottom of chat column on companion) ---------- */}
      <div className="dock">
        {confirmQ && (
          <div className="confirm-card">
            <div className="q">{confirmQ.summary}</div>
            <div className="row">
              <button className="yes" onClick={() => answerConfirm(true)}>Yes, go ahead</button>
              <button className="no" onClick={() => answerConfirm(false)}>No</button>
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
          />
          {state === "SPEAKING" ? (
            <button className="stop-btn" onClick={interrupt}>STOP</button>
          ) : (
            <button className="send-btn" onClick={() => send()} disabled={!input.trim()}>
              <Icon.send />
            </button>
          )}
        </div>
      </div>

      {/* ---------- conversation column (slide-over on phone · persistent on companion) ---------- */}
      <aside className={`panel ${activePanel ? "open" : ""}`}>
        {activePanel && (
          <>
            {/* phone head: title + close / companion head: tabs */}
            <div className="panel-head">
              <span className="panel-title">{PANEL_TITLES[activePanel]}</span>
              <div className="panel-tabs">
                <button className={`tab ${activePanel === "chat" ? "on" : ""}`} onClick={() => setPanel("chat")}>
                  <Icon.send /><span>Chat</span>
                </button>
                <button className={`tab ${activePanel === "memory" ? "on" : ""}`} onClick={() => setPanel("memory")}>
                  <Icon.brain /><span>Memory</span>
                </button>
                <button className={`tab ${activePanel === "settings" ? "on" : ""}`} onClick={() => setPanel("settings")}>
                  <Icon.settings /><span>Settings</span>
                </button>
                <button className={`tab ${activePanel === "diagnostics" ? "on" : ""}`} onClick={() => setPanel("diagnostics")}>
                  <Icon.activity /><span>System</span>
                </button>
              </div>
              <button className="panel-close" onClick={() => setPanel(null)}><Icon.x /></button>
            </div>
            <div className="panel-body">
              {activePanel === "chat" && (
                <>
                  {msgs.length === 0 && (
                    <div className="empty-state">
                      <div className="empty-title">Say hi to ZARA</div>
                      <div className="empty-sub">Type below, tap the mic for live voice, or try one of these.</div>
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
                      <div className="who">{m.who === "user" ? "You" : "ZARA"}</div>
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
              {activePanel === "memory" && <MemoryPanel />}
              {activePanel === "settings" && <SettingsPanel />}
              {activePanel === "diagnostics" && <DiagnosticsPanel />}
            </div>
          </>
        )}
      </aside>

      {panel && !wide && <div className="panel-scrim" onClick={() => setPanel(null)} />}

      {/* ---------- panel launcher rail (phone only — companion uses tabs) ---------- */}
      <div className="rail">
        <button className={`rail-btn ${activePanel === "chat" ? "on" : ""}`} title="Chat" onClick={() => openPanel("chat")}>
          <Icon.send /><span>Chat</span>
        </button>
        <button className={`rail-btn ${activePanel === "memory" ? "on" : ""}`} title="Memory" onClick={() => openPanel("memory")}>
          <Icon.brain /><span>Memory</span>
        </button>
        <button className={`rail-btn ${activePanel === "settings" ? "on" : ""}`} title="Settings" onClick={() => openPanel("settings")}>
          <Icon.settings /><span>Settings</span>
        </button>
        <button className={`rail-btn ${activePanel === "diagnostics" ? "on" : ""}`} title="System" onClick={() => openPanel("diagnostics")}>
          <Icon.activity /><span>System</span>
        </button>
      </div>
    </div>
  );
}

// Tool risk reference for the settings/diagnostics display.
export const TOOL_RISK_TABLE = buildAndroidTools().map(t => ({ name: t.name, risk: t.risk }));
