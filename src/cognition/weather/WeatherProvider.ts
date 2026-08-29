/**
 * ZARA V1.0 — Weather capability (Directive §47, §18 flow B).
 *
 * Clean provider interface + a real default provider (Open-Meteo — keyless,
 * CORS-friendly, works identically in the browser and the Android WebView).
 *
 * Honesty rules (§47, §58):
 *   - no location available   → typed LOCATION_UNAVAILABLE, ask the user
 *   - network/provider fails  → typed WEATHER_UNAVAILABLE, never fabricated
 *   - data is cached 15 min   → §59 cost discipline (no per-question re-fetch)
 *
 * Location resolution order:
 *   1. user-configured city (settings.weatherLocation — §47 "user-configured location")
 *   2. device geolocation IF permission already available (no silent requests)
 *   3. none → honest error asking the user to set a location
 */
import { settingsStore } from "../../core/configuration/Settings";

export interface GeoPoint {
  lat: number;
  lon: number;
  /** Human label, e.g. "Delhi, India". */
  label: string;
}

export interface WeatherNow {
  locationLabel: string;
  temperatureC: number;
  apparentC: number;
  humidityPct: number;
  windKph: number;
  precipitationMm: number;
  isDay: boolean;
  description: string;      // human phrasing of the WMO code
  observedAt: number;       // epoch ms
  source: string;           // provider id
}

export type WeatherFailure =
  | { kind: "LOCATION_UNAVAILABLE"; message: string }
  | { kind: "WEATHER_UNAVAILABLE"; message: string; retryable: boolean };

export class WeatherError extends Error {
  constructor(public readonly failure: WeatherFailure) {
    super(failure.message);
  }
}

export interface WeatherProvider {
  readonly id: string;
  /** Free-text place → coordinates. Returns null when not found. */
  geocode(place: string): Promise<GeoPoint | null>;
  /** Current conditions for a point. Throws WeatherError on failure. */
  current(point: GeoPoint): Promise<WeatherNow>;
}

/* ------------------------- Open-Meteo (default) --------------------------- */

const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

/** WMO weather interpretation codes → short human descriptions. */
const WMO_CODES: Record<number, string> = {
  0: "clear sky", 1: "mainly clear", 2: "partly cloudy", 3: "overcast",
  45: "fog", 48: "depositing rime fog",
  51: "light drizzle", 53: "moderate drizzle", 55: "dense drizzle",
  56: "light freezing drizzle", 57: "dense freezing drizzle",
  61: "slight rain", 63: "moderate rain", 65: "heavy rain",
  66: "light freezing rain", 67: "heavy freezing rain",
  71: "slight snowfall", 73: "moderate snowfall", 75: "heavy snowfall",
  77: "snow grains",
  80: "slight rain showers", 81: "moderate rain showers", 82: "violent rain showers",
  85: "slight snow showers", 86: "heavy snow showers",
  95: "thunderstorm", 96: "thunderstorm with slight hail", 99: "thunderstorm with heavy hail"
};

export class OpenMeteoProvider implements WeatherProvider {
  readonly id = "open-meteo";
  /** Cache TTLs — geocode is stable, weather drifts (§59 cost discipline). */
  private geocodeCache = new Map<string, { point: GeoPoint; at: number }>();
  private weatherCache = new Map<string, { weather: WeatherNow; at: number }>();
  private geocodeTtlMs = 24 * 3600 * 1000;
  private weatherTtlMs = 15 * 60 * 1000;

  constructor(private fetchFn: typeof fetch = (...a) => fetch(...a)) {}

  async geocode(place: string): Promise<GeoPoint | null> {
    const key = place.trim().toLowerCase();
    if (!key) return null;
    const hit = this.geocodeCache.get(key);
    if (hit && Date.now() - hit.at < this.geocodeTtlMs) return hit.point;

    const url = `${GEOCODE_URL}?name=${encodeURIComponent(place.trim())}&count=1&language=en&format=json`;
    const res = await this.fetchFn(url);
    if (!res.ok) throw new WeatherError({ kind: "WEATHER_UNAVAILABLE", message: `Geocoding service unavailable (HTTP ${res.status}).`, retryable: true });
    const data = await res.json() as { results?: { latitude: number; longitude: number; name: string; country?: string; admin1?: string }[] };
    const r = data.results?.[0];
    if (!r) return null;
    const point: GeoPoint = {
      lat: r.latitude,
      lon: r.longitude,
      label: [r.name, r.admin1, r.country].filter(Boolean).join(", ")
    };
    this.geocodeCache.set(key, { point, at: Date.now() });
    return point;
  }

