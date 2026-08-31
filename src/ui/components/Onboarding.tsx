/**
 * ZARA V1.0 — Onboarding (API key, provider choice).
 *
 * User-supplied keys only (§44): never bundled, never rendered back after
 * save, validated before storing. FINAL-INTEGRATION §1: Google Gemini is
 * the PRIMARY brain (bring a Gemini API key from aistudio.google.com).
 * GLM and any OpenAI-compatible endpoint remain fully OPTIONAL alternates —
 * GLM is never required and never the default.
 */
import { useState } from "react";
import { zaraRuntime } from "../../ZaraRuntime";
import { Icon } from "./Icons";

type Pick = "gemini" | "glm" | "openai";

const GLM_DEFAULT_URL = "https://api.z.ai/api/paas/v4";
const GLM_CN_URL = "https://open.bigmodel.cn/api/paas/v4";

export default function Onboarding({ onDone }: { onDone: () => void }) {
  const [pick, setPick] = useState<Pick>("gemini");
  const [key, setKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [skipOk, setSkipOk] = useState(false);

  async function save() {
    setError("");
    if (!key.trim()) { setError("Please paste your API key."); return; }
    setBusy(true);
    try {
      await zaraRuntime.settings.patch(
        pick === "glm"
          ? { providerId: "glm", glmBaseUrl: baseUrl.trim(), glmModel: model.trim() }
          : pick === "gemini"
            ? { providerId: "gemini" }
            : { providerId: "openai-compat", openaiBaseUrl: baseUrl.trim(), openaiModel: model.trim() }
      );
      await zaraRuntime.secrets.set(
        pick === "glm" ? "glm" : pick === "gemini" ? "gemini" : "openai",
        key.trim()
      );
      zaraRuntime.providers.invalidate();
      // Validate honestly — reject bad keys (LLM_AUTH_ERROR) with a clear message.
      const provider = zaraRuntime.providers.active();
      try {
        await provider.validateCredentials();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(`Key check failed: ${msg}`);
        setBusy(false);
        return;
      }
      setKey(""); // never keep the key in component state
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  }

  return (
    <div className="onboard">
      <div className="onboard-card">
        <h1>ZARA</h1>
        <div style={{ fontSize: 12, letterSpacing: "0.2em", color: "var(--text-faint)", marginBottom: 14 }}>
          First-time setup
        </div>
        <div className="sub">
          Your persistent AI companion. To think and speak, ZARA needs a brain —
          bring your own API key. It is stored only on this device and never sent anywhere else.
        </div>

        <div className="section-title">Choose a provider</div>
        <div className="provider-pick">
          <button className={pick === "gemini" ? "sel" : ""} onClick={() => setPick("gemini")}>
            <div className="t">Google Gemini — recommended</div>
            <div className="d">ZARA's primary brain. Free key from aistudio.google.com. Also powers optional live two-way voice conversation + tools.</div>
          </button>
          <button className={pick === "openai" ? "sel" : ""} onClick={() => { setPick("openai"); setBaseUrl("https://api.openai.com/v1"); setModel("gpt-4o-mini"); }}>
            <div className="t">OpenAI-compatible</div>
            <div className="d">Any /v1/chat/completions endpoint (OpenAI, Groq, Together, DeepSeek, local…).</div>
          </button>
          <button className={pick === "glm" ? "sel" : ""} onClick={() => { setPick("glm"); setBaseUrl(GLM_DEFAULT_URL); setModel("glm-5.2"); }}>
            <div className="t">GLM — optional</div>
            <div className="d">Optional alternate brain. Only pick this if you already have a z.ai / bigmodel.cn key. Never required.</div>
          </button>
        </div>

        <div className="section-title">API key <Icon.key className="" /></div>
        <input
          type="password"
          placeholder={pick === "glm" ? "your z.ai / bigmodel.cn key…" : pick === "gemini" ? "AIza…" : "sk-…"}
          value={key}
          onChange={e => setKey(e.target.value)}
          autoComplete="off"
          style={{ width: "100%" }}
        />

        {(pick === "glm" || pick === "openai") && (
          <>
            <div className="section-title">Endpoint</div>
            {pick === "glm" ? (
              <select value={baseUrl} onChange={e => setBaseUrl(e.target.value)} style={{ width: "100%" }}>
                <option value={GLM_DEFAULT_URL}>{GLM_DEFAULT_URL} (Z.ai international)</option>
                <option value={GLM_CN_URL}>{GLM_CN_URL} (BigModel China)</option>
                <option value="custom">Custom…</option>
              </select>
            ) : null}
            {pick === "glm" && baseUrl === "custom" && (
              <input value={baseUrl} onChange={e => setBaseUrl(e.target.value)} style={{ width: "100%", marginTop: 6 }} placeholder="https://…/api/paas/v4" />
            )}
            {pick === "openai" && (
              <input value={baseUrl} onChange={e => setBaseUrl(e.target.value)} style={{ width: "100%" }} placeholder="https://api.openai.com/v1" />
            )}
            <div className="section-title">Model</div>
            <input value={model} onChange={e => setModel(e.target.value)} style={{ width: "100%" }} placeholder={pick === "glm" ? "glm-5.2" : "gpt-4o-mini"} />
          </>
        )}

        <div className="hint">
          {pick === "gemini"
            ? "Gemini keys: aistudio.google.com/apikey (free tier available). ZARA uses your key directly from this device — no middle server, ever."
            : pick === "glm"
              ? "Optional GLM keys: z.ai (international) or open.bigmodel.cn (China mainland). ZARA calls the endpoint directly from this device — no middle server, ever."
              : "Point ZARA at any OpenAI-compatible endpoint. Your key stays on this device."}
        </div>
        <div className="err-msg">{error}</div>

        <button className="primary-btn" disabled={busy} onClick={save}>
          {busy ? "Validating…" : "Save and start"}
        </button>
        {skipOk ? (
          <button className="ghost-btn" onClick={onDone}>Continue without a key for now</button>
        ) : (
          <button className="ghost-btn" onClick={() => setSkipOk(true)}>I'll add a key later</button>
        )}
      </div>
    </div>
  );
}
