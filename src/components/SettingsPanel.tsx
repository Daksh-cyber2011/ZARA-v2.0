/**
 * MYRAA — Settings panel (Myraa Configuration).
 * Voice & microphone, wake word, startup & appearance, desktop agent health,
 * diagnostics logs and API-key replacement live here. Every control is real:
 * wake word persists locally, autoStart relays to the OS via the agent.
 */
import { useCallback, useEffect, useState } from "react";
import type { MyraaSettings } from "../lib/settings";
import { THEME_NAMES, type ThemeName } from "../lib/themes";

interface ToggleProps {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}

function Toggle({ label, description, checked, onChange }: ToggleProps) {
  return (
    <button
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      className="flex w-full items-center justify-between rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3 text-left transition hover:border-white/15"
    >
      <span className="space-y-0.5">
        <span className="block text-[10px] font-mono uppercase tracking-widest text-slate-200">{label}</span>
        <span className="block text-[11px] text-slate-500">{description}</span>
      </span>
      <span
        className={`relative h-5 w-9 shrink-0 rounded-full transition ${
          checked ? "bg-emerald-500/80" : "bg-white/10"
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
            checked ? "left-[1.15rem]" : "left-0.5"
          }`}
        />
      </span>
    </button>
  );
}

interface AgentHealth {
  online: boolean;
  tool_count?: number;
}

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  settings: MyraaSettings;
  update: (patch: Partial<MyraaSettings>) => void;
  hasApiKey: boolean;
  onReplaceKey: () => void;
}

