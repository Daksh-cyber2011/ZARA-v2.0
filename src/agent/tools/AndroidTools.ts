/**
 * ZARA V1.0 — Android tool definitions (Directive §15-17).
 *
 * Typed intents over the NativeBridge (Capacitor ZaraActions plugin on
 * device, WebFallbackBridge in browser). Risk levels per §17:
 *   LOW    → execute freely when asked (open YouTube, web search…)
 *   MEDIUM → create things the user asked for (reminders, events)
 *   HIGH   → send/call/delete-class actions — ALWAYS confirm (§18)
 * There is no arbitrary-command tool by design (§17: LLM → shell is forbidden).
 */
import { ToolDefinition, toolResultFrom, toolOk, toolErr } from "./ToolTypes";
import { parseTimeExpression } from "../../core/time/TimeParser";
import {
  WeatherProvider, WeatherError, weatherProvider as defaultWeatherProvider,
  resolveWeatherLocation, formatWeather, GeoPoint
} from "../../cognition/weather/WeatherProvider";

const R = toolResultFrom;

function str(v: unknown, field: string): string | null {
  if (typeof v === "string" && v.trim().length > 0) return v.trim();
  if (typeof v === "number") return String(v);
  return null;
}

/** Parse flexible time expressions from model output. Returns epoch ms or null.
 * Phase 2 (§25): delegates to the deterministic EN/HI/Hinglish TimeParser. */
export function parseWhenToEpoch(when: string, now: number): number | null {
  const parsed = parseTimeExpression(when, now);
  return parsed ? parsed.epochMs : null;
}

