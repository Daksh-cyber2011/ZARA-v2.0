/**
 * ZARA V1.0 — Web fallback native bridge.
 *
 * In the browser (dev/web preview/tests) there is no Android runtime. Every
 * tool reports HONESTLY that it requires the device runtime — no fake
 * successes (§58). This keeps the entire agent pipeline testable and the
 * web preview honest about what it can do.
 */
import { NativeBridge, ToolResult } from "./ToolTypes";

function unavailable(action: string): ToolResult {
  return {
    ok: false,
    summary: `This action (${action}) needs ZARA running on the Android tablet — it is not available in the web preview.`,
    error: { code: "TOOL_UNAVAILABLE", message: `Native bridge not present for ${action} (web environment)`, retryable: false }
  };
}

export class WebFallbackBridge implements NativeBridge {
  async openApp(): Promise<ToolResult> { return unavailable("open app"); }
  async openUrl(url: string): Promise<ToolResult> {
    // Opening a URL in a new tab IS possible on the web — do it for real.
    try {
      window.open(url.startsWith("http") ? url : `https://${url}`, "_blank", "noopener");
      return { ok: true, summary: `Opened ${url} in a browser tab.`, data: { url } };
    } catch {
      return unavailable("open url");
    }
  }
  async webSearch(query: string): Promise<ToolResult> {
    try {
      window.open(`https://www.google.com/search?q=${encodeURIComponent(query)}`, "_blank", "noopener");
      return { ok: true, summary: `Searching the web for "${query}".`, data: { query } };
    } catch {
      return unavailable("web search");
    }
  }
  async youtubeSearch(query: string): Promise<ToolResult> {
    try {
      window.open(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, "_blank", "noopener");
      return { ok: true, summary: `Searching YouTube for "${query}".`, data: { query } };
    } catch {
      return unavailable("youtube search");
    }
  }
  async setBrightness(): Promise<ToolResult> { return unavailable("brightness"); }
  async setVolume(): Promise<ToolResult> { return unavailable("volume"); }
  async toggleFlashlight(): Promise<ToolResult> { return unavailable("flashlight"); }
  async openSettings(): Promise<ToolResult> { return unavailable("settings"); }
  async batteryInfo(): Promise<ToolResult> {
    // Battery API exists in some browsers — use it if genuinely available.
    const nav = navigator as Navigator & { getBattery?: () => Promise<{ level: number; charging: boolean }> };
    if (nav.getBattery) {
      try {
        const b = await nav.getBattery();
        return { ok: true, summary: `Battery is at ${Math.round(b.level * 100)}%${b.charging ? ", charging" : ""}.`, data: { level: b.level, charging: b.charging } };
      } catch { /* fall through */ }
    }
    return unavailable("battery info");
  }
  async createReminder(): Promise<ToolResult> { return unavailable("reminder"); }
  async createAlarm(): Promise<ToolResult> { return unavailable("alarm"); }
  async createCalendarEvent(): Promise<ToolResult> { return unavailable("calendar event"); }
  async playMedia(): Promise<ToolResult> { return unavailable("media control"); }
  async callContact(): Promise<ToolResult> { return unavailable("call"); }
  async smsDraft(): Promise<ToolResult> { return unavailable("message"); }
  async launchCamera(): Promise<ToolResult> { return unavailable("camera"); }
  async launchGallery(): Promise<ToolResult> { return unavailable("gallery"); }
  async openMaps(query: string): Promise<ToolResult> {
    try {
      window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`, "_blank", "noopener");
      return { ok: true, summary: `Opened maps for "${query}".`, data: { query } };
    } catch {
      return unavailable("maps");
    }
  }
  async getDeviceInfo(): Promise<ToolResult> {
    return {
      ok: true,
      summary: `Web preview on ${navigator.userAgent.slice(0, 80)}…`,
      data: { platform: "web", userAgent: navigator.userAgent }
    };
  }
}
