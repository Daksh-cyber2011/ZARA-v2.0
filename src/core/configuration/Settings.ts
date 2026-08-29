/**
 * ZARA V1.0 — Configuration: typed settings + secure secret storage.
 *
 * - Settings: user-visible preferences, persisted (Capacitor Preferences on
 *   Android, localStorage on web/tests).
 * - Secrets: API keys. Stored under a dedicated key namespace, NEVER rendered
 *   back to the UI (only `has()` booleans), NEVER injected into LLM prompts
 *   (providers read them at adapter level only). Directive §44.
 */

export interface ZaraSettings {
  /** Primary text/structured provider id ("gemini" | "glm" | "openai-compat").
   * FINAL-INTEGRATION §1: Google Gemini is the DEFAULT and first-class provider.
   * GLM is a completely optional alternate — never required, never default. */
  providerId: string;
  /** Optional Gemini API base-URL override (empty = Google's official endpoint).
   * Advanced/proxy use only; also enables honest end-to-end mock testing. */
  geminiBaseUrl: string;
  /** GLM base URL — OPTIONAL alternate provider (never required, §1). */
  glmBaseUrl: string;
  /** GLM model id — only used when the user explicitly selects GLM. */
  glmModel: string;
  /** GLM reasoning/thinking mode (off by default for voice latency). */
  glmThinking: boolean;
  /** Model for chat/structured tasks, e.g. "gemini-2.5-flash". */
  chatModel: string;
  /** Live voice model, e.g. "gemini-2.0-flash-live-001" (Gemini only). */
  liveModel: string;
  /** Voice name for live sessions. */
  voiceName: string;
  /** OpenAI-compatible base URL (for the openai-compat adapter). */
  openaiBaseUrl: string;
  /** Model name for the OpenAI-compatible adapter. */
  openaiModel: string;
  /** Proactivity master switch. */
  proactivityEnabled: boolean;
  /** Minimum score (0..1) for proactive speech. */
  proactivityThreshold: number;
  /** Minimum minutes between proactive utterances. */
  proactivityCooldownMin: number;
  /** Max proactive utterances per day. */
  proactivityDailyLimit: number;
  /** Auto-sleep after N minutes idle (0 = never). */
  autoSleepMinutes: number;
  /** §11 privacy toggles — the user always knows and controls what ZARA perceives. */
  appAwareness: boolean;        // app/lifecycle-derived proactive candidates
  memoryEnabled: boolean;       // long-term memory (store/retrieve/consolidate)
  cloudReasoning: boolean;      // LLM calls allowed at all (offline-privacy mode)
  diagnosticsEnabled: boolean;  // diagnostics logging (errors always kept)
  voiceEnabled: boolean;        // voice sessions (STT/TTS) allowed
  /** §24 screen awareness — OFF BY DEFAULT. Requires BOTH this toggle and
   * the Android accessibility service permission; structured app/screen
   * metadata only (never screenshots, never OCR, never uploads). */
  screenAwareness: boolean;
  /** §21 opt-in foreground service so the companion survives backgrounding
   * while Android permits it (persistent notification; battery-honest). */
  keepAliveInBackground: boolean;
  /** §47 user-configured weather location (city name; empty = ask/geo). */
  weatherLocation: string;
  /** UI language hint (affects prompts only, never forces output language). */
  language: "auto" | "en" | "hi";
  /** Master toggle for avatar animations. */
  animations: boolean;
  /** Wake phrase for manual activation (Android foreground). */
  wakePhrase: string;
}

export const DEFAULT_SETTINGS: ZaraSettings = {
  providerId: "gemini", // FINAL-INTEGRATION §1: Google Gemini is the PRIMARY provider
  geminiBaseUrl: "", // empty = official https://generativelanguage.googleapis.com
  glmBaseUrl: "https://api.z.ai/api/paas/v4", // alt: https://open.bigmodel.cn/api/paas/v4
  glmModel: "glm-5.2",
  glmThinking: false,
  chatModel: "gemini-2.5-flash",
  liveModel: "gemini-2.0-flash-live-001",
  voiceName: "Aoede",
  openaiBaseUrl: "https://api.openai.com/v1",
  openaiModel: "gpt-4o-mini",
  proactivityEnabled: true,
  proactivityThreshold: 0.62,
  proactivityCooldownMin: 10,
  proactivityDailyLimit: 12,
  autoSleepMinutes: 30,
  appAwareness: true,
  memoryEnabled: true,
  cloudReasoning: true,
  diagnosticsEnabled: true,
  voiceEnabled: true,
  screenAwareness: false, // §24: OFF by default — explicit user opt-in required
  keepAliveInBackground: false,
  weatherLocation: "",
  language: "auto",
  animations: true,
  wakePhrase: "zara"
};