  async current(point: GeoPoint): Promise<WeatherNow> {
    const key = `${point.lat.toFixed(3)},${point.lon.toFixed(3)}`;
    const hit = this.weatherCache.get(key);
    if (hit && Date.now() - hit.at < this.weatherTtlMs) return hit.weather;

    const url = `${FORECAST_URL}?latitude=${point.lat}&longitude=${point.lon}` +
      `&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m`;
    const res = await this.fetchFn(url);
    if (!res.ok) throw new WeatherError({ kind: "WEATHER_UNAVAILABLE", message: `Weather service unavailable (HTTP ${res.status}).`, retryable: true });
    const data = await res.json() as {
      current?: {
        time: string;
        temperature_2m: number;
        relative_humidity_2m: number;
        apparent_temperature: number;
        is_day: number;
        precipitation: number;
        weather_code: number;
        wind_speed_10m: number;
      };
    };
    const c = data.current;
    if (!c || typeof c.temperature_2m !== "number") {
      throw new WeatherError({ kind: "WEATHER_UNAVAILABLE", message: "Weather service returned no current conditions.", retryable: true });
    }
    const weather: WeatherNow = {
      locationLabel: point.label,
      temperatureC: c.temperature_2m,
      apparentC: c.apparent_temperature,
      humidityPct: c.relative_humidity_2m,
      windKph: c.wind_speed_10m,
      precipitationMm: c.precipitation,
      isDay: c.is_day === 1,
      description: WMO_CODES[c.weather_code] ?? `weather code ${c.weather_code}`,
      observedAt: Date.now(),
      source: this.id
    };
    this.weatherCache.set(key, { weather, at: Date.now() });
    return weather;
  }
}

/* --------------------------- location resolution -------------------------- */

/**
 * §47: user-configured location first; device geolocation only when the
 * permission is already granted (no silent location access). Returns null
 * when nothing is available — the caller must say so honestly.
 */
export async function resolveWeatherLocation(provider: WeatherProvider): Promise<GeoPoint | null> {
  const configured = settingsStore.current.weatherLocation.trim();
  if (configured) {
    return provider.geocode(configured); // may throw WeatherError → caller maps
  }
  // Try device position without prompting (permission-aware — §45).
  try {
    const pos = await getDevicePosition(6000);
    if (pos) {
      return { lat: pos.lat, lon: pos.lon, label: "current location" };
    }
  } catch { /* honest: no permission / no fix */ }
  return null;
}

async function getDevicePosition(timeoutMs: number): Promise<{ lat: number; lon: number } | null> {
  // Permission-aware: only use geolocation when the browser/WebView already
  // granted it — ZARA never silently prompts for location (§11, §45).
  const nav = navigator as Navigator & {
    geolocation?: {
      getCurrentPosition(
        ok: (p: { coords: { latitude: number; longitude: number } }) => void,
        err: (e: unknown) => void,
        opts: { timeout?: number; maximumAge?: number }
      ): void;
    };
    permissions?: { query(d: { name: string }): Promise<{ state: string }> };
  };
  if (!nav.permissions || !nav.geolocation) return null;
  try {
    const st = await nav.permissions.query({ name: "geolocation" });
    if (st.state !== "granted") return null; // never prompt silently
  } catch { return null; }
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    nav.geolocation!.getCurrentPosition(
      p => { clearTimeout(timer); resolve({ lat: p.coords.latitude, lon: p.coords.longitude }); },
      () => { clearTimeout(timer); resolve(null); },
      { timeout: timeoutMs, maximumAge: 10 * 60 * 1000 }
    );
  });
}

/* ------------------------------ formatting -------------------------------- */

/** Human summary for speech + the chat log. */
export function formatWeather(w: WeatherNow): string {
  const parts = [
    `${w.locationLabel}: ${Math.round(w.temperatureC)}°C, ${w.description}`,
    `feels like ${Math.round(w.apparentC)}°C`,
    `humidity ${Math.round(w.humidityPct)}%`,
    `wind ${Math.round(w.windKph)} km/h`
  ];
  if (w.precipitationMm > 0) parts.push(`${w.precipitationMm} mm precipitation`);
  return parts.join(", ") + ".";
}

/** Process-wide default provider (tests construct their own with a mock fetch). */
export const weatherProvider = new OpenMeteoProvider();
