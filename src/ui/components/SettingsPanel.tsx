/**
 * ZARA V1.0 — Settings panel. All ZARA behavior controls in one place.
 */
import { useState } from "react";
import { zaraRuntime } from "../../ZaraRuntime";
import { ZaraSettings } from "../../core/configuration/Settings";
import { openAccessibilitySettings } from "../../native/ScreenAwareness";

export default function SettingsPanel() {
  const [s, setS] = useState<ZaraSettings>({ ...zaraRuntime.settings.current });
  const [savedFlash, setSavedFlash] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [keyBusy, setKeyBusy] = useState(false);
  const [screenStatus, setScreenStatus] = useState<string>("");

  async function patch(p: Partial<ZaraSettings>) {
    const next = await zaraRuntime.settings.patch(p);
    setS({ ...next });
    zaraRuntime.providers.invalidate();
    zaraRuntime.applyProactivitySettings();
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 900);
  }

  async function saveKey() {
    if (!keyInput.trim()) return;
    setKeyBusy(true);
    try {
      const secretId = zaraRuntime.providers.secretIdFor(s.providerId);
      await zaraRuntime.secrets.set(secretId, keyInput.trim());
      zaraRuntime.providers.invalidate();
      setKeyInput("");
    } finally { setKeyBusy(false); }
  }

  return (
    <div>
      <div className="section-title">Brain / provider</div>
      <div className="card">
        <div className="row-between" style={{ marginBottom: 12 }}>
          <span className="label">Provider</span>
          <select
            value={s.providerId}
            onChange={e => patch({ providerId: e.target.value })}
            style={{ width: 190 }}
          >
            <option value="gemini">Google Gemini (primary)</option>
            <option value="openai-compat">OpenAI-compatible</option>
            <option value="glm">GLM — optional (Z.ai / BigModel)</option>
          </select>
        </div>
        {s.providerId === "gemini" ? (
          <>
            <div className="row-between" style={{ marginBottom: 12 }}>
              <span className="label">Chat model</span>
              <input value={s.chatModel} onChange={e => patch({ chatModel: e.target.value })} style={{ width: 190 }} />
            </div>
            <div className="row-between" style={{ marginBottom: 12 }}>
              <span className="label">Live voice model</span>
              <input value={s.liveModel} onChange={e => patch({ liveModel: e.target.value })} style={{ width: 190 }} />
            </div>
            <div className="row-between" style={{ marginBottom: 12 }}>
              <span className="label">Voice</span>
              <input value={s.voiceName} onChange={e => patch({ voiceName: e.target.value })} style={{ width: 190 }} />
            </div>
            <div className="row-between">
              <span className="label">API base URL <span style={{ color: "var(--text-faint)", fontSize: 11 }}>(optional — empty = Google's official endpoint)</span></span>
              <input value={s.geminiBaseUrl} onChange={e => patch({ geminiBaseUrl: e.target.value })} style={{ width: 190 }} placeholder="https://generativelanguage.googleapis.com" />
            </div>
          </>
        ) : s.providerId === "glm" ? (
          <>
            <div className="row-between" style={{ marginBottom: 12 }}>
              <span className="label">Base URL</span>
              <input value={s.glmBaseUrl} onChange={e => patch({ glmBaseUrl: e.target.value })} style={{ width: 190 }} />
            </div>
            <div className="row-between" style={{ marginBottom: 12 }}>
              <span className="label">Model</span>
              <input value={s.glmModel} onChange={e => patch({ glmModel: e.target.value })} style={{ width: 190 }} />
            </div>
            <div className="row-between">
              <span className="label">Thinking mode <span style={{ color: "var(--text-faint)", fontSize: 11 }}>(deeper reasoning, slower)</span></span>
              <button className={`toggle ${s.glmThinking ? "on" : ""}`} onClick={() => patch({ glmThinking: !s.glmThinking })} />
            </div>
            <div className="hint" style={{ marginTop: 8, fontSize: 11, color: "var(--text-faint)" }}>
              GLM is a fully optional alternate brain — ZARA never requires it.
            </div>
          </>
        ) : (
          <>
            <div className="row-between" style={{ marginBottom: 12 }}>
              <span className="label">Base URL</span>
              <input value={s.openaiBaseUrl} onChange={e => patch({ openaiBaseUrl: e.target.value })} style={{ width: 190 }} />
            </div>
            <div className="row-between">
              <span className="label">Model</span>
              <input value={s.openaiModel} onChange={e => patch({ openaiModel: e.target.value })} style={{ width: 190 }} />
            </div>
          </>
        )}
        <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
          <input
            type="password"
            placeholder="Replace API key…"
            value={keyInput}
            onChange={e => setKeyInput(e.target.value)}
            style={{ flex: 1 }}
          />
          <button className="send-btn" style={{ height: 42, padding: "0 16px" }} disabled={keyBusy} onClick={saveKey}>
            {keyBusy ? "Saving…" : "Save key"}
          </button>
        </div>
        <div className="hint" style={{ marginTop: 8, fontSize: 11, color: "var(--text-faint)" }}>
          Keys are stored on this device only and are never displayed again after saving.
        </div>
      </div>

      <div className="section-title">Proactivity</div>
      <div className="card">
        <div className="row-between" style={{ marginBottom: 12 }}>
          <span className="label">Proactive companion mode</span>
          <button className={`toggle ${s.proactivityEnabled ? "on" : ""}`} onClick={() => patch({ proactivityEnabled: !s.proactivityEnabled })} />
        </div>
        <div className="row-between" style={{ marginBottom: 12 }}>
          <span className="label">Speak threshold <b>{s.proactivityThreshold.toFixed(2)}</b></span>
          <input
            type="range" min={0.3} max={0.95} step={0.01}
            value={s.proactivityThreshold}
            onChange={e => patch({ proactivityThreshold: Number(e.target.value) })}
            style={{ width: 150, padding: 0, background: "transparent", border: "none" }}
          />
        </div>
        <div className="row-between" style={{ marginBottom: 12 }}>
          <span className="label">Cooldown (minutes)</span>
          <input type="number" min={1} max={120} value={s.proactivityCooldownMin}
            onChange={e => patch({ proactivityCooldownMin: Math.max(1, Number(e.target.value) || 10) })} style={{ width: 90 }} />
        </div>
        <div className="row-between">
          <span className="label">Daily proactive limit</span>
          <input type="number" min={1} max={60} value={s.proactivityDailyLimit}
            onChange={e => patch({ proactivityDailyLimit: Math.max(1, Number(e.target.value) || 12) })} style={{ width: 90 }} />
        </div>
      </div>

      <div className="section-title">Privacy & awareness (§11)</div>
      <div className="card">
        <div className="hint" style={{ marginBottom: 12, fontSize: 11, color: "var(--text-faint)" }}>
          ZARA only perceives what you allow. Every toggle is honest — switching
          something off disables it for real.
        </div>
        <div className="row-between" style={{ marginBottom: 12 }}>
          <span className="label">App awareness <span style={{ color: "var(--text-faint)", fontSize: 11 }}>(lifecycle-derived observations)</span></span>
          <button className={`toggle ${s.appAwareness ? "on" : ""}`} onClick={() => patch({ appAwareness: !s.appAwareness })} />
        </div>
        <div className="row-between" style={{ marginBottom: 8 }}>
          <span className="label">Screen awareness <span style={{ color: "var(--text-faint)", fontSize: 11 }}>(what app you're using — off by default)</span></span>
          <button className={`toggle ${s.screenAwareness ? "on" : ""}`} onClick={() => patch({ screenAwareness: !s.screenAwareness })} />
        </div>
        {s.screenAwareness && (
          <div style={{ marginBottom: 12, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12, lineHeight: 1.55 }}>
            <div style={{ marginBottom: 6 }}>
              With screen awareness on, ZARA can notice <b>which app you're using and the
              current screen's title</b> — nothing more. No screenshots, no OCR, no
              passwords, no content upload. You must also enable the
              "ZARA Screen Awareness" accessibility service in Android settings —
              ZARA stays honest about that permission and never bypasses it.
            </div>
            <div style={{ color: screenStatus ? "var(--text-faint)" : "var(--text-faint)", marginBottom: 8, fontSize: 11 }}>
              {screenStatus || "Capability status: check the Diagnostics tab after enabling."}
            </div>
            <button
              className="send-btn"
              style={{ height: 34, padding: "0 14px", fontSize: 12 }}
              onClick={async () => {
                const ok = await openAccessibilitySettings();
                setScreenStatus(ok
                  ? "Opened Android accessibility settings — enable \"ZARA Screen Awareness\" there, then come back."
                  : "Accessibility settings are only available on the Android app.");
              }}
            >
              Open Android accessibility settings
            </button>
          </div>
        )}
        <div className="row-between" style={{ marginBottom: 12 }}>
          <span className="label">Memory <span style={{ color: "var(--text-faint)", fontSize: 11 }}>(remember across sessions)</span></span>
          <button className={`toggle ${s.memoryEnabled ? "on" : ""}`} onClick={() => patch({ memoryEnabled: !s.memoryEnabled })} />
        </div>
        <div className="row-between" style={{ marginBottom: 12 }}>
          <span className="label">Cloud reasoning <span style={{ color: "var(--text-faint)", fontSize: 11 }}>(LLM calls)</span></span>
          <button className={`toggle ${s.cloudReasoning ? "on" : ""}`} onClick={() => patch({ cloudReasoning: !s.cloudReasoning })} />
        </div>
        <div className="row-between" style={{ marginBottom: 12 }}>
          <span className="label">Voice <span style={{ color: "var(--text-faint)", fontSize: 11 }}>(speech recognition & synthesis)</span></span>
          <button className={`toggle ${s.voiceEnabled ? "on" : ""}`} onClick={() => patch({ voiceEnabled: !s.voiceEnabled })} />
        </div>
        <div className="row-between" style={{ marginBottom: 12 }}>
          <span className="label">Diagnostics logging <span style={{ color: "var(--text-faint)", fontSize: 11 }}>(errors are always kept)</span></span>
          <button className={`toggle ${s.diagnosticsEnabled ? "on" : ""}`} onClick={() => patch({ diagnosticsEnabled: !s.diagnosticsEnabled })} />
        </div>
      </div>

      <div className="section-title">Background (§21)</div>
      <div className="card">
        <div className="row-between" style={{ marginBottom: 10 }}>
          <span className="label">Keep ZARA alive in background <span style={{ color: "var(--text-faint)", fontSize: 11 }}>(opt-in)</span></span>
          <button className={`toggle ${s.keepAliveInBackground ? "on" : ""}`} onClick={() => patch({ keepAliveInBackground: !s.keepAliveInBackground })} />
        </div>
        <div className="hint" style={{ fontSize: 11, color: "var(--text-faint)", lineHeight: 1.5 }}>
          Runs a visible, silent notification so the companion keeps running while
          the app is backgrounded, for as long as Android permits. Honest limits:
          Android may still stop the service under memory pressure or in deep
          Doze; reminders set with ZARA always survive (they also survive device
          restarts). Off by default to respect battery.
        </div>
      </div>

      <div className="section-title">Weather location (§47)</div>
      <div className="card">
        <div className="row-between" style={{ marginBottom: 8 }}>
          <span className="label">City <span style={{ color: "var(--text-faint)", fontSize: 11 }}>(blank = ZARA will ask)</span></span>
          <input value={s.weatherLocation} placeholder="e.g. Delhi"
            onChange={e => patch({ weatherLocation: e.target.value })} style={{ width: 190 }} />
        </div>
        <div className="hint" style={{ fontSize: 11, color: "var(--text-faint)" }}>
          Used only by the weather tool. No background location tracking.
        </div>
      </div>

      <div className="section-title">Behavior</div>
      <div className="card">
        <div className="row-between" style={{ marginBottom: 12 }}>
          <span className="label">Auto-sleep after idle (minutes, 0 = never)</span>
          <input type="number" min={0} max={240} value={s.autoSleepMinutes}
            onChange={e => patch({ autoSleepMinutes: Math.max(0, Number(e.target.value) || 0) })} style={{ width: 90 }} />
        </div>
        <div className="row-between" style={{ marginBottom: 12 }}>
          <span className="label">Language</span>
          <select value={s.language} onChange={e => patch({ language: e.target.value as ZaraSettings["language"] })} style={{ width: 150 }}>
            <option value="auto">Auto / Hinglish</option>
            <option value="en">English</option>
            <option value="hi">Hindi</option>
          </select>
        </div>
        <div className="row-between">
          <span className="label">Avatar animations</span>
          <button className={`toggle ${s.animations ? "on" : ""}`} onClick={() => patch({ animations: !s.animations })} />
        </div>
      </div>

      {savedFlash && <div style={{ color: "var(--green)", fontSize: 12.5, textAlign: "center", padding: 6 }}>Saved</div>}
    </div>
  );
}