export function buildAndroidTools(weather: WeatherProvider = defaultWeatherProvider): ToolDefinition[] {
  return [
    /* ------------------------------ Weather ------------------------------- */
    {
      // §47 + §18-B: real weather via a clean provider interface. Open-Meteo
      // default — keyless, CORS-safe, cached. Never fabricates conditions.
      name: "get_weather",
      description: "Get current weather for a place. If 'place' is omitted, uses the user's configured location or device location. Report the numbers honestly.",
      parameters: {
        type: "object",
        properties: { place: { type: "string", description: "City or place name (optional)" } },
        required: []
      },
      permission: null, risk: "LOW", requiresConfirmation: false, timeoutMs: 12000,
      verification: "inspected",
      validate: a => (a.place !== undefined && typeof a.place !== "string") ? "'place' must be a string" : null,
      execute: async a => {
        try {
          let point: GeoPoint | null = null;
          const place = str(a.place, "place");
          if (place) {
            point = await weather.geocode(place);
            if (!point) return toolErr("LOCATION_UNAVAILABLE", `No place found matching "${place}". Ask the user to name a nearby city.`);
          } else {
            point = await resolveWeatherLocation(weather);
            if (!point) return toolErr("LOCATION_UNAVAILABLE", "No location available — ask the user to name a city or set one in settings.");
          }
          const w = await weather.current(point);
          return toolOk(formatWeather(w), {
            location: w.locationLabel, temperatureC: w.temperatureC,
            apparentC: w.apparentC, humidityPct: w.humidityPct,
            windKph: w.windKph, description: w.description, source: w.source
          });
        } catch (e) {
          if (e instanceof WeatherError) {
            const retryable = e.failure.kind === "WEATHER_UNAVAILABLE" && e.failure.retryable;
            return toolErr(e.failure.kind, e.failure.message, retryable);
          }
          return toolErr("WEATHER_UNAVAILABLE", "Weather lookup failed.", true);
        }
      }
    },
    /* ---------------------------- Applications ---------------------------- */
    {
      name: "open_app",
      description: "Open an installed app by common name (youtube, whatsapp, gmail, chrome, maps, camera, calculator, settings…).",
      parameters: { type: "object", properties: { app: { type: "string", description: "App name the user said" } }, required: ["app"] },
      permission: null, risk: "LOW", requiresConfirmation: false, timeoutMs: 8000,
      verification: "result_ok",
      validate: a => str(a.app, "app") ? null : "'app' must be a non-empty string",
      execute: async (a, ctx) => R(await ctx.native.openApp(str(a.app, "app")!), "open_app")
    },
    /* -------------------------------- Web --------------------------------- */
    {
      name: "web_search",
      description: "Open a web search for a query in the browser/search app.",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      permission: null, risk: "LOW", requiresConfirmation: false, timeoutMs: 8000,
      verification: "result_ok",
      validate: a => str(a.query, "query") ? null : "'query' must be a non-empty string",
      execute: async (a, ctx) => R(await ctx.native.webSearch(str(a.query, "query")!), "web_search")
    },
    {
      name: "youtube_search",
      description: "Open YouTube search results (or a specific video) for a query.",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      permission: null, risk: "LOW", requiresConfirmation: false, timeoutMs: 8000,
      verification: "result_ok",
      validate: a => str(a.query, "query") ? null : "'query' must be a non-empty string",
      execute: async (a, ctx) => R(await ctx.native.youtubeSearch(str(a.query, "query")!), "youtube_search")
    },
    {
      name: "open_url",
      description: "Open a specific website URL.",
      parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
      permission: null, risk: "LOW", requiresConfirmation: false, timeoutMs: 8000,
      verification: "result_ok",
      validate: a => {
        const u = str(a.url, "url");
        if (!u) return "'url' must be a non-empty string";
        if (!/^https?:\/\//i.test(u) && !/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(u)) return "'url' must look like a URL";
        return null;
      },
      execute: async (a, ctx) => R(await ctx.native.openUrl(str(a.url, "url")!), "open_url")
    },
    /* -------------------------------- Device ------------------------------- */
    {
      name: "set_brightness",
      description: "Adjust screen brightness.",
      parameters: {
        type: "object",
        properties: { mode: { type: "string", enum: ["up", "down", "min", "max"], description: "up/down steps, min/max extremes" } },
        required: ["mode"]
      },
      permission: null, risk: "LOW", requiresConfirmation: false, timeoutMs: 6000,
      verification: "result_ok",
      validate: a => ["up", "down", "min", "max"].includes(String(a.mode)) ? null : "'mode' must be up|down|min|max",
      execute: async (a, ctx) => R(await ctx.native.setBrightness(a.mode as "up"), "set_brightness")
    },
    {
      name: "set_volume",
      description: "Adjust media volume.",
      parameters: {
        type: "object",
        properties: { mode: { type: "string", enum: ["up", "down", "mute", "unmute"] } },
        required: ["mode"]
      },
      permission: null, risk: "LOW", requiresConfirmation: false, timeoutMs: 6000,
      verification: "result_ok",
      validate: a => ["up", "down", "mute", "unmute"].includes(String(a.mode)) ? null : "'mode' must be up|down|mute|unmute",
      execute: async (a, ctx) => R(await ctx.native.setVolume(a.mode as "up"), "set_volume")
    },
    {
      name: "toggle_flashlight",
      description: "Turn the flashlight (torch) on or off.",
      parameters: { type: "object", properties: { on: { type: "boolean" } }, required: ["on"] },
      permission: null, risk: "LOW", requiresConfirmation: false, timeoutMs: 6000,
      verification: "result_ok",
      validate: a => typeof a.on === "boolean" ? null : "'on' must be boolean",
      execute: async (a, ctx) => R(await ctx.native.toggleFlashlight(a.on as boolean), "toggle_flashlight")
    },
    {
      name: "open_settings",
      description: "Open a device settings panel (wifi, bluetooth, display, sound, battery, apps, main).",
      parameters: { type: "object", properties: { panel: { type: "string", enum: ["main", "wifi", "bluetooth", "display", "sound", "battery", "apps", "location"] } }, required: ["panel"] },
      permission: null, risk: "LOW", requiresConfirmation: false, timeoutMs: 6000,
      verification: "result_ok",
      validate: a => ["main", "wifi", "bluetooth", "display", "sound", "battery", "apps", "location"].includes(String(a.panel)) ? null : "invalid panel",
      execute: async (a, ctx) => R(await ctx.native.openSettings(String(a.panel)), "open_settings")
    },
    {
      name: "battery_info",
      description: "Get current battery level and charging state.",
      parameters: { type: "object", properties: {} },
      permission: null, risk: "LOW", requiresConfirmation: false, timeoutMs: 5000,
      verification: "inspected",
      validate: () => null,
      execute: async (_a, ctx) => R(await ctx.native.batteryInfo(), "battery_info")
    },
    {
      name: "device_info",
      description: "Get basic device info (model, Android version, storage summary).",
      parameters: { type: "object", properties: {} },
      permission: null, risk: "LOW", requiresConfirmation: false, timeoutMs: 5000,
      verification: "inspected",
      validate: () => null,
      execute: async (_a, ctx) => R(await ctx.native.getDeviceInfo(), "device_info")
    },
    /* --------------------------- Reminders / time -------------------------- */
    {
      name: "create_reminder",
      description: "Create a reminder that will notify the user at a specific time. Accepts ISO time or natural language in English, Hindi or Hinglish ('tomorrow 7pm', 'kal 7 baje', 'raat ko 9 baje', 'after 20 minutes', '20 minute baad').",
      parameters: {
        type: "object",
        properties: {
          time: { type: "string", description: "When to remind — ISO 8601 or natural EN/HI/Hinglish ('tomorrow 7pm', 'kal subah 8 baje', 'after 20 minutes')" },
          content: { type: "string", description: "What to remind about" }
        },
        required: ["time", "content"]
      },
      permission: "notifications", risk: "MEDIUM", requiresConfirmation: false, timeoutMs: 10000,
      verification: "inspected",
      validate: a => {
        if (!str(a.content, "content")) return "'content' required";
        if (!str(a.time, "time")) return "'time' required";
        return null;
      },
      execute: async (a, ctx) => {
        const when = parseWhenToEpoch(str(a.time, "time")!, ctx.now());
        if (!when || when <= ctx.now()) return { ok: false, summary: "The reminder time could not be understood or is in the past.", error: { code: "TOOL_INVALID_ARGS", message: "unparseable/past time", retryable: false } };
        return R(await ctx.native.createReminder(when, str(a.content, "content")!), "create_reminder");
      }
    },
    {
      name: "create_alarm",
      description: "Set an alarm for a specific hour:minute (next occurrence).",
      parameters: {
        type: "object",
        properties: { hour: { type: "integer", description: "0-23" }, minute: { type: "integer", description: "0-59" }, label: { type: "string" } },
        required: ["hour"]
      },
      permission: "notifications", risk: "MEDIUM", requiresConfirmation: false, timeoutMs: 10000,
      verification: "inspected",
      validate: a => {
        const h = Number(a.hour);
        if (!Number.isInteger(h) || h < 0 || h > 23) return "'hour' must be 0-23";
        const m = Number(a.minute ?? 0);
        if (!Number.isInteger(m) || m < 0 || m > 59) return "'minute' must be 0-59";
        return null;
      },
      execute: async (a, ctx) => R(await ctx.native.createAlarm(Number(a.hour), Number(a.minute ?? 0), str(a.label, "label") ?? "ZARA alarm"), "create_alarm")
    },
    {
      name: "create_calendar_event",
      description: "Create a calendar event.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          start: { type: "string", description: "Start time ISO 8601 or natural" },
          end: { type: "string", description: "End time (optional, default +1h)" },
          location: { type: "string" }
        },
        required: ["title", "start"]
      },
      permission: null, risk: "MEDIUM", requiresConfirmation: false, timeoutMs: 10000,
      verification: "inspected",
      validate: a => str(a.title, "title") && str(a.start, "start") ? null : "'title' and 'start' required",
      execute: async (a, ctx) => {
        const start = parseWhenToEpoch(str(a.start, "start")!, ctx.now());
        if (!start) return { ok: false, summary: "The event start time could not be understood.", error: { code: "TOOL_INVALID_ARGS", message: "unparseable time", retryable: false } };
        const end = str(a.end, "end") ? parseWhenToEpoch(str(a.end, "end")!, ctx.now()) : start + 3600000;
        return R(await ctx.native.createCalendarEvent(str(a.title, "title")!, start, end ?? start + 3600000, str(a.location, "location") ?? undefined), "create_calendar_event");
      }
    },
    /* --------------------------------- Media ------------------------------- */
    {
      name: "media_control",
      description: "Control media playback (play, pause, next, previous).",
      parameters: { type: "object", properties: { action: { type: "string", enum: ["play", "pause", "next", "previous"] } }, required: ["action"] },
      permission: null, risk: "LOW", requiresConfirmation: false, timeoutMs: 6000,
      verification: "result_ok",
      validate: a => ["play", "pause", "next", "previous"].includes(String(a.action)) ? null : "invalid action",
      execute: async (a, ctx) => R(await ctx.native.playMedia(a.action as "play"), "media_control")
    },
    /* ------------------------------ Navigation ----------------------------- */
    {
      name: "open_maps",
      description: "Open a place or address in maps.",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      permission: null, risk: "LOW", requiresConfirmation: false, timeoutMs: 8000,
      verification: "result_ok",
      validate: a => str(a.query, "query") ? null : "'query' required",
      execute: async (a, ctx) => R(await ctx.native.openMaps(str(a.query, "query")!), "open_maps")
    },
    /* ---------------------------- Communication ---------------------------- */
    {
      name: "call_contact",
      description: "Start a phone call to a contact (opens the dialer with the number resolved from the contact name).",
      parameters: { type: "object", properties: { contact: { type: "string", description: "Contact name as the user said it" } }, required: ["contact"] },
      permission: null, risk: "HIGH", requiresConfirmation: true, timeoutMs: 10000,
      verification: "inspected",
      validate: a => str(a.contact, "contact") ? null : "'contact' required",
      execute: async (a, ctx) => R(await ctx.native.callContact(str(a.contact, "contact")!), "call_contact")
    },
    {
      name: "prepare_message",
      description: "Draft an SMS/WhatsApp message to a contact and open it ready to send. The message is NOT sent automatically — the user taps send.",
      parameters: {
        type: "object",
        properties: { contact: { type: "string" }, message: { type: "string" }, app: { type: "string", enum: ["sms", "whatsapp"], description: "Default sms" } },
        required: ["contact", "message"]
      },
      permission: null, risk: "HIGH", requiresConfirmation: true, timeoutMs: 10000,
      verification: "inspected",
      validate: a => str(a.contact, "contact") && str(a.message, "message") ? null : "'contact' and 'message' required",
      execute: async (a, ctx) => R(await ctx.native.smsDraft(str(a.contact, "contact")!, str(a.message, "message")!), "prepare_message")
    },
    /* ----------------------------- Camera / files -------------------------- */
    {
      name: "launch_camera",
      description: "Open the camera app.",
      parameters: { type: "object", properties: {} },
      permission: null, risk: "LOW", requiresConfirmation: false, timeoutMs: 6000,
      verification: "result_ok",
      validate: () => null,
      execute: async (_a, ctx) => R(await ctx.native.launchCamera(), "launch_camera")
    },
    {
      name: "launch_gallery",
      description: "Open the photo gallery.",
      parameters: { type: "object", properties: {} },
      permission: null, risk: "LOW", requiresConfirmation: false, timeoutMs: 6000,
      verification: "result_ok",
      validate: () => null,
      execute: async (_a, ctx) => R(await ctx.native.launchGallery(), "launch_gallery")
    }
  ];
}
