/**
 * ZARA V1.1 — Companion keep-alive lifecycle (Directive §21).
 *
 * Thin typed handle to the ZaraActions plugin's service-control methods
 * (same plugin, separate interface — the standard Capacitor pattern).
 * Applies the user's "keep alive in background" setting; no-ops honestly
 * on web/tests.
 */
import { registerPlugin } from "@capacitor/core";
import { isNativeAvailable } from "./ZaraNativeBridge";

interface CompanionServicePlugin {
  startCompanionService(): Promise<{ ok: boolean; summary?: string }>;
  stopCompanionService(): Promise<{ ok: boolean; summary?: string }>;
}

const ZaraActionsLifecyclePlugin = registerPlugin<CompanionServicePlugin>("ZaraActions");

export const ZaraActionsLifecycle = {
  /** Start/stop the foreground service to match `enabled`. */
  async apply(enabled: boolean): Promise<boolean> {
    if (!isNativeAvailable()) return false; // honest no-op off-device
    try {
      const r = enabled
        ? await ZaraActionsLifecyclePlugin.startCompanionService()
        : await ZaraActionsLifecyclePlugin.stopCompanionService();
      return !!r.ok;
    } catch {
      return false;
    }
  }
};
