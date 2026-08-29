/**
 * ZARA V1.0 — Provider registry.
 *
 * Builds concrete adapters from the current settings + secrets. The rest of
 * ZARA depends only on the LLMProvider interface, never on a concrete SDK.
 *
 * FINAL-INTEGRATION §1: Google Gemini is the PRIMARY provider. GLM and any
 * OpenAI-compatible endpoint remain fully optional selectable alternates —
 * GLM is never required, never the default, and startup never depends on it.
 */
import { LLMProvider } from "./types";
import { GLMProvider } from "./GLMProvider";
import { GeminiProvider } from "./GeminiProvider";
import { OpenAICompatProvider } from "./OpenAICompatProvider";
import { SecretStore, SettingsStore, ZaraSettings } from "../../core/configuration/Settings";

export class ProviderRegistry {
  private glm: GLMProvider | null = null;
  private gemini: GeminiProvider | null = null;
  private openai: OpenAICompatProvider | null = null;

  constructor(
    private settings: SettingsStore,
    private secrets: SecretStore
  ) {}

  private rebuildIfChanged(): void {
    const s = this.settings.current;
    const sig = settingsSignature(s);
    if (this._sig !== sig) {
      this.glm = new GLMProvider({
        secrets: this.secrets,
        baseUrl: s.glmBaseUrl,
        model: s.glmModel,
        thinking: s.glmThinking,
        timeoutMs: 30000,
        retries: 2
      });
      this.gemini = new GeminiProvider({
        secrets: this.secrets,
        model: s.chatModel,
        baseUrl: s.geminiBaseUrl, // empty = official Google endpoint
        timeoutMs: 30000,
        retries: 2
      });
      this.openai = new OpenAICompatProvider({
        secrets: this.secrets,
        baseUrl: s.openaiBaseUrl,
        model: s.openaiModel,
        timeoutMs: 30000,
        retries: 2
      });
      this._sig = sig;
    }
  }
  private _sig = "";
  /** §37: last known configured state of the ACTIVE provider (async refresh). */
  private _cachedConfigured = false;

  get cachedConfigured(): boolean { return this._cachedConfigured; }

  /** Active provider per settings; throws nothing (check isConfigured first).
   * Unknown ids resolve to GEMINI — the primary provider (§1). */
  active(): LLMProvider {
    this.rebuildIfChanged();
    const id = this.settings.current.providerId;
    if (id === "glm") return this.glm!;
    if (id === "openai-compat") return this.openai!;
    return this.gemini!; // "gemini" / default / unknown fallback
  }

  glmProvider(): GLMProvider {
    this.rebuildIfChanged();
    return this.glm!;
  }

  geminiLive(): GeminiProvider {
    this.rebuildIfChanged();
    return this.gemini!;
  }

  byId(id: string): LLMProvider | null {
    this.rebuildIfChanged();
    if (id === "glm") return this.glm;
    if (id === "gemini") return this.gemini;
    if (id === "openai-compat") return this.openai;
    return null;
  }

  async configuredProviders(): Promise<string[]> {
    this.rebuildIfChanged();
    const out: string[] = [];
    if (await this.glm!.isConfigured()) out.push("glm");
    if (await this.gemini!.isConfigured()) out.push("gemini");
    if (await this.openai!.isConfigured()) out.push("openai-compat");
    this._cachedConfigured = out.includes(this.settings.current.providerId);
    return out;
  }

  /** Secret id matching a provider id (for key management UI). */
  secretIdFor(providerId: string): "glm" | "gemini" | "openai" {
    if (providerId === "glm") return "glm";
    if (providerId === "openai-compat") return "openai";
    return "gemini"; // "gemini" / default
  }

  /** Apply new settings (e.g. after the settings panel saves). */
  invalidate(): void { this._sig = ""; this.rebuildIfChanged(); }
}

export function settingsSignature(s: ZaraSettings): string {
  return `${s.providerId}|${s.geminiBaseUrl}|${s.glmBaseUrl}|${s.glmModel}|${s.glmThinking}|${s.chatModel}|${s.liveModel}|${s.voiceName}|${s.openaiBaseUrl}|${s.openaiModel}`;
}
