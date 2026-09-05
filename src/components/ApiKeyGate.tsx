/**
 * MYRAA — first-run API key gate.
 * Blocks the UI until a Gemini key is stored; the key is validated by the
 * backend (models.list) and stored in the per-user data dir, never returned.
 */
import { useState } from "react";

interface ApiKeyGateProps {
  onSaved: () => void;
}

export function ApiKeyGate({ onSaved }: ApiKeyGateProps) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const key = value.trim();
    if (!key) {
      setError("Paste your Gemini API key to continue.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/config/apikey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: key }),
      });
      const data = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) {
        setError(data.error || "Could not save the key.");
        return;
      }
      onSaved();
    } catch {
      setError("Could not reach the MYRAA backend.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="myraa-panel w-[440px] max-w-[92vw] p-7 space-y-5">
        <div className="space-y-1.5 text-center">
          <p className="text-[10px] font-mono uppercase tracking-[0.35em] text-cyan-300/80">
            Gemini API key
          </p>
          <h1 className="font-display text-2xl font-semibold text-white">Welcome to MYRAA</h1>
          <p className="text-xs leading-relaxed text-slate-400">
            Connect memory core to awaken my voice. Your key is stored securely by the local
            MYRAA backend and never leaves your machine.
          </p>
        </div>
        <div className="space-y-2">
          <input
            type="password"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submit();
            }}
            placeholder="Paste Gemini API key"
            className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-cyan-400/60"
            autoFocus
          />
          {error && <p className="text-xs text-rose-400">{error}</p>}
          <button
            onClick={() => void submit()}
            disabled={busy}
            className="w-full rounded-xl border border-white bg-white px-4 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-slate-200 disabled:opacity-50"
          >
            {busy ? "Saving..." : "Continue"}
          </button>
        </div>
        <div className="flex items-center justify-between text-[11px] text-slate-500">
          <span>Get a free key</span>
          <a
            href="https://aistudio.google.com/app/apikey"
            target="_blank"
            rel="noreferrer"
            className="text-cyan-300 hover:text-cyan-200"
          >
            View free
          </a>
        </div>
      </div>
    </div>
  );
}
