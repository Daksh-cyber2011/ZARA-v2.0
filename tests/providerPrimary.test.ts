/**
 * FINAL-INTEGRATION §1 — Gemini is the PRIMARY provider; GLM is completely
 * optional. These tests pin the directive requirements:
 *   - default providerId is "gemini"
 *   - the registry resolves unknown ids to GEMINI (never GLM)
 *   - startup / chat paths never require a GLM key
 *   - GLM remains selectable when the user EXPLICITLY chooses it
 */
import { describe, it, expect } from "vitest";
import {
  SettingsStore, SecretStore, KVStorage, DEFAULT_SETTINGS
} from "../src/core/configuration/Settings";
import { ProviderRegistry } from "../src/cognition/provider/ProviderRegistry";
import { GeminiProvider } from "../src/cognition/provider/GeminiProvider";
import { GLMProvider } from "../src/cognition/provider/GLMProvider";

class MemoryKV implements KVStorage {
  private m = new Map<string, string>();
  async get(k: string) { return this.m.get(k) ?? null; }
  async set(k: string, v: string) { this.m.set(k, v); }
  async remove(k: string) { this.m.delete(k); }
}

function makeRegistry() {
  const settings = new SettingsStore(new MemoryKV());
  const secrets = new SecretStore(new MemoryKV());
  return { settings, secrets, registry: new ProviderRegistry(settings, secrets) };
}

describe("FINAL-INTEGRATION §1 — Gemini primary, GLM optional", () => {
  it("defaults to Google Gemini", () => {
    expect(DEFAULT_SETTINGS.providerId).toBe("gemini");
  });

  it("registry resolves the default provider to the Gemini adapter", () => {
    const { registry } = makeRegistry();
    expect(registry.active().id).toBe("gemini");
    expect(registry.active()).toBeInstanceOf(GeminiProvider);
  });

  it("registry falls back to GEMINI for unknown provider ids (never GLM)", () => {
    const { settings, registry } = makeRegistry();
    (settings as unknown as { cache: { providerId: string } }).cache = { ...DEFAULT_SETTINGS, providerId: "does-not-exist" };
    expect(registry.active().id).toBe("gemini");
  });

  it("secretIdFor maps gemini + unknowns to the gemini secret", () => {
    const { registry } = makeRegistry();
    expect(registry.secretIdFor("gemini")).toBe("gemini");
    expect(registry.secretIdFor("bogus")).toBe("gemini");
    expect(registry.secretIdFor("glm")).toBe("glm"); // explicit GLM still works
  });

  it("chat path reports NOT_CONFIGURED honestly with no Gemini key (no GLM fallback, no fabrication)", async () => {
    const { registry } = makeRegistry();
    const provider = registry.active();
    await expect(provider.chat({ messages: [{ role: "user", text: "hi" }] }))
      .rejects.toMatchObject({ code: "LLM_NOT_CONFIGURED" });
  });

  it("no GLM key needed at startup: configuredProviders works with zero keys", async () => {
    const { registry } = makeRegistry();
    const configured = await registry.configuredProviders();
    expect(configured).toEqual([]);
    expect(registry.cachedConfigured).toBe(false);
  });

  it("GLM remains available ONLY when explicitly selected", () => {
    const { settings, registry } = makeRegistry();
    (settings as unknown as { cache: object }).cache = { ...DEFAULT_SETTINGS, providerId: "glm" };
    const active = registry.active();
    expect(active.id).toBe("glm");
    expect(active).toBeInstanceOf(GLMProvider);
    expect(registry.byId("glm")).toBeInstanceOf(GLMProvider);
  });

  it("Gemini provider supports an optional endpoint override for proxies/testing", async () => {
    const { secrets } = makeRegistry();
    const p = new GeminiProvider({ secrets, model: "gemini-2.5-flash", baseUrl: "http://localhost:9998" });
    expect(p.id).toBe("gemini");
    // The override must not break unconfigured honesty:
    await expect(p.chat({ messages: [{ role: "user", text: "hi" }] }))
      .rejects.toMatchObject({ code: "LLM_NOT_CONFIGURED" });
  });
});
