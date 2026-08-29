/**
 * ZARA V1.0 — VRM avatar behavior mapping (FINAL-INTEGRATION §8, §30, §31).
 *
 * PURE LOGIC — no Three.js imports. Maps:
 *   - runtime states → posture / gaze / blink / breathing / light behavior
 *   - avatar emotions → VRM expression weights
 *   - speech energy → viseme selection (approximate, honest speech animation)
 *
 * The renderer consumes these mappings; unit tests verify them directly.
 */

import { AvatarEmotion } from "../emotion/EmotionController";
import { ZaraState } from "../../core/state/states";

/** Visemes provided by the bundled ZARA character (VRM 1.0 preset). */
export type Viseme = "aa" | "ih" | "ou" | "ee" | "oh";

/** Expression names provided by the bundled ZARA character. */
export type VrmExpression =
  | "neutral" | "happy" | "angry" | "sad" | "surprised" | "relaxed"
  | "blink" | "blinkLeft" | "blinkRight"
  | "lookUp" | "lookDown" | "lookLeft" | "lookRight";

/** How the avatar's gaze behaves for a runtime state (§8). */
export type GazeMode = "camera" | "wander" | "up-left" | "down" | "away" | "closed";

/** Per-state visual behavior of the avatar (§8: state-aware, never decorative). */
export interface AvatarBehavior {
  gazeMode: GazeMode;
  /** 0..1 — how tightly the gaze stays on its target (1 = locked on camera). */
  gazeStability: number;
  /** Baseline blinks per minute. */
  blinkRate: number;
  /** 0..1 forced eye closure (SLEEPING = fully closed). */
  forcedEyeClose: number;
  /** Breaths per minute. */
  breathRate: number;
  /** 0..1 breathing depth. */
  breathDepth: number;
  /** Head tilt in degrees (positive = tilt toward camera-left). */
  headTiltDeg: number;
  /** 0..1 idle body sway amount. */
  bodySway: number;
  /** 0..1 key light intensity (dimmed in QUIET/SLEEPING). */
  lightIntensity: number;
}