export function SettingsPanel({ open, onClose, settings, update, hasApiKey, onReplaceKey }: SettingsPanelProps) {
  const [agentHealth, setAgentHealth] = useState<AgentHealth>({ online: false });
  const [logLines, setLogLines] = useState<string[]>([]);
  const [logFile, setLogFile] = useState<string>("errors");

  const refreshHealth = useCallback(async () => {
    try {
      const response = await fetch("/api/agent-health");
      const data = (await response.json()) as AgentHealth;
      setAgentHealth({ online: Boolean(data.online), tool_count: data.tool_count });
    } catch {
      setAgentHealth({ online: false });
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void refreshHealth();
    const timer = setInterval(() => void refreshHealth(), 10_000);
    return () => clearInterval(timer);
  }, [open, refreshHealth]);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      try {
        const response = await fetch(`/api/logs/${logFile}`);
        const data = (await response.json()) as { lines?: string[] };
        setLogLines((data.lines || []).slice(-40));
      } catch {
        setLogLines([]);
      }
    })();
  }, [open, logFile]);

  if (!open) return null;

  return (
    <div className="absolute inset-0 z-40 flex justify-end bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="myraa-panel myraa-scroll m-4 w-[420px] max-w-[94vw] overflow-y-auto p-6 space-y-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-white">Myraa Configuration</h2>
          <button
            onClick={onClose}
            className="rounded-lg border border-white/10 px-3 py-1 text-xs text-slate-300 hover:bg-white/10"
          >
            Close
          </button>
        </div>

        {/* Voice & microphone */}
        <section className="space-y-3">
          <p className="text-[10px] font-mono uppercase tracking-widest text-slate-500">
            Gemini Voice &amp; Microphone
          </p>
          <Toggle
            label="WAKE WORD"
            description="Always-listen for the activation phrase"
            checked={settings.wakeWordEnabled}
            onChange={(value) => update({ wakeWordEnabled: value })}
          />
          {settings.wakeWordEnabled && (
            <div className="space-y-1.5">
              <label className="block text-[10px] font-mono tracking-wider text-slate-300 uppercase">
                Wake Phrase
              </label>
              <input
                type="text"
                value={settings.wakePhrase}
                onChange={(event) => update({ wakePhrase: event.target.value })}
                placeholder="hey myraa"
                className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/60"
              />
              <p className="text-[11px] text-slate-500">Say this phrase to activate Myraa</p>
            </div>
          )}
          <div className="space-y-1.5">
            <label className="flex items-center justify-between text-[10px] font-mono tracking-wider text-slate-300 uppercase">
              <span>Sensitivity</span>
              <span className="text-slate-500">{Math.round(settings.micSensitivity * 100)}%</span>
            </label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={settings.micSensitivity}
              onChange={(event) => update({ micSensitivity: Number(event.target.value) })}
              className="w-full accent-cyan-400"
            />
          </div>
          <div className="rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3">
            <p className="text-[10px] font-mono uppercase tracking-widest text-slate-300">Gemini API key</p>
            <p className="mt-1 text-[11px] text-slate-500">
              {hasApiKey ? "Configured — stored securely by the local MYRAA backend." : "Not configured."}
            </p>
            <button
              onClick={onReplaceKey}
              className="mt-2 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-1 text-[11px] text-amber-300 hover:bg-amber-500/20"
            >
              {hasApiKey ? "Enter a new key to replace it" : "Paste Gemini API key"}
            </button>
          </div>
        </section>

        {/* Startup & appearance */}
        <section className="space-y-3">
          <p className="text-[10px] font-mono uppercase tracking-widest text-slate-500">Startup &amp; Appearance</p>
          <Toggle
            label="LAUNCH AT STARTUP"
            description="Start Myraa silently when Windows logs in"
            checked={settings.autoStart}
            onChange={(value) => update({ autoStart: value })}
          />
          {settings.autoStart && (
            <p className="rounded-xl border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-[11px] text-amber-200">
              Myraa will auto-launch on next Windows login.
            </p>
          )}
          <Toggle
            label="UI ANIMATIONS"
            description="Enable motion and orb transitions"
            checked={settings.animations}
            onChange={(value) => update({ animations: value })}
          />
          <div className="space-y-2">
            <p className="text-[10px] font-mono tracking-wider text-slate-300 uppercase">Atmosphere</p>
            <p className="text-[11px] text-slate-500">Shifts theme color background</p>
            <div className="flex flex-wrap gap-2">
              {THEME_NAMES.map((theme) => (
                <button
                  key={theme}
                  onClick={() => update({ theme: theme as ThemeName })}
                  className={`rounded-full border px-3 py-1 text-[11px] capitalize transition ${
                    settings.theme === theme
                      ? "border-cyan-400 bg-cyan-400/10 text-cyan-300"
                      : "border-white/10 text-slate-400 hover:border-white/30"
                  }`}
                >
                  {theme}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Desktop control agent */}
        <section className="space-y-3">
          <p className="text-[10px] font-mono uppercase tracking-widest text-slate-500">Desktop Control Agent</p>
          <div className="flex items-center justify-between rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3">
            <div>
              <p className="text-[10px] font-mono uppercase tracking-widest text-slate-300">FastAPI Agent</p>
              <p className="text-[11px] text-slate-500">Start the Python agent on port 8765</p>
            </div>
            <span
              className={`myraa-chip ${
                agentHealth.online
                  ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
                  : "border-rose-500/30 bg-rose-500/10 text-rose-400"
              }`}
            >
              {agentHealth.online ? `Agent Online · ${agentHealth.tool_count ?? 0} tools` : "Agent Offline"}
            </span>
          </div>
          <p className="text-[11px] leading-relaxed text-slate-500">
            Uses your real PC browser and mouse. Combines tools &amp; voice with observe → act → verify
            loops and confirmation gates for dangerous actions.
          </p>
        </section>

        {/* Diagnostics */}
        <section className="space-y-3">
          <p className="text-[10px] font-mono uppercase tracking-widest text-slate-500">Diagnostics</p>
          <div className="flex gap-2">
            {["commands", "startup", "errors", "cognition"].map((file) => (
              <button
                key={file}
                onClick={() => setLogFile(file)}
                className={`rounded-lg border px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider transition ${
                  logFile === file
                    ? "border-cyan-400 bg-cyan-400/10 text-cyan-300"
                    : "border-white/10 text-slate-400 hover:border-white/30"
                }`}
              >
                {file}
              </button>
            ))}
          </div>
          <div className="myraa-scroll max-h-44 overflow-y-auto rounded-xl border border-white/5 bg-black/40 p-3">
            {logLines.length === 0 ? (
              <p className="text-[11px] text-slate-600">No log entries yet.</p>
            ) : (
              <pre className="whitespace-pre-wrap break-all text-[10px] leading-relaxed text-slate-500">
                {logLines.join("\n")}
              </pre>
            )}
          </div>
        </section>

        <section className="space-y-2">
          <p className="text-[10px] font-mono uppercase tracking-widest text-slate-500">About Myraa</p>
          <p className="text-[11px] leading-relaxed text-slate-500">
            MYRAA AI Assistant — a private 3D AI desktop companion powered by your own Gemini API key.
            Sway Themes and Info: try “Myraa, change atmosphere of your core to crimson” or “Tell me a
            witty joke and change background to gold”.
          </p>
        </section>
      </div>
    </div>
  );
}
