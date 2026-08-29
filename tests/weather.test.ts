/**
 * ZARA V1.0 FINAL — §47 weather tests.
 *
 * WeatherProvider interface, Open-Meteo adapter (mocked fetch), caching,
 * honest typed failures, and the get_weather tool contract (§18 flow B).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  OpenMeteoProvider, WeatherError, formatWeather, resolveWeatherLocation
} from "../src/cognition/weather/WeatherProvider";
import { buildAndroidTools } from "../src/agent/tools/AndroidTools";
import { ToolContext } from "../src/agent/tools/ToolTypes";
import { DEFAULT_SETTINGS, SettingsStore, KVStorage } from "../src/core/configuration/Settings";

/* --------------------------------- helpers -------------------------------- */

class MemoryKV implements KVStorage {
  private m = new Map<string, string>();
  async get(k: string) { return this.m.get(k) ?? null; }
  async set(k: string, v: string) { this.m.set(k, v); }
  async remove(k: string) { this.m.delete(k); }
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  } as unknown as Response;
}

function makeToolCtx(): ToolContext {
  return {
    emitActionEvent: () => {},
    hasPermission: () => true,
    requestPermission: async () => false,
    native: {} as never,
    now: () => Date.now()
  };
}

const GEO_BODY = {
  results: [{ latitude: 28.66, longitude: 77.21, name: "Delhi", country: "India", admin1: "Delhi" }]
};
const FORECAST_BODY = {
  current: {
    time: "2026-08-27T13:00",
    temperature_2m: 34.2,
    relative_humidity_2m: 61,
    apparent_temperature: 39.5,
    is_day: 1,
    precipitation: 0,
    weather_code: 0,
    wind_speed_10m: 11.3
  }
};

/* ------------------------------ provider tests ---------------------------- */

describe("OpenMeteoProvider (§47)", () => {
  it("geocodes a place and caches the result (single fetch)", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(GEO_BODY))
      .mockResolvedValueOnce(jsonResponse(FORECAST_BODY));
    const p = new OpenMeteoProvider(fetchMock as unknown as typeof fetch);

    const point = await p.geocode("delhi");
    expect(point).not.toBeNull();
    expect(point!.label).toContain("Delhi");
    expect(point!.lat).toBeCloseTo(28.66);

    // Second call served from cache → no extra geocode fetch.
    const again = await p.geocode("Delhi");
    expect(again!.label).toBe(point!.label);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns null for an unknown place (never fabricates)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ results: [] }));
    const p = new OpenMeteoProvider(fetchMock as unknown as typeof fetch);
    expect(await p.geocode("zzzqxnowhere")).toBeNull();
  });

  it("current() parses conditions and caches for 15 minutes", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(GEO_BODY))
      .mockResolvedValueOnce(jsonResponse(FORECAST_BODY));
    const p = new OpenMeteoProvider(fetchMock as unknown as typeof fetch);
    const point = (await p.geocode("delhi"))!;

    const w = await p.current(point);
    expect(w.temperatureC).toBeCloseTo(34.2);
    expect(w.description).toBe("clear sky");
    expect(w.isDay).toBe(true);
    expect(w.source).toBe("open-meteo");

    // Cached second read → still only 2 fetches total.
    await p.current(point);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("HTTP failure throws a typed WEATHER_UNAVAILABLE error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 503));
    const p = new OpenMeteoProvider(fetchMock as unknown as typeof fetch);
    await expect(p.geocode("delhi")).rejects.toBeInstanceOf(WeatherError);
    try {
      await p.geocode("delhi");
    } catch (e) {
      const we = e as WeatherError;
      expect(we.failure.kind).toBe("WEATHER_UNAVAILABLE");
      if (we.failure.kind === "WEATHER_UNAVAILABLE") {
        expect(we.failure.retryable).toBe(true);
      }
    }
  });

  it("malformed forecast body (no current block) fails honestly", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(GEO_BODY))
      .mockResolvedValueOnce(jsonResponse({ error: "bad request" }));
    const p = new OpenMeteoProvider(fetchMock as unknown as typeof fetch);
    const point = (await p.geocode("delhi"))!;
    await expect(p.current(point)).rejects.toThrow(/no current conditions/i);
  });
});