/** §8 state table — every runtime state gets a distinct, honest presentation. */
export const STATE_BEHAVIOR: Readonly<Record<ZaraState, AvatarBehavior>> = {
  BOOTING:    { gazeMode: "closed",  gazeStability: 0.6, blinkRate: 0,  forcedEyeClose: 1,   breathRate: 6,  breathDepth: 0.4, headTiltDeg: 0,  bodySway: 0,    lightIntensity: 0.25 },
  IDLE:       { gazeMode: "wander",  gazeStability: 0.3, blinkRate: 12, forcedEyeClose: 0,   breathRate: 10, breathDepth: 0.5, headTiltDeg: 0,  bodySway: 0.45, lightIntensity: 1.0 },
  LISTENING:  { gazeMode: "camera",  gazeStability: 1.0, blinkRate: 15, forcedEyeClose: 0,   breathRate: 12, breathDepth: 0.4, headTiltDeg: 2,  bodySway: 0.15, lightIntensity: 1.0 },
  THINKING:   { gazeMode: "up-left", gazeStability: 0.7, blinkRate: 7,  forcedEyeClose: 0,   breathRate: 8,  breathDepth: 0.35,headTiltDeg: -5, bodySway: 0.1,  lightIntensity: 0.9 },
  PLANNING:   { gazeMode: "camera",  gazeStability: 0.85,blinkRate: 10, forcedEyeClose: 0,   breathRate: 10, breathDepth: 0.4, headTiltDeg: 0,  bodySway: 0.15, lightIntensity: 0.95 },
  EXECUTING:  { gazeMode: "camera",  gazeStability: 0.9, blinkRate: 12, forcedEyeClose: 0,   breathRate: 11, breathDepth: 0.45,headTiltDeg: 3,  bodySway: 0.2,  lightIntensity: 1.0 },
  VERIFYING:  { gazeMode: "down",    gazeStability: 0.8, blinkRate: 14, forcedEyeClose: 0,   breathRate: 11, breathDepth: 0.4, headTiltDeg: -3, bodySway: 0.1,  lightIntensity: 0.95 },
  SPEAKING:   { gazeMode: "camera",  gazeStability: 0.95,blinkRate: 12, forcedEyeClose: 0,   breathRate: 12, breathDepth: 0.45,headTiltDeg: 1,  bodySway: 0.25, lightIntensity: 1.0 },
  WAITING:    { gazeMode: "camera",  gazeStability: 1.0, blinkRate: 13, forcedEyeClose: 0,   breathRate: 11, breathDepth: 0.4, headTiltDeg: 4,  bodySway: 0.2,  lightIntensity: 1.0 },
  INTERRUPTED:{ gazeMode: "camera",  gazeStability: 1.0, blinkRate: 18, forcedEyeClose: 0,   breathRate: 14, breathDepth: 0.5, headTiltDeg: 6,  bodySway: 0.2,  lightIntensity: 1.0 },
  QUIET:      { gazeMode: "away",    gazeStability: 0.4, blinkRate: 6,  forcedEyeClose: 0.15,breathRate: 7,  breathDepth: 0.3, headTiltDeg: -2, bodySway: 0.08, lightIntensity: 0.55 },
  SLEEPING:   { gazeMode: "closed",  gazeStability: 0,   blinkRate: 0,  forcedEyeClose: 1,   breathRate: 5,  breathDepth: 0.65,headTiltDeg: 8,  bodySway: 0,    lightIntensity: 0.35 },
  ERROR:      { gazeMode: "away",    gazeStability: 0.5, blinkRate: 8,  forcedEyeClose: 0,   breathRate: 9,  breathDepth: 0.35,headTiltDeg: -4, bodySway: 0.1,  lightIntensity: 0.6 },
  // §14: gentle wind-down — eyes soften shut, breathing slows, light fades.
  SHUTTING_DOWN: { gazeMode: "closed", gazeStability: 0.2, blinkRate: 0, forcedEyeClose: 0.8, breathRate: 5, breathDepth: 0.4, headTiltDeg: 6, bodySway: 0, lightIntensity: 0.3 }
};

/** §35: target milliseconds between rendered frames for each state.
 * Full rate while the companion is visibly "doing something" (active turn,
 * boot); heavily throttled in low-activity states so the renderer does not
 * burn CPU/GPU while ZARA is merely present. PURE — unit-tested. */
export function frameIntervalFor(state: ZaraState): number {
  switch (state) {
    // Genuinely animated — the user is watching a live moment.
    case "LISTENING":
    case "THINKING":
    case "PLANNING":
    case "EXECUTING":
    case "VERIFYING":
    case "SPEAKING":
    case "INTERRUPTED":
    case "WAITING":
    case "BOOTING":
      return 1000 / 60;
    // Idle presence — slow wander/blink/breathing still read naturally at 20 fps.
    case "IDLE":
    case "ERROR":
      return 1000 / 20;
    // Minimal animation states — 12 fps is visually indistinguishable.
    case "QUIET":
    case "SLEEPING":
    case "SHUTTING_DOWN":
      return 1000 / 12;
    default:
      return 1000 / 30;
  }
}

/**
 * §30 deterministic emotion mapping — VRM expression target weights.
 * Derived from real runtime events (never random, never LLM-invented states).
 */
