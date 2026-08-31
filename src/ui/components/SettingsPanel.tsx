/**
 * ZARA V2.1 — Settings panel.
 *
 * Consumer-grade settings: five clear groups, plain-language descriptions,
 * consistent rows, honest explanations. No internal jargon, no section refs.
 */
import { useState } from "react";
import { zaraRuntime } from "../../ZaraRuntime";
import { ZaraSettings } from "../../core/configuration/Settings";
import { openAccessibilitySettings } from "../../native/ScreenAwareness";
import { Icon } from "./Icons";

/* ---------- small building blocks ---------- */

function SettingRow(props: {
  label: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="set-row">
      <div className="set-text">
        <div className="set-label">{props.label}</div>
        {props.sub && <div className="set-sub">{props.sub}</div>}
      </div>
      <div className="set-ctrl">{props.children}</div>
    </div>
  );
}

function Section(props: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <>
      <div className="section-title">{props.title}</div>
      {props.sub && <div className="set-section-sub">{props.sub}</div>}
      <div className="card">{props.children}</div>
    </>
  );
}

const inputCls = "set-input";

/* ---------- panel ---------- */

export default function SettingsPanel() {
  const [s, setS] = useState<ZaraSettings>({ ...zaraRuntime.settings.current });
  const [savedFlash, setSavedFlash] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [keyBusy, setKeyBusy] = useState(false);
  const [keySaved, setKeySaved] = useState(false);
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
      setKeySaved(true);
      setTimeout(() => setKeySaved(false), 1600);
    } finally { setKeyBusy(false); }
  }

  return (
    <div>
      {/* ---------------- AI connection ---------------- */}
      <Section title="AI connection" sub="The brain ZARA thinks with. Google Gemini is the default — keys stay on this device.">
        <SettingRow label="AI provider" sub="Gemini is the primary brain. Others are fully optional.">
          <select value={s.providerId} onChange={e => patch({ providerId: e.target.value })} className={inputCls}>
            <option value="gemini">Google Gemini</option>
            <option value="openai-compat">OpenAI-compatible</option>
            <option value="glm">GLM (Z.ai)</option>
          </select>
        </SettingRow>

        {s.providerId === "gemini" && (
          <>
            <SettingRow label="Chat model" sub="Which Gemini answers you.">
              <input value={s.chatModel} onChange={e => patch({ chatModel: e.target.value })} className={inputCls} />
            </SettingRow>
            <SettingRow label="Live voice model" sub="Used for real-time voice sessions.">
              <input value={s.liveModel} onChange={e => patch({ liveModel: e.target.value })} className={inputCls} />
            </SettingRow>
            <SettingRow label="Voice" sub="The voice she speaks with.">
              <input value={s.voiceName} onChange={e => patch({ voiceName: e.target.value })} className={inputCls} />
            </SettingRow>
            <SettingRow label="API address" sub="Optional. Leave empty for Google's official endpoint.">
              <input value={s.geminiBaseUrl} onChange={e => patch({ geminiBaseUrl: e.target.value })} className={inputCls} placeholder="Default (Google)" />
            </SettingRow>
          </>
        )}
        {s.providerId === "glm" && (
          <>
            <SettingRow label="API address" sub="Where GLM requests are sent.">
              <input value={s.glmBaseUrl} onChange={e => patch({ glmBaseUrl: e.target.value })} className={inputCls} />
            </SettingRow>
            <SettingRow label="Model" sub="Which GLM model answers you.">
              <input value={s.glmModel} onChange={e => patch({ glmModel: e.target.value })} className={inputCls} />
            </SettingRow>
            <SettingRow label="Deeper thinking" sub="Slower, more thorough reasoning.">
              <button className={`toggle ${s.glmThinking ? "on" : ""}`} onClick={() => patch({ glmThinking: !s.glmThinking })} />
            </SettingRow>
          </>
        )}
        {s.providerId === "openai-compat" && (
          <>
            <SettingRow label="API address" sub="Your OpenAI-compatible endpoint.">
              <input value={s.openaiBaseUrl} onChange={e => patch({ openaiBaseUrl: e.target.value })} className={inputCls} />
            </SettingRow>
            <SettingRow label="Model" sub="Which model answers you.">
              <input value={s.openaiModel} onChange={e => patch({ openaiModel: e.target.value })} className={inputCls} />
            </SettingRow>
          </>
        )}

        <div className="set-key">
          <input
            type="password"
            placeholder="Replace API key…"
            value={keyInput}
            onChange={e => setKeyInput(e.target.value)}
            className={inputCls}
            onKeyDown={e => e.key === "Enter" && saveKey()}
          />
          <button className="send-btn set-key-btn" disabled={keyBusy} onClick={saveKey}>
            {keyBusy ? "…" : <Icon.key />}
          </button>
        </div>
        <div className="set-note">
          {keySaved
            ? "Key saved. It stays on this device and is never shown again."
            : "Keys are stored on this device only, never uploaded, never displayed again."}
        </div>
      </Section>

      {/* ---------------- Companion behaviour ---------------- */}
      <Section title="Companion behaviour" sub="How ZARA acts, speaks up, and keeps you company.">
        <SettingRow label="Speak up on her own" sub="Greeting you, following up on things — only when it's genuinely worth it.">
          <button className={`toggle ${s.proactivityEnabled ? "on" : ""}`} onClick={() => patch({ proactivityEnabled: !s.proactivityEnabled })} />
        </SettingRow>
        <SettingRow label={`How sure she must be (${s.proactivityThreshold.toFixed(2)})`} sub="Higher = she speaks up only when it really matters.">
          <input
            type="range" min={0.3} max={0.95} step={0.01}
            value={s.proactivityThreshold}
            onChange={e => patch({ proactivityThreshold: Number(e.target.value) })}
            className="set-range"
          />
        </SettingRow>
        <SettingRow label="Quiet time between" sub="Minutes she waits before speaking up again.">
          <input type="number" min={1} max={120} value={s.proactivityCooldownMin}
            onChange={e => patch({ proactivityCooldownMin: Math.max(1, Number(e.target.value) || 10) })} className={`${inputCls} set-num`} />
        </SettingRow>
        <SettingRow label="Daily limit" sub="Most times she'll speak up unprompted per day.">
          <input type="number" min={1} max={60} value={s.proactivityDailyLimit}
            onChange={e => patch({ proactivityDailyLimit: Math.max(1, Number(e.target.value) || 12) })} className={`${inputCls} set-num`} />
        </SettingRow>
        <SettingRow label="Ask less for repeats" sub="If you approve the same action twice (like messaging the same person), she stops re-asking for 10 minutes. Off by default.">
          <button className={`toggle ${s.rememberApprovals ? "on" : ""}`} onClick={() => patch({ rememberApprovals: !s.rememberApprovals })} />
        </SettingRow>
        <SettingRow label="Sleep when idle" sub={`Minutes of quiet before she dozes off (0 = never).`}>
          <input type="number" min={0} max={240} value={s.autoSleepMinutes}
            onChange={e => patch({ autoSleepMinutes: Math.max(0, Number(e.target.value) || 0) })} className={`${inputCls} set-num`} />
        </SettingRow>
        <SettingRow label="Language" sub="She mirrors how you speak.">
          <select value={s.language} onChange={e => patch({ language: e.target.value as ZaraSettings["language"] })} className={inputCls}>
            <option value="auto">Auto / Hinglish</option>
            <option value="en">English</option>
            <option value="hi">Hindi</option>
          </select>
        </SettingRow>
        <SettingRow label="Animated avatar" sub="Turn off for a simpler, lighter presence.">
          <button className={`toggle ${s.animations ? "on" : ""}`} onClick={() => patch({ animations: !s.animations })} />
        </SettingRow>
      </Section>

      {/* ---------------- Privacy & awareness ---------------- */}
      <Section title="Privacy & awareness" sub="ZARA only notices what you allow. Every switch is real — turning something off disables it for real.">
        <SettingRow label="App awareness" sub="Notices when you come and go between apps.">
          <button className={`toggle ${s.appAwareness ? "on" : ""}`} onClick={() => patch({ appAwareness: !s.appAwareness })} />
        </SettingRow>
        <SettingRow label="Screen awareness" sub="Which app you're using right now. Off by default.">
          <button className={`toggle ${s.screenAwareness ? "on" : ""}`} onClick={() => patch({ screenAwareness: !s.screenAwareness })} />
        </SettingRow>
        {s.screenAwareness && (
          <div className="set-deep">
            <div className="set-deep-txt">
              With screen awareness on, ZARA can notice <b>which app you're using and its title</b> — nothing
              more. No screenshots, no reading content, no passwords. Android requires you to also enable
              the "ZARA Screen Awareness" accessibility service yourself — ZARA never bypasses that.
            </div>
            <div className="set-deep-status">{screenStatus || "After enabling, check the System tab to confirm it's working."}</div>
            <button
              className="ghost-btn"
              style={{ marginTop: 8, height: 36, padding: 0 }}
              onClick={async () => {
                const ok = await openAccessibilitySettings();
                setScreenStatus(ok
                  ? "Opened Android accessibility settings — enable \"ZARA Screen Awareness\" there, then come back."
                  : "Accessibility settings are only available in the Android app.");
              }}
            >
              Open Android accessibility settings
            </button>
          </div>
        )}
        <SettingRow label="Memory" sub="Remembering you between sessions.">
          <button className={`toggle ${s.memoryEnabled ? "on" : ""}`} onClick={() => patch({ memoryEnabled: !s.memoryEnabled })} />
        </SettingRow>
        <SettingRow label="Cloud thinking" sub="Sends your messages to the AI provider to think.">
          <button className={`toggle ${s.cloudReasoning ? "on" : ""}`} onClick={() => patch({ cloudReasoning: !s.cloudReasoning })} />
        </SettingRow>
        <SettingRow label="Voice" sub="Speech recognition and speaking.">
          <button className={`toggle ${s.voiceEnabled ? "on" : ""}`} onClick={() => patch({ voiceEnabled: !s.voiceEnabled })} />
        </SettingRow>
        <SettingRow label="Diagnostics logging" sub="Extra technical logs. Errors are always kept.">
          <button className={`toggle ${s.diagnosticsEnabled ? "on" : ""}`} onClick={() => patch({ diagnosticsEnabled: !s.diagnosticsEnabled })} />
        </SettingRow>
      </Section>

      {/* ---------------- Background ---------------- */}
      <Section title="Background & battery" sub="Keep ZARA gently running when you switch away.">
        <SettingRow label="Keep running in background" sub="Shows a quiet notification so she stays alive — opt-in, off by default.">
          <button className={`toggle ${s.keepAliveInBackground ? "on" : ""}`} onClick={() => patch({ keepAliveInBackground: !s.keepAliveInBackground })} />
        </SettingRow>
        <div className="set-note">
          Honest limits: Android may still stop her under memory pressure or in deep sleep — but reminders
          you set always survive, even restarts. Off by default to respect battery.
        </div>
      </Section>

      {/* ---------------- Weather ---------------- */}
      <Section title="Weather" sub="So she knows your sky.">
        <SettingRow label="Your city" sub="Leave empty and she'll just ask.">
          <input value={s.weatherLocation} placeholder="e.g. Delhi"
            onChange={e => patch({ weatherLocation: e.target.value })} className={inputCls} />
        </SettingRow>
        <div className="set-note">Used only for weather. No location tracking, ever.</div>
      </Section>

      {savedFlash && <div className="set-saved">Saved</div>}
    </div>
  );
}