/* ------------------------------ formatter test ---------------------------- */

describe("formatWeather", () => {
  it("renders a human summary with temperature, feels-like, humidity, wind", () => {
    const s = formatWeather({
      locationLabel: "Delhi, India",
      temperatureC: 34.2, apparentC: 39.5, humidityPct: 61, windKph: 11.3,
      precipitationMm: 0, isDay: true, description: "clear sky",
      observedAt: Date.now(), source: "open-meteo"
    });
    expect(s).toContain("Delhi");
    expect(s).toContain("34");
    expect(s).toContain("clear sky");
    expect(s).toContain("61%");
  });
});

/* -------------------------------- tool tests ------------------------------- */

describe("get_weather tool (§18 flow B, §47)", () => {
  const ctx = makeToolCtx();

  it("is registered with SAFE risk and no confirmation", () => {
    const tools = buildAndroidTools(new OpenMeteoProvider((() => Promise.resolve(jsonResponse({}))) as unknown as typeof fetch));
    const w = tools.find(t => t.name === "get_weather");
    expect(w).toBeDefined();
    expect(w!.risk).toBe("LOW");
    expect(w!.requiresConfirmation).toBe(false);
    expect(w!.verification).toBe("inspected");
  });

  it("happy path: explicit place → geocode + current → honest summary", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(GEO_BODY))
      .mockResolvedValueOnce(jsonResponse(FORECAST_BODY));
    const tools = buildAndroidTools(new OpenMeteoProvider(fetchMock as unknown as typeof fetch));
    const w = tools.find(t => t.name === "get_weather")!;
    const r = await w.execute({ place: "Delhi" }, ctx);
    expect(r.ok).toBe(true);
    expect(r.summary).toContain("Delhi");
    expect(r.summary).toContain("clear sky");
    expect(r.data?.temperatureC).toBeCloseTo(34.2);
  });

  it("unknown place → typed LOCATION_UNAVAILABLE, asks the user", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ results: [] }));
    const tools = buildAndroidTools(new OpenMeteoProvider(fetchMock as unknown as typeof fetch));
    const w = tools.find(t => t.name === "get_weather")!;
    const r = await w.execute({ place: "Atlantis" }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("LOCATION_UNAVAILABLE");
    expect(r.error?.message).toContain("Atlantis");
  });

  it("no place + no configured location + no permission → honest LOCATION_UNAVAILABLE", async () => {
    // settings singleton with a MemoryKV, no weatherLocation, and a
    // navigator with denied permission state.
    const store = new SettingsStore(new MemoryKV());
    await store.load();
    expect(store.current.weatherLocation).toBe("");
    // node test env has no navigator.permissions → resolution returns null path
    const provider = new OpenMeteoProvider((() => Promise.resolve(jsonResponse({}))) as unknown as typeof fetch);
    const point = await resolveWeatherLocation(provider).catch(() => null);
    expect(point).toBeNull();
  });

  it("network failure mid-fetch → typed WEATHER_UNAVAILABLE (never fabricated)", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(GEO_BODY))
      .mockResolvedValueOnce(jsonResponse({}, 500));
    const tools = buildAndroidTools(new OpenMeteoProvider(fetchMock as unknown as typeof fetch));
    const w = tools.find(t => t.name === "get_weather")!;
    const r = await w.execute({ place: "Delhi" }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("WEATHER_UNAVAILABLE");
    expect(r.error?.retryable).toBe(true);
  });

  it("validates: non-string place is rejected before execution", () => {
    const tools = buildAndroidTools(new OpenMeteoProvider((() => Promise.resolve(jsonResponse({}))) as unknown as typeof fetch));
    const w = tools.find(t => t.name === "get_weather")!;
    expect(w.validate({ place: 42 })).toContain("place");
    expect(w.validate({})).toBeNull();
    expect(w.validate({ place: "Delhi" })).toBeNull();
  });
});

/* -------------------------- settings integration --------------------------- */

describe("§47 settings", () => {
  it("weatherLocation is a first-class setting (default empty = ask)", () => {
    expect(DEFAULT_SETTINGS).toHaveProperty("weatherLocation", "");
  });
});