export const EMOTION_EXPRESSIONS: Readonly<Record<AvatarEmotion, Partial<Record<VrmExpression, number>>>> = {
  neutral:   { neutral: 0.55 },
  listening: { neutral: 0.6, happy: 0.12 },
  thinking:  { relaxed: 0.35, lookUp: 0.45 },
  speaking:  { neutral: 0.4, happy: 0.18 },
  happy:     { happy: 1.0 },
  excited:   { happy: 1.0, surprised: 0.35 },
  curious:   { lookUp: 0.4, happy: 0.22 },
  focused:   { neutral: 0.7 },
  confused:  { lookDown: 0.35, sad: 0.25 },
  surprised: { surprised: 1.0 },
  sad:       { sad: 0.85 },
  playful:   { happy: 0.7, blinkLeft: 0.8 },   // wink
  proud:     { happy: 0.5, lookUp: 0.25 },
  sleepy:    { relaxed: 0.9, blink: 0.75 },
  error:     { sad: 0.45, lookDown: 0.3 },
  quiet:     { relaxed: 0.7, blink: 0.45 }
};

/** All expressions that may be driven (used to zero-out the rest). */
export const DRIVEN_EXPRESSIONS: readonly VrmExpression[] = [
  "neutral", "happy", "angry", "sad", "surprised", "relaxed",
  "blink", "blinkLeft", "blinkRight",
  "lookUp", "lookDown", "lookLeft", "lookRight"
];

/** Visemes driven during SPEAKING (aa/ih/ou/ee/oh — VRM preset set). */
export const VISEMES: readonly Viseme[] = ["aa", "ih", "ou", "ee", "oh"];

/**
 * §9/§31 — approximate (honest) speech animation: pick a viseme from the
 * current speech-energy band. Narrow sounds at low amplitude (ih/ee), open
 * sounds at high amplitude (aa/oh), rounded in between (ou). NOT claimed as
 * phoneme-level lip-sync — a reliable controlled approximation.
 */
export function selectViseme(amplitude: number, beat: number): Viseme {
  const a = Math.max(0, Math.min(1, amplitude));
  // Two independent picks per energy band; `beat` alternates so the mouth
  // shape changes naturally instead of locking to one viseme.
  if (a < 0.18) return beat % 2 === 0 ? "ih" : "ee";
  if (a < 0.42) return beat % 2 === 0 ? "ee" : "ih";
  if (a < 0.68) return beat % 2 === 0 ? "aa" : "ou";
  return beat % 2 === 0 ? "oh" : "aa";
}

/** Mouth-open weight from amplitude (with soft knee). */
export function visemeWeight(amplitude: number): number {
  const a = Math.max(0, Math.min(1, amplitude));
  return Math.min(1, a * 1.15);
}

/**
 * §9 — controlled speech-energy envelope (0..1) at time t (seconds) while
 * ZARA is actually in SPEAKING state. Deterministic cadence + slow
 * modulation; the renderer adds micro-jitter. Falls to 0 when not speaking.
 */
export function speechEnvelope(t: number, speaking: boolean): number {
  if (!speaking) return 0;
  const syllable = Math.abs(Math.sin(t * Math.PI * 2 * 2.7));       // ~2.7 syllables/s
  const phrase = 0.65 + 0.35 * Math.sin(t * 1.7 + 0.5);              // phrase-level dynamics
  return Math.max(0, Math.min(1, (0.18 + 0.82 * syllable) * phrase));
}

/** Gaze target offsets (model-space units, relative to head) per mode. */
export function gazeOffsetFor(mode: GazeMode, t: number, wanderSeed: number): { x: number; y: number; z: number } {
  switch (mode) {
    case "camera": return { x: 0, y: 0.02, z: 1.0 };
    case "up-left": return { x: -0.35, y: 0.45, z: 0.75 };
    case "down": return { x: 0.05, y: -0.5, z: 0.7 };
    case "away": return { x: 0.55, y: -0.1, z: 0.55 };
    case "closed": return { x: 0, y: 0, z: 0.8 };
    case "wander":
    default: {
      // Slow Lissajous drift — feels alive without being twitchy.
      const x = Math.sin(t * 0.31 + wanderSeed) * 0.4;
      const y = Math.sin(t * 0.23 + wanderSeed * 1.7) * 0.22;
      return { x, y, z: 0.9 };
    }
  }
}
