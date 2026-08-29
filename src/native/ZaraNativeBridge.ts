/**
 * ZARA V1.0 — Device native bridge (ZaraActions Capacitor plugin).
 *
 * Typed one-to-one with NativeBridge. On Android every call goes to the
 * plugin's typed Java methods. Results are returned EXACTLY as the plugin
 * reports them — honest successes and honest failures (§19, §58).
 */
import { registerPlugin } from "@capacitor/core";
import { NativeBridge, ToolResult, toolErr } from "../agent/tools/ToolTypes";

interface ZaraActionsPlugin {
  openApp(options: { query: string }): Promise<PluginResult>;
  openUrl(options: { url: string }): Promise<PluginResult>;
  webSearch(options: { query: string }): Promise<PluginResult>;
  youtubeSearch(options: { query: string }): Promise<PluginResult>;
  setBrightness(options: { mode: string }): Promise<PluginResult>;
  setVolume(options: { mode: string }): Promise<PluginResult>;
  toggleFlashlight(options: { on: boolean }): Promise<PluginResult>;
  openSettings(options: { panel: string }): Promise<PluginResult>;
  batteryInfo(): Promise<PluginResult>;
  createReminder(options: { epochMs: number; content: string }): Promise<PluginResult>;
  createAlarm(options: { hour: number; minute: number; label: string }): Promise<PluginResult>;
  createCalendarEvent(options: { title: string; startEpochMs: number; endEpochMs: number; location?: string }): Promise<PluginResult>;
  playMedia(options: { action: string }): Promise<PluginResult>;
  callContact(options: { query: string }): Promise<PluginResult>;
  smsDraft(options: { query: string; message: string }): Promise<PluginResult>;
  launchCamera(): Promise<PluginResult>;
  launchGallery(): Promise<PluginResult>;
  openMaps(options: { query: string }): Promise<PluginResult>;
  getDeviceInfo(): Promise<PluginResult>;
}

interface PluginResult {
  ok?: boolean;
  summary?: string;
  data?: Record<string, unknown>;
  error?: { code: string; message: string; retryable?: boolean };
}

const ZaraActions = registerPlugin<ZaraActionsPlugin>("ZaraActions");

/** Normalize a plugin result into the ToolResult contract. */
function toToolResult(r: PluginResult, fallbackTool: string): ToolResult {
  if (typeof r?.ok === "boolean") {
    return {
      ok: r.ok,
      summary: r.summary ?? (r.ok ? "Done." : "Failed."),
      data: r.data,
      error: r.error ? { code: r.error.code, message: r.error.message, retryable: !!r.error.retryable } : undefined
    };
  }
  return toolErr("TOOL_UNAVAILABLE", `Native bridge returned no result for ${fallbackTool}.`);
}

export function isNativeAvailable(): boolean {
  const g = globalThis as { Capacitor?: { isNativePlatform?: () => boolean; isPluginAvailable?: (n: string) => boolean } };
  return !!(g.Capacitor?.isNativePlatform?.() && g.Capacitor?.isPluginAvailable?.("ZaraActions"));
}

export class ZaraNativeBridge implements NativeBridge {
  async openApp(query: string): Promise<ToolResult> {
    return toToolResult(await ZaraActions.openApp({ query }), "open_app");
  }
  async openUrl(url: string): Promise<ToolResult> {
    return toToolResult(await ZaraActions.openUrl({ url }), "open_url");
  }
  async webSearch(query: string): Promise<ToolResult> {
    return toToolResult(await ZaraActions.webSearch({ query }), "web_search");
  }
  async youtubeSearch(query: string): Promise<ToolResult> {
    return toToolResult(await ZaraActions.youtubeSearch({ query }), "youtube_search");
  }
  async setBrightness(mode: "up" | "down" | "min" | "max"): Promise<ToolResult> {
    return toToolResult(await ZaraActions.setBrightness({ mode }), "set_brightness");
  }
  async setVolume(mode: "up" | "down" | "mute" | "unmute"): Promise<ToolResult> {
    return toToolResult(await ZaraActions.setVolume({ mode }), "set_volume");
  }
  async toggleFlashlight(on: boolean): Promise<ToolResult> {
    return toToolResult(await ZaraActions.toggleFlashlight({ on }), "toggle_flashlight");
  }
  async openSettings(panel: string): Promise<ToolResult> {
    return toToolResult(await ZaraActions.openSettings({ panel }), "open_settings");
  }
  async batteryInfo(): Promise<ToolResult> {
    return toToolResult(await ZaraActions.batteryInfo(), "battery_info");
  }
  async createReminder(epochMs: number, content: string): Promise<ToolResult> {
    return toToolResult(await ZaraActions.createReminder({ epochMs, content }), "create_reminder");
  }
  async createAlarm(hour: number, minute: number, label: string): Promise<ToolResult> {
    return toToolResult(await ZaraActions.createAlarm({ hour, minute, label }), "create_alarm");
  }
  async createCalendarEvent(title: string, startEpochMs: number, endEpochMs: number, location?: string): Promise<ToolResult> {
    return toToolResult(await ZaraActions.createCalendarEvent({ title, startEpochMs, endEpochMs, location }), "create_calendar_event");
  }
  async playMedia(action: "play" | "pause" | "next" | "previous"): Promise<ToolResult> {
    return toToolResult(await ZaraActions.playMedia({ action }), "media_control");
  }
  async callContact(query: string): Promise<ToolResult> {
    return toToolResult(await ZaraActions.callContact({ query }), "call_contact");
  }
  async smsDraft(query: string, message: string): Promise<ToolResult> {
    return toToolResult(await ZaraActions.smsDraft({ query, message }), "prepare_message");
  }
  async launchCamera(): Promise<ToolResult> {
    return toToolResult(await ZaraActions.launchCamera(), "launch_camera");
  }
  async launchGallery(): Promise<ToolResult> {
    return toToolResult(await ZaraActions.launchGallery(), "launch_gallery");
  }
  async openMaps(query: string): Promise<ToolResult> {
    return toToolResult(await ZaraActions.openMaps({ query }), "open_maps");
  }
  async getDeviceInfo(): Promise<ToolResult> {
    return toToolResult(await ZaraActions.getDeviceInfo(), "device_info");
  }
}
