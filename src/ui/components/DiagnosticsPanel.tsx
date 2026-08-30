/**
 * ZARA V1.0 — Diagnostics panel (Directive §37: VERY IMPORTANT).
 *
 * Two layers:
 *  1. Structured status snapshot — runtime state, provider, voice, memory,
 *     perception, proactivity (WHY ZARA spoke / stayed silent, cooldown,
 *     momentum), last action + verification, last interruption.
 *  2. Event timeline — transitions, bus events, system log.
 *
 * No chain-of-thought — only system-level facts. No secrets ever.
 */
import { useEffect, useState } from "react";
import { zaraRuntime, RuntimeStatus } from "../../ZaraRuntime";
import { DiagnosticRecord } from "../../core/logging/Diagnostics";
import { StateTransition } from "../../core/state/states";

function fmtAgo(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

function fmtCooldown(ms: number): string {
  if (ms <= 0) return "ready";
  const s = Math.ceil(ms / 1000);
  if (s < 90) return `${s}s`;
  return `${Math.ceil(s / 60)}min`;
}

function Row({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="diag-line" style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
      <span style={{ color: "var(--text-faint)" }}>{label}</span>
      <span style={{ color: warn ? "var(--warn, #ffb347)" : "var(--text)", textAlign: "right" }}>{value}</span>
    </div>
  );
}

export default function DiagnosticsPanel() {
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [recs, setRecs] = useState<readonly DiagnosticRecord[]>([]);
  const [transitions, setTransitions] = useState<readonly StateTransition[]>([]);
  const [events, setEvents] = useState<readonly { name: string; at: number }[]>([]);

  useEffect(() => {
    const tick = () => {
      setStatus(zaraRuntime.statusSnapshot());
      setRecs(zaraRuntime.diag.tail(120));
      setTransitions([...zaraRuntime.sm.transitionHistory].slice(-25).reverse());
      setEvents(zaraRuntime.bus.recentEvents.slice(-20).reverse().map(e => ({ name: e.name, at: e.at })));
    };
    tick();
    const t = setInterval(tick, 1500);
    return () => clearInterval(t);
  }, []);

  return (
    <div>
      {/* ---------------------- 1. structured status ---------------------- */}
      <div className="section-title">Runtime status</div>
      <div className="card" style={{ padding: 10 }}>
        {status ? (
          <>
            <Row label="State" value={status.state + (status.quiet ? " · QUIET" : "") + (status.sleeping ? " · SLEEPING" : "")} />
            <Row label="Last transition"
              value={status.lastTransition ? `${status.lastTransition.from} → ${status.lastTransition.to} (${fmtAgo(Date.now() - status.lastTransition.at)})` : "—"} />
            <Row label="Current turn" value={status.turn} />
            <Row label="Provider"
              value={`${status.provider.id} · ${status.provider.model}`}
              warn={!status.provider.configured} />
            <Row label="Provider configured" value={status.provider.configured ? "yes" : "NO — add an API key"} warn={!status.provider.configured} />
            <Row label="Voice" value={`${status.voice.mode} · tts:${status.voice.ttsBackend} · queue:${status.voice.queueLength}${status.voice.speaking ? " · speaking" : ""}`} />
            <Row label="Avatar"
              value={status.avatar.mode === "vrm" ? "READY — VRM female character" : status.avatar.mode === "procedural" ? `FALLBACK — ${status.avatar.detail}` : "loading…"}
              warn={status.avatar.mode === "procedural"} />
            <Row label="Memory" value={status.memory.enabled ? `${status.memory.activeCount} active records` : "DISABLED (privacy)"} warn={!status.memory.enabled} />
            {status.perception.map((p, i) => <Row key={i} label={i === 0 ? "Perception" : " "} value={p} />)}
            {status.lastPerceptionEvent && (
              <Row label="Last perception event"
                value={`${status.lastPerceptionEvent.kind} · sig ${status.lastPerceptionEvent.significance} (${fmtAgo(Date.now() - status.lastPerceptionEvent.at)})`} />
            )}
            {status.screen && (
              <Row label="Screen (permitted)"
                value={`${status.screen.app} · ${status.screen.screenType} · ${status.screen.activity} (${fmtAgo(Date.now() - status.screen.at)})`} />
            )}
            <Row label="Tools registered" value={String(status.toolsCount)} />
            <Row label="Wake word" value={status.wakeWord} />
            {status.lastInterruption && (
              <Row label="Last interruption"
                value={`${status.lastInterruption.phase} · ${status.lastInterruption.reason} (${fmtAgo(Date.now() - status.lastInterruption.at)})`} />
            )}
            {status.lastAction && (
              <Row label="Last action"
                value={`${status.lastAction.tool} · ${status.lastAction.ok ? "ok" : "failed"} · ${status.lastAction.verification}`}
                warn={!status.lastAction.ok} />
            )}
          </>
        ) : (
          <div className="diag-line">gathering…</div>
        )}
      </div>

      {/* ---------------- 1a. boot record (§18/§19) ---------------------- */}
      <div className="section-title">Boot — stages, durations, degradations</div>
      <div className="card" style={{ padding: 10 }}>
        {status ? (
          <>
            <Row
              label="Boot"
              value={`${status.boot.complete ? "complete" : "in progress"} — ${status.boot.totalMs}ms${status.boot.degraded ? " · DEGRADED" : ""}`}
              warn={status.boot.degraded}
            />
            {status.boot.stages.map(s => {
              if (s.id === "BOOT_COMPLETE") return null;
              const label = s.id.split("_").map(w => w[0] + w.slice(1).toLowerCase()).join(" ");
              const value =
                s.status === "OK" ? `READY (${s.durationMs ?? 0}ms)` :
                s.status === "DEGRADED" ? `DEGRADED — ${s.error ?? s.fallback ?? ""}` :
                s.status === "FAILED" ? `FAILED — ${s.error ?? ""}` :
                s.status === "SKIPPED" ? `skipped — ${s.fallback ?? ""}` :
                s.status === "RUNNING" ? "starting…" : "pending";
              return <Row key={s.id} label={label} value={value} warn={s.status === "DEGRADED" || s.status === "FAILED"} />;
            })}
          </>
        ) : (
          <div className="diag-line">gathering…</div>
        )}
      </div>

      {/* ------------------ 1b. capability states (§4) ------------------- */}
      <div className="section-title">Perception capabilities — real, not assumed</div>
      <div className="card" style={{ padding: 10 }}>
        {status ? (
          status.capabilities.map(c => (
            <div key={c.id} style={{ marginBottom: 8 }}>
              <Row
                label={c.label}
                value={c.state}
                warn={c.state === "permission_required"}
              />
              <div style={{ color: "var(--text-faint)", fontSize: 11, marginTop: 2 }}>{c.detail}</div>
            </div>
          ))
        ) : (
          <div className="diag-line">gathering…</div>
        )}
      </div>

      {/* ------------------------ 2. proactivity -------------------------- */}
      <div className="section-title">Proactivity — why ZARA speaks or stays silent</div>
      <div className="card" style={{ padding: 10 }}>
        {status ? (
          <>
            <Row label="Mode" value={status.proactivity.enabled ? "enabled" : "DISABLED"} warn={!status.proactivity.enabled} />
            <Row label="Utterances (24h)" value={`${status.proactivity.dailyCount} / ${status.proactivity.dailyLimit}`} />
            <Row label="Cooldown remaining" value={fmtCooldown(status.proactivity.cooldownRemainingMs)} />
            <Row label="Momentum (§30)"
              value={status.proactivity.momentum.multiplier > 1
                ? `backoff ×${status.proactivity.momentum.multiplier} (${status.proactivity.momentum.unacknowledged} unacknowledged)`
                : "normal"} />
            <Row label="Saved candidates" value={String(status.proactivity.savedCount)} />
            {status.proactivity.lastDecision ? (
              <div className="diag-line" style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid var(--border, rgba(255,255,255,0.08))" }}>
                <span className="cat">{fmtAgo(Date.now() - status.proactivity.lastDecision.at)}</span>{" "}
                <b>{status.proactivity.lastDecision.decision}</b>{" "}
                <span style={{ color: "var(--text-faint)" }}>
                  [{status.proactivity.lastDecision.category ?? status.proactivity.lastDecision.source}]
                </span>
                <div style={{ color: "var(--text-faint)", marginTop: 2 }}>
                  reason: {status.proactivity.lastDecision.reason}
                </div>
              </div>
            ) : (
              <div className="diag-line" style={{ color: "var(--text-faint)" }}>no candidates evaluated yet</div>
            )}
          </>
        ) : (
          <div className="diag-line">gathering…</div>
        )}
      </div>

      {/* ------------------------ 3. event timeline ----------------------- */}
      <div className="section-title">State machine (recent transitions)</div>
      <div className="card" style={{ padding: 10 }}>
        {transitions.length === 0 && <div className="diag-line">no transitions yet</div>}
        {transitions.map((t, i) => (
          <div className="diag-line" key={i}>
            <span className="cat">{new Date(t.at).toLocaleTimeString()}</span>{" "}
            {t.from} → <b style={{ color: "var(--accent)" }}>{t.to}</b>{" "}
            <span style={{ color: "var(--text-faint)" }}>({t.reason})</span>
          </div>
        ))}
      </div>

      <div className="section-title">Recent events</div>
      <div className="card" style={{ padding: 10 }}>
        {events.length === 0 && <div className="diag-line">no events yet</div>}
        {events.map((e, i) => (
          <div className="diag-line" key={i}>
            <span className="cat">{new Date(e.at).toLocaleTimeString()}</span> {e.name}
          </div>
        ))}
      </div>

      <div className="section-title">System log</div>
      <div className="card" style={{ padding: 10 }}>
        {recs.length === 0 && <div className="diag-line">empty</div>}
        {[...recs].reverse().map((r, i) => (
          <div className={`diag-line ${r.category === "error" ? "err" : ""}`} key={i}>
            <span className="cat">{new Date(r.at).toLocaleTimeString()} {r.category}</span>{" "}
            {r.event}{" "}
            {r.detail ? <span style={{ color: "var(--text-faint)" }}>{JSON.stringify(r.detail)}</span> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
