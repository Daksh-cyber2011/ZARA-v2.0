/**
 * ZARA V2 — Emotion theme system.
 *
 * Maps the deterministic EmotionController output to stage + UI color themes.
 * The whole interface (HUD chips, composer glow, mic orb, living layer,
 * avatar stage ring) breathes with ZARA's actual emotional state — never
 * random, always derived from the runtime (§8 / §30).
 *
 * PURE LOGIC — no Three.js / DOM imports. Unit-testable.
 */
import { AvatarEmotion } from "../emotion/EmotionController";
import { ZaraState } from "../../core/state/states";

export interface StageTheme {
  /** Primary accent — chips, rings, particles, focus glow. */
  primary: string;
  /** Secondary accent — gradients, beam ends. */
  secondary: string;
  /** Soft glow used for the backdrop orb (rgba). */
  glow: string;
  /** Short HUD label for the current mood. */
  label: string;
}

/** ZARA signature palette — cyan core, violet soul, per-emotion drift. */
export const EMOTION_THEMES: Readonly<Record<AvatarEmotion, StageTheme>> = {
  neutral:   { primary: "#22d3ee", secondary: "#6366f1", glow: "rgba(34,211,238,0.16)", label: "calm" },
  listening: { primary: "#22d3ee", secondary: "#0ea5e9", glow: "rgba(34,211,238,0.20)", label: "listening" },
  thinking:  { primary: "#a78bfa", secondary: "#e879f9", glow: "rgba(167,139,250,0.18)", label: "thinking" },
  speaking:  { primary: "#818cf8", secondary: "#22d3ee", glow: "rgba(129,140,248,0.20)", label: "talking" },
  happy:     { primary: "#fbbf24", secondary: "#f472b6", glow: "rgba(251,191,36,0.18)",  label: "happy" },
  excited:   { primary: "#e879f9", secondary: "#fbbf24", glow: "rgba(232,121,249,0.20)", label: "excited" },
  curious:   { primary: "#2dd4bf", secondary: "#22d3ee", glow: "rgba(45,212,191,0.18)",  label: "curious" },
  focused:   { primary: "#818cf8", secondary: "#3b82f6", glow: "rgba(129,140,248,0.16)", label: "focused" },
  confused:  { primary: "#f59e0b", secondary: "#94a3b8", glow: "rgba(245,158,11,0.15)",  label: "puzzled" },
  surprised: { primary: "#fb7185", secondary: "#fbbf24", glow: "rgba(251,113,133,0.20)", label: "surprised" },
  sad:       { primary: "#64748b", secondary: "#6366f1", glow: "rgba(100,116,139,0.16)", label: "a bit down" },
  playful:   { primary: "#f472b6", secondary: "#a78bfa", glow: "rgba(244,114,182,0.20)", label: "playful" },
  proud:     { primary: "#fbbf24", secondary: "#f59e0b", glow: "rgba(251,191,36,0.20)",  label: "proud" },
  sleepy:    { primary: "#6366f1", secondary: "#64748b", glow: "rgba(99,102,241,0.14)",  label: "sleepy" },
  error:     { primary: "#f43f5e", secondary: "#fb923c", glow: "rgba(244,63,94,0.18)",   label: "recovering" },
  quiet:     { primary: "#2dd4bf", secondary: "#475569", glow: "rgba(45,212,191,0.10)",  label: "quiet" }
};

/** HUD color per runtime state (chip dot + status lighting cues). */
export const STATE_HUD_COLORS: Readonly<Record<ZaraState, string>> = {
  BOOTING: "#64748b", IDLE: "#22d3ee", LISTENING: "#2dd4bf", THINKING: "#a78bfa",
  PLANNING: "#c084fc", SPEAKING: "#818cf8", WAITING: "#fbbf24", INTERRUPTED: "#f43f5e",
  QUIET: "#2dd4bf", SLEEPING: "#475569", EXECUTING: "#34d399", VERIFYING: "#2dd4bf", ERROR: "#f43f5e",
  SHUTTING_DOWN: "#64748b"
};

/** Human label per runtime state for the HUD chip. */
export const STATE_LABELS: Readonly<Record<ZaraState, string>> = {
  BOOTING: "Starting up", IDLE: "Idle", LISTENING: "Listening", THINKING: "Thinking",
  PLANNING: "Planning", SPEAKING: "Talking", WAITING: "Waiting for you", INTERRUPTED: "Interrupted",
  QUIET: "Quiet mode", SLEEPING: "Sleeping", EXECUTING: "Doing it", VERIFYING: "Checking",
  ERROR: "Hit a snag", SHUTTING_DOWN: "Going to sleep"
};

/** Theme for an emotion — emotion leads, state color feeds the HUD dot. */
export function themeFor(emotion: AvatarEmotion): StageTheme {
  return EMOTION_THEMES[emotion] ?? EMOTION_THEMES.neutral;
}

/** hex → "r, g, b" (for rgba() composition in canvas painting). */
export function hexToRgbTriple(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const v = h.length === 3 ? h.split("").map(c => c + c).join("") : h;
  const n = parseInt(v, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