const SETTINGS_KEY = "zara.settings.v1";

/** Storage adapter interface — swap for Capacitor Preferences on device. */
export interface KVStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

class LocalKV implements KVStorage {
  async get(key: string): Promise<string | null> { return localStorage.getItem(key); }
  async set(key: string, value: string): Promise<void> { localStorage.setItem(key, value); }
  async remove(key: string): Promise<void> { localStorage.removeItem(key); }
}

/** Minimal lazy Capacitor-Preferences bridge (avoids hard import at test time). */
class CapacitorKV implements KVStorage {
  private prefs: { get(k: string): Promise<{ value: string | null }>; set(k: string, v: string): Promise<void>; remove(k: string): Promise<void> } | null = null;
  private async load() {
    if (this.prefs) return this.prefs;
    try {
      const mod = (await import("@capacitor/preferences")) as unknown as {
        Preferences: { get(k: string): Promise<{ value: string | null }>; set(k: string, v: string): Promise<void>; remove(k: string): Promise<void> };
      };
      this.prefs = mod.Preferences;
    } catch {
      this.prefs = null;
    }
    return this.prefs;
  }
  async get(key: string): Promise<string | null> {
    const p = await this.load();
    if (!p) return localStorage.getItem(key);
    return (await p.get(key)).value;
  }
  async set(key: string, value: string): Promise<void> {
    const p = await this.load();
    if (!p) { localStorage.setItem(key, value); return; }
    await p.set(key, value);
  }
  async remove(key: string): Promise<void> {
    const p = await this.load();
    if (!p) { localStorage.removeItem(key); return; }
    await p.remove(key);
  }
}

function pickStorage(): KVStorage {
  // Capacitor native runtime detected → Preferences; else localStorage (web/tests).
  const g = globalThis as { Capacitor?: { isNativePlatform?: () => boolean } };
  if (g.Capacitor?.isNativePlatform?.()) return new CapacitorKV();
  return new LocalKV();
}

export class SettingsStore {
  private cache: ZaraSettings = { ...DEFAULT_SETTINGS };
  private storage: KVStorage;

  constructor(storage?: KVStorage) {
    this.storage = storage ?? pickStorage();
  }

  get current(): Readonly<ZaraSettings> {
    return this.cache;
  }

  async load(): Promise<ZaraSettings> {
    try {
      const raw = await this.storage.get(SETTINGS_KEY);
      if (raw) this.cache = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch { /* corrupt → defaults */ }
    return this.cache;
  }

  async patch(p: Partial<ZaraSettings>): Promise<ZaraSettings> {
    this.cache = { ...this.cache, ...p };
    await this.storage.set(SETTINGS_KEY, JSON.stringify(this.cache));
    return this.cache;
  }

  async reset(): Promise<ZaraSettings> {
    this.cache = { ...DEFAULT_SETTINGS };
    await this.storage.remove(SETTINGS_KEY);
    return this.cache;
  }
}

/* ----------------------------- Secret storage ---------------------------- */

const SECRET_KEYS = {
  glm: "zara.secret.glmKey",
  gemini: "zara.secret.geminiKey",
  openai: "zara.secret.openaiKey"
} as const;

export type SecretId = keyof typeof SECRET_KEYS;

export class SecretStore {
  private storage: KVStorage;
  constructor(storage?: KVStorage) {
    this.storage = storage ?? pickStorage();
  }

  /** Store a secret. Never log it, never return it again via any API. */
  async set(id: SecretId, value: string): Promise<void> {
    const v = value.trim();
    if (!v) return this.clear(id);
    await this.storage.set(SECRET_KEYS[id], v);
  }

  async clear(id: SecretId): Promise<void> {
    await this.storage.remove(SECRET_KEYS[id]);
  }

  /** Boolean presence only — the key itself is read exclusively by adapters. */
  async has(id: SecretId): Promise<boolean> {
    const v = await this.storage.get(SECRET_KEYS[id]);
    return !!v && v.length > 0;
  }

  /**
   * Read the raw secret. Restricted to provider adapters (module-level use);
   * UI layers must use `has()`. Kept internal-by-convention and documented.
   */
  async read(id: SecretId): Promise<string | null> {
    return (await this.storage.get(SECRET_KEYS[id])) || null;
  }

  async clearAll(): Promise<void> {
    for (const k of Object.values(SECRET_KEYS)) await this.storage.remove(k);
  }
}

export const settingsStore = new SettingsStore();
export const secretStore = new SecretStore();
