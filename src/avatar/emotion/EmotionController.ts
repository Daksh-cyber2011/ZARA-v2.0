/**
 * ZARA V1.0 — Emotion controller (Directive §31).
 *
 * 16 emotional states. Emotion derives from conversation/task/response/events
 * — NEVER random. Transitions ease over time (no snapping).
 */

export type AvatarEmotion =
  | "neutral" | "listening" | "thinking" | "speaking"
  | "happy" | "excited" | "curious" | "focused"
  | "confused" | "surprised" | "sad" | "playful"
  | "proud" | "sleepy" | "error" | "quiet";

export const ALL_EMOTIONS: readonly AvatarEmotion[] = [
  "neutral", "listening", "thinking", "speaking",
  "happy", "excited", "curious", "focused",
  "confused", "surprised", "sad", "playful",
  "proud", "sleepy", "error", "quiet"
];

/** Derive an emotion hint from a reply text (keyword heuristic — cheap,
 * deterministic, no LLM call needed per line). */
export function emotionFromReply(text: string): AvatarEmotion {
  const t = (text || "").toLowerCase();
  if (!t) return "neutral";
  if (/[🎉!]{2,}|amazing|awesome|fantastic|let's go|wahoo/i.test(t)) return "excited";
  if (/\b(great|nice|good|love|perfect|yay)\b/i.test(t)) return "happy";
  if (/\b(sorry|couldn't|failed|unable|error)\b/i.test(t)) return "sad";
  if (/\b(what|why|how|which)\b.*\?|^\?/.test(t)) return "curious";
  if (/\bhmm\b|\blet me\b|\bchecking\b|\blooking\b/i.test(t)) return "thinking";
  if (/\bhehe\b|\bteasing\b|\bsneaky\b/i.test(t)) return "playful";
  if (/\bremember\b|\bproud\b|\bdid it\b|\bcompleted\b/i.test(t)) return "proud";
  return "neutral";
}

export interface EmotionPose {
  eyeOpenness: number;      // 0..1
  browRaise: number;        // 0..1
  mouthSmile: number;       // -1..1 (negative = frown)
  mouthOpen: number;        // 0..1 (lip-sync adds on top)
  blush: number;            // 0..1
  glowIntensity: number;    // 0..1 aura
  tiltDeg: number;          // head tilt
  eyeColor: string;
  auraColor: string;
}

const POSES: Record<AvatarEmotion, EmotionPose> = {
  neutral:   { eyeOpenness: 0.85, browRaise: 0.1, mouthSmile: 0.08, mouthOpen: 0, blush: 0, glowIntensity: 0.35, tiltDeg: 0, eyeColor: "#7ee8fa", auraColor: "#4f7cff" },
  listening: { eyeOpenness: 1.0,  browRaise: 0.3, mouthSmile: 0.12, mouthOpen: 0, blush: 0, glowIntensity: 0.5,  tiltDeg: 2, eyeColor: "#8ff7e8", auraColor: "#37c8b5" },
  thinking:  { eyeOpenness: 0.6,  browRaise: 0.45, mouthSmile: 0.0,  mouthOpen: 0, blush: 0, glowIntensity: 0.45, tiltDeg: -5, eyeColor: "#c9b8ff", auraColor: "#8a6cff" },
  speaking:  { eyeOpenness: 0.9,  browRaise: 0.2, mouthSmile: 0.18, mouthOpen: 0.25, blush: 0.05, glowIntensity: 0.55, tiltDeg: 1, eyeColor: "#7ee8fa", auraColor: "#4f7cff" },
  happy:     { eyeOpenness: 0.75, browRaise: 0.35, mouthSmile: 0.8, mouthOpen: 0.2, blush: 0.25, glowIntensity: 0.7, tiltDeg: 3, eyeColor: "#ffd98f", auraColor: "#ffb347" },
  excited:   { eyeOpenness: 1.0,  browRaise: 0.7, mouthSmile: 0.9, mouthOpen: 0.4, blush: 0.3, glowIntensity: 0.95, tiltDeg: 4, eyeColor: "#ffe08f", auraColor: "#ff8e3c" },
  curious:   { eyeOpenness: 1.0,  browRaise: 0.6, mouthSmile: 0.25, mouthOpen: 0.05, blush: 0, glowIntensity: 0.5, tiltDeg: 7, eyeColor: "#a2f5c3", auraColor: "#3ecf8e" },
  focused:   { eyeOpenness: 0.95, browRaise: 0.05, mouthSmile: 0.0, mouthOpen: 0, blush: 0, glowIntensity: 0.55, tiltDeg: 0, eyeColor: "#9fd4ff", auraColor: "#2f7fe0" },
  confused:  { eyeOpenness: 0.8,  browRaise: 0.5, mouthSmile: -0.2, mouthOpen: 0.1, blush: 0, glowIntensity: 0.4, tiltDeg: -8, eyeColor: "#d9c9a3", auraColor: "#b09a6b" },
  surprised: { eyeOpenness: 1.0,  browRaise: 1.0, mouthSmile: 0.1, mouthOpen: 0.55, blush: 0.1, glowIntensity: 0.8, tiltDeg: 0, eyeColor: "#fff0a3", auraColor: "#ffd23c" },
  sad:       { eyeOpenness: 0.45, browRaise: 0.0, mouthSmile: -0.5, mouthOpen: 0, blush: 0, glowIntensity: 0.25, tiltDeg: 3, eyeColor: "#9fb8ff", auraColor: "#5a6cff" },
  playful:   { eyeOpenness: 0.7,  browRaise: 0.4, mouthSmile: 0.7, mouthOpen: 0.15, blush: 0.35, glowIntensity: 0.65, tiltDeg: 8, eyeColor: "#ff9fd4", auraColor: "#ff5fb0" },
  proud:     { eyeOpenness: 0.8,  browRaise: 0.3, mouthSmile: 0.6, mouthOpen: 0.05, blush: 0.1, glowIntensity: 0.75, tiltDeg: -3, eyeColor: "#ffe08f", auraColor: "#ffc247" },
  sleepy:    { eyeOpenness: 0.15, browRaise: 0.0, mouthSmile: 0.15, mouthOpen: 0.05, blush: 0, glowIntensity: 0.15, tiltDeg: 5, eyeColor: "#8f9fd9", auraColor: "#3c4a8f" },
  error:     { eyeOpenness: 0.75, browRaise: 0.2, mouthSmile: -0.35, mouthOpen: 0, blush: 0, glowIntensity: 0.3, tiltDeg: 0, eyeColor: "#ff9f9f", auraColor: "#e05252" },
  quiet:     { eyeOpenness: 0.4,  browRaise: 0.05, mouthSmile: 0.05, mouthOpen: 0, blush: 0, glowIntensity: 0.2, tiltDeg: 0, eyeColor: "#8fa8b8", auraColor: "#4a6a7f" }
};

export class EmotionController {
  private currentEmotion: AvatarEmotion = "neutral";
  private targetPose: EmotionPose = POSES.neutral;
  private easedPose: EmotionPose = { ...POSES.neutral };
  private lastChange = 0;
  /** Minimum ms between emotion changes — no flicker (§31). */
  private minDwellMs = 900;

  get emotion(): AvatarEmotion { return this.currentEmotion; }
  get pose(): Readonly<EmotionPose> { return this.easedPose; }

  set(emotion: AvatarEmotion, force = false): void {
    if (emotion === this.currentEmotion) return;
    const now = Date.now();
    if (!force && now - this.lastChange < this.minDwellMs) return;
    this.currentEmotion = emotion;
    this.targetPose = POSES[emotion];
    this.lastChange = now;
  }

  /** Smoothly approach target pose. Called per frame with dt seconds. */
  update(dt: number): void {
    const k = 1 - Math.exp(-dt * 6); // critically-damped-ish easing
    const e = this.easedPose, t = this.targetPose;
    e.eyeOpenness += (t.eyeOpenness - e.eyeOpenness) * k;
    e.browRaise += (t.browRaise - e.browRaise) * k;
    e.mouthSmile += (t.mouthSmile - e.mouthSmile) * k;
    e.blush += (t.blush - e.blush) * k;
    e.glowIntensity += (t.glowIntensity - e.glowIntensity) * k;
    e.tiltDeg += (t.tiltDeg - e.tiltDeg) * k;
    e.mouthOpen += (t.mouthOpen - e.mouthOpen) * k;
    e.eyeColor = t.eyeColor;
    e.auraColor = t.auraColor;
  }

  /** Lip-sync amplitude input (0..1) added on top of mouthOpen. */
  lipSyncAmplitude = 0;

  /** Effective mouth opening = pose mouth + lip sync. */
  get effectiveMouthOpen(): number {
    return Math.max(0, Math.min(1, this.easedPose.mouthOpen + this.lipSyncAmplitude * 0.8));
  }
}
